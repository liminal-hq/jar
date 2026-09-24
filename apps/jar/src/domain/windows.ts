// Opens the critter card, family tree and setup windows on demand
// (SPEC.md §2: "separate WebviewWindows positioned beside the tank").
// They aren't declared in `tauri.conf.json` — only the `tank` window is —
// because they only exist while the user has them open. All four windows
// load the same frontend bundle and route by label (`App.tsx`), so opening
// one just needs a label + a reasonable position, not a distinct URL.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

interface SatelliteWindowSpec {
  label: string;
  title: string;
  width: number;
  height: number;
}

const SPECS: Record<
  'critter-card' | 'family-tree' | 'setup' | 'dev-settings' | 'fish-monitor' | 'fish-eye',
  SatelliteWindowSpec
> = {
  // Tall enough for the 3D preview panel (a square that scales with width,
  // `CritterPreview.tsx`) plus the name field, stat bars and genetics list
  // below it without scrolling.
  'critter-card': { label: 'critter-card', title: 'Critter card', width: 320, height: 560 },
  'family-tree': { label: 'family-tree', title: 'Family tree', width: 360, height: 420 },
  // Tall enough for every row incl. the variant chip row (SPEC.md §4) and
  // TitleBar's 32px without scrolling — re-check if Setup grows more rows.
  setup: { label: 'setup', title: 'Setup', width: 320, height: 640 },
  // Supplementary tooling, always available from the tank's right-click
  // menu (`TankContextMenu.tsx`) rather than gated to dev builds — not
  // part of SPEC.md/SCREENS.md's core product screens, but not hidden
  // either. Tall enough for both checkboxes
  // plus their scrollable debug panels (`DevSettingsWindow.tsx`) when both
  // are toggled on, without the window itself needing to grow.
  'dev-settings': { label: 'dev-settings', title: 'Dev settings', width: 340, height: 480 },
  // Same always-available tooling as `dev-settings` — wide enough for the
  // live table (id/name/mode/rest/speed/turn-peak/pilot+watch buttons) plus
  // the top-down and front tank maps side by side (`FishMonitorWindow.tsx`),
  // without the name or actions column clipping or wrapping. Tall enough
  // for the full pilot status bar below the table (piloting line, key
  // legend, "keys work in this window or the tank" hint) without scrolling
  // once a fish is actually piloted.
  'fish-monitor': { label: 'fish-monitor', title: 'Fish monitor', width: 760, height: 580 },
  // First-person "fish eye" view from a piloted fish's own perspective —
  // its own small 3D scene (`FishEyeScene.tsx`), so a modest window is
  // enough; wide enough that a 4:3-ish view doesn't feel cramped, tall
  // enough for `DialogShell`'s own title-bar/heading chrome plus the 4:3
  // canvas plus the watching/pick-a-fish line below it without scrolling.
  'fish-eye': { label: 'fish-eye', title: 'Fish eye', width: 480, height: 500 },
};

/** Focuses the window if it's already open, otherwise creates it
 * positioned just to the right of the tank window (a simple placement
 * rule — replace with real "beside the tank, flip if no room" layout logic
 * per SPEC.md §2 when the real windows are built out).
 *
 * `initialQuery` (e.g. `"critterId=7"`) is only used when actually
 * creating the window — it's how a caller hands a freshly-created window
 * its starting state without racing a plain `emit()` against that window's
 * own JS finishing loading and subscribing (`domain/selection.ts`'s own
 * comment: an `emit()` fired right after this resolves can arrive before
 * the new window's listener is registered, dropping the very first
 * selection silently). An already-open window ignores it — it keeps
 * whatever state it already has, and a caller that also wants to retarget
 * an existing window still needs its own event for that case. */
export async function openSatelliteWindow(
  kind: keyof typeof SPECS,
  initialQuery?: string,
): Promise<void> {
  const spec = SPECS[kind];
  const existing = await WebviewWindow.getByLabel(spec.label);
  if (existing) {
    await existing.setFocus();
    return;
  }

  const tank = getCurrentWindow();
  // `outerPosition()`/`outerSize()` return physical pixels, but a
  // `WebviewWindow`'s own `x`/`y` constructor options are logical — dividing
  // by the tank's own scale factor here is what keeps a satellite window
  // actually landing beside the tank rather than drifting off on any
  // display that isn't exactly 1x.
  const [scale, tankPosition, tankSize] = await Promise.all([
    tank.scaleFactor(),
    tank.outerPosition(),
    tank.outerSize(),
  ]);

  const win = new WebviewWindow(spec.label, {
    url: initialQuery ? `index.html?${initialQuery}` : 'index.html',
    title: spec.title,
    width: spec.width,
    height: spec.height,
    x: tankPosition.x / scale + tankSize.width / scale + 16,
    y: tankPosition.y / scale,
    resizable: true,
    // With no native chrome, the close button is TitleBar's own — shrinking
    // a window below its control group's footprint would clip it out of
    // reach (DialogShell's wrapper is overflow: hidden for the rounded
    // corners above), trapping the window closeable only via its
    // right-click menu. This floor is comfortably wider than the longest
    // title ("Critter card"/"Family tree") plus a full Linux control group.
    minWidth: 240,
    minHeight: 200,
    // OS chrome is replaced entirely by `components/TitleBar`, themed per
    // SPEC.md §4 — `spec.title` above still sets the OS-level window title
    // (taskbar/alt-tab), independent of what TitleBar renders in-content.
    decorations: false,
    // Lets DialogShell's rounded corners (--jar-radius) be real transparency
    // in the clipped-away corner notches rather than a fake CSS round that
    // just reveals an opaque backdrop colour — the same pattern the tank
    // window already uses for its own bezel.
    transparent: true,
    // Windows-only (unsupported on Linux per the Tauri docs, so this is a
    // no-op on the platform these windows were designed and tested on
    // first): deliberately left on, unlike the tank window's own
    // `shadow: false` in `tauri.conf.json`. DWM gives an undecorated window
    // with `shadow: true` both a soft drop shadow and, on Windows 11,
    // native rounded corners — exactly what these dialog-style windows
    // want. `DialogShell.module.css` drops its own CSS corner-radius on
    // Windows (`html[data-platform='win']`) so that native rounding is the
    // only rounding, rather than two slightly-mismatched radii clipping
    // against each other.
    shadow: true,
  });

  win.once('tauri://error', (e) => {
    console.error(`failed to open ${spec.label} window`, e);
  });
}

/** Closes every satellite window that's currently open. Tauri's own exit
 * behaviour only fires once every open window is gone — with no "main
 * window" concept, a satellite left open after the tank closes keeps the
 * whole app running in the background — so the tank's own close handler
 * (`TankWindow.tsx`) calls this first. Keeping the label list here (not
 * duplicated into the Rust shell) matches `lib.rs`'s own split: satellite
 * windows are frontend-owned, Rust never learns their labels. */
export async function closeAllSatelliteWindows(): Promise<void> {
  await Promise.all(
    (Object.keys(SPECS) as (keyof typeof SPECS)[]).map(async (kind) => {
      const win = await WebviewWindow.getByLabel(SPECS[kind].label);
      await win?.close();
    }),
  );
}
