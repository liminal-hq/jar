// Dev-only preferences that never touch the Rust backend or the wire
// protocol — they're debugging aids, not product settings, so they live
// in `localStorage` instead. All of Jar's windows load the same origin
// (`domain/windows.ts`), so `localStorage` is already shared across them;
// the native `storage` event (fired in every *other* window of that
// origin when a key changes, never the one that wrote it) is what keeps
// them live-synced without any Tauri event/IPC plumbing.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useState } from 'react';

const MOUSE_OVERLAY_KEY = 'jar:dev:mouseOverlay';
const FISH_POSITION_OVERLAY_KEY = 'jar:dev:fishPositionOverlay';

export function isMouseOverlayEnabled(): boolean {
  return localStorage.getItem(MOUSE_OVERLAY_KEY) === 'true';
}

export function setMouseOverlayEnabled(enabled: boolean): void {
  localStorage.setItem(MOUSE_OVERLAY_KEY, String(enabled));
  // `storage` only fires in *other* windows — update this window's own
  // subscribers too so the window with the checkbox reflects it as well.
  window.dispatchEvent(new StorageEvent('storage', { key: MOUSE_OVERLAY_KEY }));
}

/** Stays in sync live across every window, not just the one that changed it. */
export function useMouseOverlayEnabled(): boolean {
  const [enabled, setEnabled] = useState(isMouseOverlayEnabled);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === MOUSE_OVERLAY_KEY) setEnabled(isMouseOverlayEnabled());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return enabled;
}

/** Live per-fish world-coordinate readout (`SteeringSystem.tsx`'s
 * `useFrame` publishes into `render/steering/fishPositionDebug.ts` only
 * while this is on, so it costs nothing the rest of the time) — grew out of
 * repeatedly hand-patching that exact instrumentation back in mid-session
 * to chase "fish swam through the glass" reports; worth keeping on hand
 * for the next one instead of re-adding it from scratch each time. */
export function isFishPositionOverlayEnabled(): boolean {
  return localStorage.getItem(FISH_POSITION_OVERLAY_KEY) === 'true';
}

export function setFishPositionOverlayEnabled(enabled: boolean): void {
  localStorage.setItem(FISH_POSITION_OVERLAY_KEY, String(enabled));
  window.dispatchEvent(new StorageEvent('storage', { key: FISH_POSITION_OVERLAY_KEY }));
}

export function useFishPositionOverlayEnabled(): boolean {
  const [enabled, setEnabled] = useState(isFishPositionOverlayEnabled);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === FISH_POSITION_OVERLAY_KEY) {
        setEnabled(isFishPositionOverlayEnabled());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return enabled;
}
