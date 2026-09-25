// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureTankPng, setTankCanvasElement } from './canvasCapture';

// A 1x1 red PNG, base64-encoded — real bytes, not a placeholder, so the
// round trip through `atob`/`Uint8Array` is actually exercised.
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function fakeCanvas(dataUrl: string | (() => string)): HTMLCanvasElement {
  return {
    toDataURL: () => (typeof dataUrl === 'function' ? dataUrl() : dataUrl),
  } as unknown as HTMLCanvasElement;
}

beforeEach(() => {
  // `captureTankPng` deliberately waits for the render loop's own next
  // `requestAnimationFrame` tick before reading the canvas (see
  // `canvasCapture.ts`'s header comment) — firing it immediately here lets
  // these tests stay synchronous rather than asserting on real frame timing.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  setTankCanvasElement(null);
  vi.unstubAllGlobals();
});

describe('captureTankPng', () => {
  it('resolves null when no canvas is set', async () => {
    await expect(captureTankPng()).resolves.toBeNull();
  });

  it("resolves a PNG blob decoded from the canvas's toDataURL", async () => {
    setTankCanvasElement(fakeCanvas(`data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`));

    const blob = await captureTankPng();
    expect(blob).not.toBeNull();
    expect(blob!.type).toBe('image/png');
    // Confirms the base64 round trip actually decoded the real image bytes
    // (not e.g. the base64 text itself, or an empty blob) — jsdom's `Blob`
    // doesn't implement `arrayBuffer()`/`text()`, so size is the only cheap
    // signal available here; it matches `atob`'s own decoded byte count.
    expect(blob!.size).toBe(atob(ONE_PIXEL_PNG_BASE64).length);
  });

  it('reverts to resolving null once the canvas is cleared again', async () => {
    setTankCanvasElement(fakeCanvas(`data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`));
    setTankCanvasElement(null);

    await expect(captureTankPng()).resolves.toBeNull();
  });

  it('resolves null if reading the canvas throws', async () => {
    setTankCanvasElement(
      fakeCanvas(() => {
        throw new Error('canvas read failed');
      }),
    );

    await expect(captureTankPng()).resolves.toBeNull();
  });

  it('resolves null if the render loop never produces another frame', async () => {
    vi.useFakeTimers();
    try {
      // Simulate a stalled render loop: `requestAnimationFrame` never
      // actually calls back.
      vi.stubGlobal('requestAnimationFrame', () => 0);
      setTankCanvasElement(fakeCanvas(`data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`));

      const result = captureTankPng();
      await vi.runAllTimersAsync();
      await expect(result).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
