// Dev-only preferences that never touch the Rust backend or the wire
// protocol — they're debugging aids, not product settings, so they live
// in `localStorage` instead. All of Jar's windows load the same origin
// (`domain/windows.ts`), so `localStorage` is already shared across them;
// the native `storage` event (fired in every *other* window of that
// origin when a key changes, never the one that wrote it) is what keeps
// them live-synced without any Tauri event/IPC plumbing.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useState } from 'react';

const FISH_POSITION_OVERLAY_KEY = 'jar:dev:fishPositionOverlay';

/** A `localStorage`-backed boolean dev toggle, live-synced across every
 * window of this origin — factors out the exact pattern `isMouseOverlayEnabled`
 * originally hand-rolled (get/set/hook trio) so each new toggle is a
 * one-line call instead of a copy-pasted trio. `storage` only fires in
 * *other* windows, so `set` also dispatches a synthetic one locally, which
 * is what keeps the window that flipped the toggle in sync with itself. */
function createDevToggle(key: string) {
  const isEnabled = () => localStorage.getItem(key) === 'true';
  const setEnabled = (enabled: boolean) => {
    localStorage.setItem(key, String(enabled));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  };
  const useEnabled = () => {
    const [enabled, setEnabledState] = useState(isEnabled);
    useEffect(() => {
      const onStorage = (e: StorageEvent) => {
        if (e.key === null || e.key === key) setEnabledState(isEnabled());
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    }, []);
    return enabled;
  };
  return { isEnabled, setEnabled, useEnabled };
}

const mouseOverlay = createDevToggle('jar:dev:mouseOverlay');
export const isMouseOverlayEnabled = mouseOverlay.isEnabled;
export const setMouseOverlayEnabled = mouseOverlay.setEnabled;
export const useMouseOverlayEnabled = mouseOverlay.useEnabled;

/** Live table of every fish's steering/animation state in the tank window,
 * shown in the Dev settings window (`FishMonitorPanel.tsx`) — built for
 * tuning wander/rest/pause behaviour by eye against real numbers instead of
 * guessing from screen recordings. Gates the tank window's publisher too
 * (`SteeringSystem.tsx`), so there's no telemetry emit cost when nobody's
 * watching the panel. */
const fishMonitor = createDevToggle('jar:dev:fishMonitor');
export const isFishMonitorEnabled = fishMonitor.isEnabled;
export const setFishMonitorEnabled = fishMonitor.setEnabled;
export const useFishMonitorEnabled = fishMonitor.useEnabled;

/** Gates the tank window's ~30Hz pose publisher (`domain/fishPose.ts`,
 * `SteeringSystem.tsx`) — a much higher rate than `fishMonitor`'s 5Hz
 * telemetry, since it drives the fish-eye window's camera rather than a
 * table, so it's worth its own toggle to keep that cost at zero while that
 * window isn't open. */
const fishEye = createDevToggle('jar:dev:fishEye');
export const isFishEyeEnabled = fishEye.isEnabled;
export const setFishEyeEnabled = fishEye.setEnabled;
export const useFishEyeEnabled = fishEye.useEnabled;

export type DayNightOverride = 'auto' | 'day' | 'night';

const DAY_NIGHT_OVERRIDE_KEY = 'jar:dev:dayNightOverride';

/** Overrides the tank's night/settle behaviour regardless of the actual jar
 * clock (`Fish.tsx`) — `'day'`/`'night'` pin it there so a session can
 * exercise settle/wake transitions on demand (the stutter this exists to
 * chase shows up most right at those transitions, not mid-day/mid-night)
 * without waiting out a real day/night cycle; `'auto'` is the normal jar
 * clock. Same live-sync pattern as `createDevToggle`, just a 3-way string
 * instead of a boolean. */
export function getDayNightOverride(): DayNightOverride {
  const raw = localStorage.getItem(DAY_NIGHT_OVERRIDE_KEY);
  return raw === 'day' || raw === 'night' ? raw : 'auto';
}

export function setDayNightOverride(value: DayNightOverride): void {
  localStorage.setItem(DAY_NIGHT_OVERRIDE_KEY, value);
  window.dispatchEvent(new StorageEvent('storage', { key: DAY_NIGHT_OVERRIDE_KEY }));
}

export function useDayNightOverride(): DayNightOverride {
  const [value, setValue] = useState(getDayNightOverride);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === DAY_NIGHT_OVERRIDE_KEY) setValue(getDayNightOverride());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return value;
}

const PILOTED_FISH_ID_KEY = 'jar:dev:pilotedFishId';

/** Which fish (by `Critter.id`), if any, is currently under manual keyboard
 * control — armed from a row in the Fish monitor window
 * (`windows/FishMonitor/FishMonitorWindow.tsx`), consumed by the tank
 * window's `ManualPilotBehaviour` (`render/steering/manualPilotBehaviour.ts`)
 * and `PilotCaptureBridge.tsx`. Same live-sync pattern as
 * `getDayNightOverride`, a nullable number instead of a 3-way string. The
 * Fish monitor window is the only writer, and its own `resetOnClose`
 * guarantees this never survives that window closing — a fish left
 * "piloted" after the controlling window is gone would just sit there
 * ignoring its own AI forever. */
export function getPilotedFishId(): number | null {
  const raw = localStorage.getItem(PILOTED_FISH_ID_KEY);
  if (raw === null) return null;
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

export function setPilotedFishId(id: number | null): void {
  if (id === null) {
    localStorage.removeItem(PILOTED_FISH_ID_KEY);
  } else {
    localStorage.setItem(PILOTED_FISH_ID_KEY, String(id));
  }
  window.dispatchEvent(new StorageEvent('storage', { key: PILOTED_FISH_ID_KEY }));
}

export function usePilotedFishId(): number | null {
  const [value, setValue] = useState(getPilotedFishId);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === PILOTED_FISH_ID_KEY) setValue(getPilotedFishId());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return value;
}

/** Live per-fish world-coordinate readout (`SteeringSystem.tsx`'s
 * `useFrame` publishes into `domain/debugChannel.ts` only while this is on,
 * so it costs nothing the rest of the time) — useful for chasing "fish swam
 * through the glass" reports without re-adding ad hoc instrumentation each
 * time. */
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
