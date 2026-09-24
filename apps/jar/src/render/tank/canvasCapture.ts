// Bridges the R3F canvas DOM element out of `TankScene.tsx` (the only place
// with access to it) to code outside the render tree — `TankContextMenu.tsx`'s
// Screenshot action. Plain module-level state, not React context:
// `TankScene`/`TankContextMenu` are siblings under `TankWindow.tsx`, neither
// an ancestor of the other, so there's no tree to thread a context through.
// `TankWindow.tsx`'s own drag-region comment already ran into this same
// gap — Canvas's own props never reach the underlying `<canvas>` node.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

let canvasEl: HTMLCanvasElement | null = null;

export function setTankCanvasElement(el: HTMLCanvasElement | null): void {
  canvasEl = el;
}

/** Resolves `null` if the canvas isn't mounted (shouldn't happen once the
 * menu is even reachable) or the browser declines to produce a blob. */
export function captureTankPng(): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (!canvasEl) {
      resolve(null);
      return;
    }
    canvasEl.toBlob((blob) => resolve(blob), 'image/png');
  });
}
