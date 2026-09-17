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

const SPECS: Record<'critter-card' | 'family-tree' | 'setup', SatelliteWindowSpec> = {
  'critter-card': { label: 'critter-card', title: 'Critter card', width: 280, height: 360 },
  'family-tree': { label: 'family-tree', title: 'Family tree', width: 360, height: 420 },
  setup: { label: 'setup', title: 'Setup', width: 320, height: 480 },
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
  const tankPosition = await tank.outerPosition();
  const tankSize = await tank.outerSize();

  const win = new WebviewWindow(spec.label, {
    url: 'index.html',
    title: spec.title,
    width: spec.width,
    height: spec.height,
    x: tankPosition.x + tankSize.width + 16,
    y: tankPosition.y,
    resizable: true,
  });

  win.once('tauri://error', (e) => {
    console.error(`failed to open ${spec.label} window`, e);
  });
}
