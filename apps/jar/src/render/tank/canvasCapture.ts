// Bridges the R3F canvas DOM element out of `TankScene.tsx` (the only place
// with access to it) to code outside the render tree — `TankContextMenu.tsx`'s
// Screenshot action. Plain module-level state, not React context:
// `TankScene`/`TankContextMenu` are siblings under `TankWindow.tsx`, neither
// an ancestor of the other, so there's no tree to thread a context through.
// `TankWindow.tsx`'s own drag-region comment already ran into this same
// gap — Canvas's own props never reach the underlying `<canvas>` node.
//
// `captureTankPng` reads the canvas via `toDataURL()` (synchronous) rather
// than `toBlob()` (callback-based, so definitionally asynchronous), and
// specifically on the render loop's own very next `requestAnimationFrame`
// tick rather than immediately — `TankScene.tsx`'s `frameloop` runs
// continuously while the tank window is visible (§1.3), which is the only
// time this menu action is even reachable, so there's already a `rAF`
// queued for R3F's own render call by the time this is invoked; scheduling
// a second one here lands *after* it, in the same browser frame, before
// the browser has any chance to composite/clear the canvas — the same
// "render, then read before anything else runs" technique
// `docs/architecture/3d-engine.md` §1.1 used to justify keeping
// `preserveDrawingBuffer` on permanently. Reading it this way instead is
// what let that flag come off (issue #94): a permanently-retained drawing
// buffer is real, continuous GPU cost for a screenshot feature used at
// most a few times per session.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

let canvasEl: HTMLCanvasElement | null = null;

/** Shouldn't be reachable in practice — the Screenshot menu item only
 * exists while the tank window (and so its render loop) is visible — but a
 * hung `Promise` from some future change to that assumption would be a
 * worse failure mode than a "Screenshot failed" toast. */
const CAPTURE_TIMEOUT_MS = 2000;

export function setTankCanvasElement(el: HTMLCanvasElement | null): void {
  canvasEl = el;
}

/** Resolves `null` if the canvas isn't mounted (shouldn't happen once the
 * menu is even reachable), the render loop never produces another frame
 * within `CAPTURE_TIMEOUT_MS` (see its own comment), or the browser
 * declines to produce image data. */
export function captureTankPng(): Promise<Blob | null> {
  return new Promise((resolve) => {
    const el = canvasEl;
    if (!el) {
      resolve(null);
      return;
    }

    let settled = false;
    // Declared before use below: a mocked/synchronous `requestAnimationFrame`
    // (real ones are never synchronous, but a test double legitimately can
    // be) would otherwise call `finish` — which reads `timeoutId` to cancel
    // it — before the `setTimeout` call beneath assigns it.
    let timeoutId: ReturnType<typeof setTimeout>;
    const finish = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(blob);
    };

    requestAnimationFrame(() => {
      try {
        finish(dataUrlToPngBlob(el.toDataURL('image/png')));
      } catch (e) {
        console.error('tank screenshot: canvas read failed', e);
        finish(null);
      }
    });
    timeoutId = setTimeout(() => finish(null), CAPTURE_TIMEOUT_MS);
  });
}

/** `toDataURL()` is synchronous (the whole point — see this file's header
 * comment) but returns a base64 string, not the `Blob`
 * `TankContextMenu.tsx`'s clipboard write wants; decoding that synchronously
 * too, rather than via `fetch(dataUrl)`, avoids relying on `fetch` accepting
 * `data:` URLs in every target webview. */
function dataUrlToPngBlob(dataUrl: string): Blob {
  const commaIndex = dataUrl.indexOf(',');
  const base64 = dataUrl.slice(commaIndex + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}
