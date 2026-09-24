// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { afterEach, describe, expect, it } from 'vitest';

import { captureTankPng, setTankCanvasElement } from './canvasCapture';

function fakeCanvas(blob: Blob | null): HTMLCanvasElement {
  return {
    toBlob: (callback: BlobCallback) => callback(blob),
  } as unknown as HTMLCanvasElement;
}

afterEach(() => {
  setTankCanvasElement(null);
});

describe('captureTankPng', () => {
  it('resolves null when no canvas is set', async () => {
    await expect(captureTankPng()).resolves.toBeNull();
  });

  it("resolves the blob the canvas's toBlob hands back", async () => {
    const blob = new Blob(['fake-png-bytes'], { type: 'image/png' });
    setTankCanvasElement(fakeCanvas(blob));

    await expect(captureTankPng()).resolves.toBe(blob);
  });

  it('reverts to resolving null once the canvas is cleared again', async () => {
    setTankCanvasElement(fakeCanvas(new Blob()));
    setTankCanvasElement(null);

    await expect(captureTankPng()).resolves.toBeNull();
  });
});
