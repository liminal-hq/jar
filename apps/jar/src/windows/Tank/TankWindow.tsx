// W1 · Tank (SCREENS.md). No OS chrome. The tank window doesn't apply any
// of the six frame bezel treatments — the glass tank enclosure
// (`AquariumEnvironment.tsx`) is the window's whole visual identity,
// translucent straight through to the desktop behind it, so a separate
// opaque frame chrome around it would work against that rather than for
// it. `.bezel` (the outer div below) still doubles as the Tauri drag
// region. The tank *interior* is a 3D scene
// (`docs/architecture/3d-engine.md`); only the drawer, toasts and status
// chip here are flat HTML/CSS.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { currentMonitor, getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Drawer } from '../../components/Drawer';
import { MouseDebugOverlay } from '../../components/MouseDebugOverlay';
import { ToastLayer } from '../../components/Toast';
import { useMouseOverlayEnabled } from '../../domain/devSettings';
import { ensureJarClientStarted, useJarStore } from '../../domain/jarClient';
import { TankScene } from '../../render/tank/TankScene';
import { applyDialogTheme } from '../../theme/theme';
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
  // for the drawer and pinned via inline style only while the drawer is
  // open — without this the 3D scene's container would stretch to fill
  // the wider window too, resizing/reflowing the tank contents on every
  // toggle instead of just exposing a new strip on the right for the
  // drawer to occupy. Re-derived fresh on every open rather than cached
  // across toggles, so a window resized (it's user-resizable) while the
  // drawer was closed is picked up correctly instead of pinning to a
  // stale width.
  const [tankWidth, setTankWidth] = useState<number | null>(null);
  // True when the window can't grow far enough right to fit the drawer
  // (maximized, or already against the monitor's work-area edge) — the
  // drawer then renders as an in-window overlay over part of the tank
  // instead of a strip exposed by resizing, so Setup/Exit stay reachable
  // rather than landing off-screen. `openDrawer` decides this per open;
  // `closeDrawer` reads it back to skip the resize it never did.
  const [drawerOverlay, setDrawerOverlay] = useState(false);
  // Guards against overlapping open/close calls: `setSize`/`outerSize`
  // are IPC round-trips (async from JS even though the underlying GTK
  // resize is a synchronous, blocking call once it reaches the Rust main
  // thread), so a second click before the first one's resize has
  // actually settled can read the window mid-transition — two racing
  // `openDrawer` calls would each add another +180px on top of an
  // already-widened window instead of a single 420 → 600.
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
    // No `applyTankFrame()` call — the tank doesn't apply frame chrome (see
    // this file's header). Leaving it uncalled matters, not just leaving
    // the `data-frame` attribute off: it sets `--jar-bezel-width`/
    // `--jar-bezel-color` as CSS custom properties that `.tankInterior`'s
    // own base rule reads unconditionally, attribute or not.
  }, [settings.dialog_theme, settings.theme_variants]);

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
  // deliberate: Wayland silently refuses a client's request to
  // reposition an *existing* window after creation, so a
  // separately-positioned floating drawer window is a dead end here.
  // Resizing the tank window right and pinning its own content width
  // instead sits entirely inside what Wayland actually allows a client
  // to do.
  const openDrawer = async () => {
    if (drawerOpen || resizingRef.current) return;
    resizingRef.current = true;
    try {
      const win = getCurrentWindow();
      const [scale, position, size, monitor] = await Promise.all([
        win.scaleFactor(),
        win.outerPosition(),
        win.outerSize(),
        currentMonitor(),
      ]);
      const width = size.width / scale;
      const height = size.height / scale;
      // Physical pixels throughout: `position`/`size`/`workArea` are all
      // physical already, so only `DRAWER_WIDTH` (a logical constant) needs
      // converting before comparing.
      const fitsOnScreen =
        monitor === null ||
        position.x + size.width + DRAWER_WIDTH * scale <=
          monitor.workArea.position.x + monitor.workArea.size.width;
      if (!fitsOnScreen) {
        setDrawerOverlay(true);
        setDrawerOpen(true);
        return;
      }
      setTankWidth(width);
      setDrawerOpen(true);
      await win.setSize(new LogicalSize(width + DRAWER_WIDTH, height));
    } finally {
      resizingRef.current = false;
    }
  };

  const closeDrawer = async () => {
    if (!drawerOpen || resizingRef.current) return;
    resizingRef.current = true;
    try {
      if (drawerOverlay) {
        setDrawerOpen(false);
        setDrawerOverlay(false);
        return;
      }
      if (tankWidth === null) return;
      const win = getCurrentWindow();
      const [scale, size] = await Promise.all([win.scaleFactor(), win.outerSize()]);
      // Shrink the window *before* clearing `drawerOpen`: the pinned tank
      // width (see `tankWidth` above) stays in effect for the whole resize,
      // so the canvas never stretches into the strip the window is in the
      // middle of giving back.
      await win.setSize(new LogicalSize(tankWidth, size.height / scale));
      setDrawerOpen(false);
    } finally {
      resizingRef.current = false;
    }
  };

  // Hover-based open/close is a dead end: WebKitGTK never dispatches
  // *any* boundary event — no mouseenter/mouseleave, no
  // mouseover/mouseout, not even a window blur — when the cursor crosses
  // the tank window's own outer edge, in either direction, so nothing
  // built on that signal (a hover handler, `:hover` polling,
  // `onFocusChanged`) can ever fire for it. Crossing an *internal* DOM
  // boundary, e.g. canvas into the drawer area, fires all of those
  // correctly — it's specifically the window's own edge that's silent.
  // (`MouseDebugOverlay`, toggled from the Dev settings window, logs raw
  // mouse events live for diagnosing this class of platform quirk.) A
  // click is always delivered correctly regardless, so open/close is a
  // deliberate click on the tank instead of a passive hover.
  const toggleDrawer = () => {
    if (drawerOpen) void closeDrawer();
    else void openDrawer();
  };

  // `data-tauri-drag-region` alone doesn't cover the tank: Tauri's drag
  // detection checks `event.target` directly with no ancestor lookup, and
  // the R3F canvas covering the tank's content area never receives that
  // attribute — `Canvas`'s own props only ever reach its outer wrapper
  // div, never the `<canvas>` DOM node itself (see its source). Starting
  // the drag manually from a bubbled `mousedown` on the tank's own div
  // works regardless of what element inside it was actually hit.
  //
  // Deliberately waits for real movement past a small threshold before
  // calling `startDragging()`, rather than firing on every press: unlike
  // Tauri's own native `data-tauri-drag-region` handling (evidently
  // synchronous with the OS's own mousedown), this goes through an async
  // IPC round-trip — by the time the native window-move grab actually
  // begins, a plain click may have already released, and GTK can end up
  // grabbing a pointer that's no longer down, swallowing the click
  // entirely instead of letting it resolve normally. Confirmed live: an
  // unconditional call on every mousedown made the drawer stop opening.
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const DRAG_THRESHOLD_PX = 4;

  const handleTankMouseDown = (e: ReactMouseEvent) => {
    if (e.buttons !== 1) return;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    const handleMove = (moveEvent: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragStartRef.current = null;
      cleanup();
      void getCurrentWindow().startDragging();
    };
    const handleUp = () => {
      dragStartRef.current = null;
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  // Backstop for closing without another click: `mousemove` fires
  // reliably and continuously the whole time the cursor is genuinely
  // inside the window (there's no event for "the cursor left" — see
  // above), so debounce on that instead of polling for an absence: reset
  // the timer on every mousemove, and treat a quiet stretch as "gone,"
  // whether that's because the cursor actually left or the user's just
  // done interacting and parked it somewhere.
  //
  // Deliberately doesn't also close on `onFocusChanged`/`isFocused()`:
  // this frameless/always-on-top tank window doesn't reliably report
  // itself as OS-focused at all, click or not, so wiring a close to that
  // fires immediately after every open — racing openDrawer's own
  // not-yet-settled resize and shrinking the window well past its actual
  // closed width.
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
  // means "done with the drawer." Returns the resize's own promise so
  // `Drawer.tsx` can await it: positioning a satellite window beside the
  // tank, or closing the app on Exit, both need the tank back at its
  // real closed width first, not mid-resize.
  const handleDrawerNavigate = () => closeDrawer();

  return (
    // No `data-frame` attribute — see this file's header on why the tank
    // doesn't apply frame chrome.
    <div className={styles.bezel} data-tauri-drag-region>
      {mouseOverlayEnabled && <MouseDebugOverlay />}
      <div
        className={styles.tankInterior}
        style={
          drawerOpen && !drawerOverlay && tankWidth !== null
            ? { flex: `0 0 ${tankWidth}px` }
            : undefined
        }
        onClick={toggleDrawer}
        onMouseDown={handleTankMouseDown}
        data-tauri-drag-region
      >
        <TankScene />
        <ToastLayer />
        <div className={styles.statusChip}>{statusText}</div>
      </div>

      {drawerOpen && (
        <div className={drawerOverlay ? styles.drawerOverlay : styles.drawerArea}>
          <Drawer onNavigate={handleDrawerNavigate} />
        </div>
      )}
    </div>
  );
}
