// Tests for closeAllSatelliteWindows — every known satellite label gets
// asked to close, missing windows are skipped rather than throwing.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({ label: 'tank' })),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: Object.assign(
    vi.fn(() => ({ once: vi.fn() })),
    { getByLabel: vi.fn() },
  ),
}));

import { closeAllSatelliteWindows } from './windows';

const KNOWN_LABELS = ['critter-card', 'family-tree', 'setup', 'dev-settings', 'fish-monitor'];

describe('closeAllSatelliteWindows', () => {
  beforeEach(() => {
    vi.mocked(WebviewWindow.getByLabel).mockReset();
  });

  it('asks every known satellite label to close', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    vi.mocked(WebviewWindow.getByLabel).mockResolvedValue({ close } as never);

    await closeAllSatelliteWindows();

    expect(
      vi
        .mocked(WebviewWindow.getByLabel)
        .mock.calls.map((call) => call[0])
        .sort(),
    ).toEqual([...KNOWN_LABELS].sort());
    expect(close).toHaveBeenCalledTimes(KNOWN_LABELS.length);
  });

  it('skips a label with no open window instead of throwing', async () => {
    vi.mocked(WebviewWindow.getByLabel).mockResolvedValue(null);

    await expect(closeAllSatelliteWindows()).resolves.toBeUndefined();
  });
});
