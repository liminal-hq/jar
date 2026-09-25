// W1 · Tank (SCREENS.md). No OS chrome. The tank window doesn't apply any
// of the six frame bezel treatments — the glass tank enclosure
// (`AquariumEnvironment.tsx`) is the window's whole visual identity,
// translucent straight through to the desktop behind it, so a separate
// opaque frame chrome around it would work against that rather than for
// it. `.bezel` (the outer div below) still doubles as the Tauri drag
// region. The tank *interior* is a 3D scene
// (`docs/architecture/3d-engine.md`); only the right-click menu, toasts and
// status chip here are flat HTML/CSS.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { getCurrentWindow } from '@tauri-apps/api/window';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { MenuPosition } from '../../components/ContextMenu/types';
import { MouseDebugCapture } from '../../components/MouseDebugCapture';
import { TankContextMenu } from '../../components/TankContextMenu';
import { ToastLayer } from '../../components/Toast';
import { useMouseOverlayEnabled } from '../../domain/devSettings';
import { speciesOfHabitat } from '../../domain/habitat';
import { ensureJarClientStarted, useJarStore } from '../../domain/jarClient';
import { closeAllSatelliteWindows } from '../../domain/windows';
import { TankScene } from '../../render/tank/TankScene';
import { applyDialogTheme } from '../../theme/theme';
import { PilotCaptureBridge } from './PilotCaptureBridge';
import styles from './TankWindow.module.css';

/** A defensive backstop, not the primary dismissal path: `ContextMenu`'s
 * own outside-`mousedown`/Escape/blur handlers close the menu normally, but
 * none of those fire if the cursor leaves this window entirely and the
 * next click lands in a different app — the same missing-boundary-event
 * gap noted on `handleTankMouseDown` below. Long enough to stay out of the
 * way of someone actually reading the menu. */
const MENU_IDLE_BACKSTOP_MS = 8000;

export function TankWindow() {
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [menuOpenedViaKeyboard, setMenuOpenedViaKeyboard] = useState(false);
  // Set on every mousedown, read (and consumed) by `handleTankContextMenu`
  // below — a real right-click always fires `mousedown(button 2)`
  // immediately before its `contextmenu` event, but a keyboard-triggered
  // one (Shift+F10/the Menu key) never fires a mousedown at all. More
  // reliable than reading `contextmenu`'s own `button` property, which
  // empirically does *not* reliably read 0 for a keyboard-triggered open on
  // every engine/platform combination Tauri targets (confirmed live on
  // WebKitGTK/GNOME: it read 2, same as a real right-click, there).
  const lastMouseDownWasRightClickRef = useRef(false);
  const mouseOverlayEnabled = useMouseOverlayEnabled();
  const settings = useJarStore((s) => s.settings);
  const critters = useJarStore((s) => s.critters);
  const hydrated = useJarStore((s) => s.hydrated);

  useEffect(() => {
    void ensureJarClientStarted();
  }, []);

  useEffect(() => {
    // Tauri has no "main window" concept — its own exit behaviour only
    // fires once every open window is gone, so a satellite window left
    // open when the tank closes keeps the whole app running in the
    // background indefinitely. Closing them here first, on whatever path
    // the tank itself closes by (its own title bar, OS close, Alt+F4,
    // taskbar), lets Tauri's exit condition resolve normally once they're
    // gone — no manual `destroy()` needed, since exit only checks the
    // final window count, not the order windows close in. The handler
    // must be `async`/awaited, not fire-and-forgotten: Tauri holds the
    // tank's own close until a returned promise resolves (its own
    // `onCloseRequested` docs demonstrate exactly this — an async handler
    // awaiting a confirm dialog before conditionally calling
    // `preventDefault()` only works at all if the close is genuinely held
    // open until then) — voiding the promise here let the tank's teardown
    // race ahead of and kill the in-flight closes for every other window.
    const unlistenClose = getCurrentWindow().onCloseRequested(async () => {
      await closeAllSatelliteWindows();
    });
    return () => {
      void unlistenClose.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const { isDark } = applyDialogTheme(
      settings.dialog_theme,
      settings.theme_variants[settings.dialog_theme],
    );
    // No `applyTankFrame()` call — the tank doesn't apply frame chrome (see
    // this file's header). Leaving it uncalled matters, not just leaving
    // the `data-frame` attribute off: it sets `--jar-bezel-width`/
    // `--jar-bezel-colour` as CSS custom properties that `.tankInterior`'s
    // own base rule reads unconditionally, attribute or not.
    //
    // `setTheme` still matters here despite `shadow: false` leaving no DWM
    // border to colour (`tauri.conf.json`) — it's what tells the OS window
    // server the app's actual light/dark mode at all, for whatever
    // app-content-blind chrome each platform draws from it.
    void getCurrentWindow().setTheme(isDark ? 'dark' : 'light');
  }, [settings.dialog_theme, settings.theme_variants]);

  useEffect(() => {
    // `settings.always_on_top` (SPEC.md §6) is a fact about the window,
    // not just a stored preference — keep the OS-level window flag in sync
    // with it whenever it changes, from any window.
    void getCurrentWindow().setAlwaysOnTop(settings.always_on_top);
  }, [settings.always_on_top]);

  const statusText = useMemo(() => {
    if (!hydrated) return 'loading…';
    const habitatSpecies = speciesOfHabitat(settings.habitat);
    const livingCount = Object.values(critters).filter(
      (c) => c.alive && habitatSpecies.includes(c.species),
    ).length;
    const label = settings.habitat === 'Aquarium' ? 'fish' : 'gecko';
    return `${livingCount} ${label}`;
  }, [critters, hydrated, settings.habitat]);

  // A fixed-position overlay over the tank, not a second window or a
  // window resize (the previous drawer's approach) — sidesteps Wayland
  // silently refusing a client's request to reposition an *existing*
  // window after creation, since nothing here ever needs repositioning.
  // Right-click is already excluded from `handleTankMouseDown`'s
  // drag-start path below (it bails on anything but the primary button),
  // so there's no click/drag ambiguity to resolve here.
  const handleTankContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault();
    // See `lastMouseDownWasRightClickRef`'s own comment above — decides
    // whether to pre-highlight the first item (`ContextMenu.tsx`'s
    // `autoFocusFirstItem`). Consumed (reset) immediately so a later
    // keyboard-triggered open isn't misattributed to whatever mousedown
    // happened last.
    setMenuOpenedViaKeyboard(!lastMouseDownWasRightClickRef.current);
    lastMouseDownWasRightClickRef.current = false;
    setMenuPosition({ x: e.clientX, y: e.clientY });
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
  // unconditional call on every mousedown broke plain clicks on the tank
  // (selecting a critter — see `Fish.tsx`'s own `onClick`).
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const DRAG_THRESHOLD_PX = 4;
  // Shows a move cursor for as long as this component can actually
  // control the cursor — from the first real movement after a press until
  // the threshold is crossed and control hands off to `startDragging()`'s
  // native interactive move. Deliberately not CSS `:active`: that would
  // track the same "mouse currently held down" window this component's
  // own JS state does, and get stuck the exact same way for the exact
  // same reason — see the "hands off" note below — so it isn't actually a
  // simpler alternative, just a differently-spelled version of the same
  // problem, minus the ability to fix it. That hand-off is also why this
  // doesn't just track "is a drag in progress" for its whole duration:
  // once the OS takes over, GTK/the window manager grabs the pointer for
  // the rest of the gesture (see the comment below on why an unconditional
  // `startDragging()` broke plain clicks) — normal DOM events, including
  // the `mouseup` that ends it, aren't reliably delivered back to this
  // window, and the release can land anywhere on screen, not necessarily
  // back over the tank. Desktop window managers already show their own
  // move cursor for that native phase, the same as dragging any other
  // window by its title bar, so there's nothing left for this component
  // to do once it hands off. Set from the first `mousemove`, not
  // `mousedown` itself: a plain click never generates a `mousemove` at
  // all, so waiting for one means an ordinary click-to-toggle-the-drawer
  // never flashes the cursor for a drag that was never going to happen.
  const [dragging, setDragging] = useState(false);

  const handleTankMouseDown = (e: ReactMouseEvent) => {
    lastMouseDownWasRightClickRef.current = e.button === 2;
    if (e.buttons !== 1) return;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    const handleMove = (moveEvent: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      setDragging(true);
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragStartRef.current = null;
      cleanup();
      setDragging(false);
      void getCurrentWindow().startDragging();
    };
    const handleUp = () => {
      dragStartRef.current = null;
      setDragging(false);
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  // `MENU_IDLE_BACKSTOP_MS` above: `mousemove` fires reliably and
  // continuously the whole time the cursor is genuinely inside the window
  // (there's no event for "the cursor left" — see `handleTankMouseDown`
  // above), so debounce on that instead of polling for an absence: reset
  // the timer on every mousemove, and treat a quiet stretch as "gone,"
  // whether that's because the cursor actually left or the user's just
  // done interacting and parked it somewhere.
  useEffect(() => {
    if (!menuPosition) return;
    let idleTimeout: ReturnType<typeof setTimeout>;

    const resetIdleTimer = () => {
      clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => setMenuPosition(null), MENU_IDLE_BACKSTOP_MS);
    };
    resetIdleTimer();
    document.addEventListener('mousemove', resetIdleTimer);

    return () => {
      document.removeEventListener('mousemove', resetIdleTimer);
      clearTimeout(idleTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuPosition]);

  return (
    // No `data-frame` attribute — see this file's header on why the tank
    // doesn't apply frame chrome.
    <div className={styles.bezel} data-tauri-drag-region>
      {mouseOverlayEnabled && <MouseDebugCapture />}
      <PilotCaptureBridge />
      <div
        className={styles.tankInterior}
        style={dragging ? { cursor: 'move' } : undefined}
        onContextMenu={handleTankContextMenu}
        onMouseDown={handleTankMouseDown}
        data-tauri-drag-region
      >
        <TankScene />
        <ToastLayer />
        <div className={styles.statusChip}>{statusText}</div>
      </div>

      {menuPosition && (
        <TankContextMenu
          position={menuPosition}
          onClose={() => setMenuPosition(null)}
          autoFocusFirstItem={menuOpenedViaKeyboard}
        />
      )}
    </div>
  );
}
