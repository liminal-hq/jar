// W1 · Tank (SCREENS.md). No OS chrome — the frame bezel below is the only
// window decoration, and it doubles as the Tauri drag region. The tank
// *interior* is a 3D scene (`docs/architecture/3d-engine.md`); only the
// bezel, drawer, toasts and status chip here are flat HTML/CSS.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Drawer } from '../../components/Drawer';
import { MouseDebugOverlay } from '../../components/MouseDebugOverlay';
import { ToastLayer } from '../../components/Toast';
import { useMouseOverlayEnabled } from '../../domain/devSettings';
import { ensureJarClientStarted, useJarStore } from '../../domain/jarClient';
import { TankScene } from '../../render/tank/TankScene';
import { applyDialogTheme, applyTankFrame } from '../../theme/theme';
import styles from './TankWindow.module.css';

/** How much wider the window grows to fit the drawer open (SCREENS.md W1) —
 * see `Drawer.tsx` for the button list this needs to comfortably fit
 * ("Switch to gecko" is the long pole), plus its own padding. */
const DRAWER_WIDTH = 180;

/** Auto-close the drawer after this long with no `mousemove` at all —
 * the primary "the cursor left" signal (there's no boundary event for
 * that, see below), so short enough to feel responsive, long enough
 * that pausing to read a button doesn't trigger it. */
const DRAWER_IDLE_MS = 1500;

export function TankWindow() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The tank's own pixel width, captured right before growing the window
  // for the drawer and pinned via inline style while it's open — without
  // this the 3D scene's container would stretch to fill the wider window
  // too, resizing/reflowing the tank contents on every toggle instead of
  // just exposing a new strip on the right for the drawer to occupy.
  const [tankWidth, setTankWidth] = useState<number | null>(null);
  // Guards against overlapping open/close calls: `setSize`/`outerSize`
  // are IPC round-trips (async from JS even though the underlying GTK
  // resize is a synchronous, blocking call once it reaches the Rust main
  // thread), so a second click before the first one's resize has
  // actually settled can read the window mid-transition. Confirmed live:
  // two `openDrawer` calls racing this way stacked +180px on top of an
  // already-widened window instead of the intended single 420 → 600.
  const resizingRef = useRef(false);
  const mouseOverlayEnabled = useMouseOverlayEnabled();
  const settings = useJarStore((s) => s.settings);
  const critters = useJarStore((s) => s.critters);
  const hydrated = useJarStore((s) => s.hydrated);

  useEffect(() => {
    void ensureJarClientStarted();
  }, []);

  useEffect(() => {
    applyDialogTheme(settings.dialog_theme, settings.theme_variants[settings.dialog_theme]);
    applyTankFrame(settings.frame);
  }, [settings.dialog_theme, settings.theme_variants, settings.frame]);

  useEffect(() => {
    // `settings.always_on_top` (SPEC.md §6) is a fact about the window,
    // not just a stored preference — keep the OS-level window flag in sync
    // with it whenever it changes, from any window.
    void getCurrentWindow().setAlwaysOnTop(settings.always_on_top);
  }, [settings.always_on_top]);

  const statusText = useMemo(() => {
    if (!hydrated) return 'loading…';
    const livingCount = Object.values(critters).filter(
      (c) => c.alive && c.species === settings.mode,
    ).length;
    const label = settings.mode === 'Fish' ? 'fish' : 'gecko';
    return `${livingCount} ${label}`;
  }, [critters, hydrated, settings.mode]);

  // Growing/shrinking the window itself, not moving a second window, is
  // deliberate: Wayland lets a client resize its own window freely, but
  // (confirmed live, not just documentation) silently refuses a client's
  // request to reposition an *existing* window after creation — a
  // hover-positioned floating drawer window is a dead end here. Resizing
  // the tank window right and pinning its own content width instead sits
  // entirely inside what Wayland actually allows a client to do.
  const openDrawer = async () => {
    if (drawerOpen || resizingRef.current) return;
    resizingRef.current = true;
    try {
      const win = getCurrentWindow();
      const [scale, size] = await Promise.all([win.scaleFactor(), win.outerSize()]);
      // Prefer the already-known closed width over re-deriving it from
      // the window's current size, which (once the drawer's been opened
      // and closed at least once already) may not actually be at rest
      // yet — see `resizingRef`'s own comment.
      const width = tankWidth ?? size.width / scale;
      const height = size.height / scale;
      setTankWidth(width);
      setDrawerOpen(true);
      await win.setSize(new LogicalSize(width + DRAWER_WIDTH, height));
    } finally {
      resizingRef.current = false;
    }
  };

  const closeDrawer = async () => {
    if (!drawerOpen || tankWidth === null || resizingRef.current) return;
    resizingRef.current = true;
    try {
      const win = getCurrentWindow();
      const [scale, size] = await Promise.all([win.scaleFactor(), win.outerSize()]);
      setDrawerOpen(false);
      await win.setSize(new LogicalSize(tankWidth, size.height / scale));
    } finally {
      resizingRef.current = false;
    }
  };

  // Hover-based open/close is a dead end: confirmed live, with a debug
  // overlay (`MouseDebugOverlay`, toggled from the Dev settings window)
  // logging every raw mouse event, that WebKitGTK never dispatches *any*
  // boundary event — no mouseenter/mouseleave, no mouseover/mouseout,
  // not even a window blur — when the cursor crosses the *outer window
  // edge* in either direction; the event log just goes silent for
  // however long the cursor is elsewhere and resumes with a plain
  // mousemove, no bracketing event at all. (Crossing an *internal* DOM
  // boundary, e.g. canvas into the drawer area, fires all of those
  // correctly — it's specifically the window's own edge that's silent.)
  // A click is always delivered correctly regardless, so open/close is a
  // deliberate click on the tank instead of a passive hover.
  const toggleDrawer = () => {
    if (drawerOpen) void closeDrawer();
    else void openDrawer();
  };

  // Backstop for closing without another click: `mousemove` fires
  // reliably and continuously the whole time the cursor is genuinely
  // inside the window (there's no event for "the cursor left" — see
  // above), so debounce on that instead of polling for an absence: reset
  // the timer on every mousemove, and treat a quiet stretch as "gone,"
  // whether that's because the cursor actually left or the user's just
  // done interacting and parked it somewhere.
  //
  // Deliberately doesn't also use `onFocusChanged`/`isFocused()` the way
  // emoji-nook's popup dismissal does: confirmed live that this
  // frameless/always-on-top tank window doesn't reliably report itself
  // as OS-focused at all, click or not — wiring a close to that fired
  // immediately after every open, racing openDrawer's own not-yet-settled
  // resize and shrinking the window well past its actual closed width.
  useEffect(() => {
    if (!drawerOpen) return;
    let idleTimeout: ReturnType<typeof setTimeout>;

    const resetIdleTimer = () => {
      clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => void closeDrawer(), DRAWER_IDLE_MS);
    };
    resetIdleTimer();
    document.addEventListener('mousemove', resetIdleTimer);

    return () => {
      document.removeEventListener('mousemove', resetIdleTimer);
      clearTimeout(idleTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerOpen]);

  // Opening Setup/Tree/Dev creates and focuses a new window — proactively
  // close the drawer right here rather than waiting on the next idle
  // tick, since we already know this is the one interaction that always
  // means "done with the drawer."
  const handleDrawerNavigate = () => {
    void closeDrawer();
  };

  return (
    <div className={styles.bezel} data-tauri-drag-region>
      {mouseOverlayEnabled && <MouseDebugOverlay />}
      <div
        className={styles.tankInterior}
        style={tankWidth !== null ? { flex: `0 0 ${tankWidth}px` } : undefined}
        onClick={toggleDrawer}
      >
        <TankScene />
        <ToastLayer />
        <div className={styles.statusChip}>{statusText}</div>
      </div>

      {drawerOpen && (
        <div className={styles.drawerArea}>
          <Drawer onNavigate={handleDrawerNavigate} />
        </div>
      )}
    </div>
  );
}
