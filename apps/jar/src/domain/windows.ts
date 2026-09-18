// Opens the critter card, family tree and setup windows on demand
// (SPEC.md §2: "separate WebviewWindows positioned beside the tank").
// They aren't declared in `tauri.conf.json` — only the `tank` window is —
// because they only exist while the user has them open. All four windows
// load the same frontend bundle and route by label (`App.tsx`), so opening
// one just needs a label + a reasonable position, not a distinct URL.
//
// (c) Copyright 2026 Scott Morris
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
  'critter-card' | 'family-tree' | 'setup' | 'dev-settings',
  SatelliteWindowSpec
> = {
  'critter-card': { label: 'critter-card', title: 'Critter card', width: 280, height: 360 },
  'family-tree': { label: 'family-tree', title: 'Family tree', width: 360, height: 420 },
  // Tall enough for every row incl. the variant chip row (SPEC.md §4) and
  // TitleBar's 32px without scrolling — re-check if Setup grows more rows.
  setup: { label: 'setup', title: 'Setup', width: 320, height: 640 },
  // Dev-only (`Drawer.tsx` only shows the button that opens this in dev
  // builds) — not part of SPEC.md/SCREENS.md.
  'dev-settings': { label: 'dev-settings', title: 'Dev settings', width: 280, height: 200 },
};

/** Focuses the window if it's already open, otherwise creates it
 * positioned just to the right of the tank window (a simple placement
 * rule — replace with real "beside the tank, flip if no room" layout logic
 * per SPEC.md §2 when the real windows are built out). */
export async function openSatelliteWindow(kind: keyof typeof SPECS): Promise<void> {
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
    url: 'index.html',
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
  });

  win.once('tauri://error', (e) => {
    console.error(`failed to open ${spec.label} window`, e);
  });
}
