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

/** The get/set/live-sync-hook trio shared by every dev setting below,
 * parameterized only by how to turn a raw stored string (or `null`, if
 * unset) into a value of type `T` — factors out the exact trio
 * `isMouseOverlayEnabled` originally hand-rolled so each new setting is one
 * `parse` function instead of a copy-pasted trio. `storage` only fires in
 * *other* windows, so `set` also dispatches a synthetic one locally, which
 * is what keeps the window that changed the value in sync with itself. */
function createDevValue<T>(key: string, parse: (raw: string | null) => T) {
  const getValue = () => parse(localStorage.getItem(key));
  const setValue = (value: T) => {
    localStorage.setItem(key, String(value));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  };
  const useValue = () => {
    const [value, setValueState] = useState(getValue);
    useEffect(() => {
      const onStorage = (e: StorageEvent) => {
        if (e.key === null || e.key === key) setValueState(getValue());
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    }, []);
    return value;
  };
  return { getValue, setValue, useValue };
}

function createDevToggle(key: string) {
  const {
    getValue: isEnabled,
    setValue: setEnabled,
    useValue: useEnabled,
  } = createDevValue(key, (raw) => raw === 'true');
  return { isEnabled, setEnabled, useEnabled };
}

/** Falls back to `defaultValue` for a missing or corrupt (non-finite)
 * stored value, so a hand-edited/cleared `localStorage` entry can't leave a
 * reader with `NaN` — used for tunables where a plain on/off doesn't fit,
 * e.g. `fishEyeLensStrength` below. */
function createDevNumber(key: string, defaultValue: number) {
  return createDevValue(key, (raw) => {
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : defaultValue;
  });
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
 * `getDayNightOverride`, a nullable number instead of a 3-way string. Both
 * the Fish monitor and Fish eye windows (`windows/FishEye/FishEyeWindow.tsx`)
 * can release this — Fish monitor's own `resetOnClose` guarantees it never
 * survives that window closing *unless* Fish eye is still open watching
 * (Fish eye's own liveness check then becomes the one guaranteeing it can't
 * outlive the fish itself) — so a fish left "piloted" with neither window
 * open, or after the fish it names dies, never just sits there ignoring its
 * own AI forever. */
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

/** How strong the Fish eye window's lens-distortion effect
 * (`render/effects/FishEyeLensEffect.tsx`) looks, from 0 (plain perspective
 * camera) to 1 (maximum barrel distortion/vignette/fringing) — live-tunable
 * here rather than hardcoded like `CrtEffect`'s constants, since the right
 * "unmistakably fisheye but not smeared" strength can only be judged by eye
 * in the running app. Unlike the toggles above, this isn't reset on this
 * window's close: it's a real tuned value, not per-session debug capture.
 * `0.35` was landed on live: `0.75` (the original guess) warped the light
 * beam/castle edge enough to make the scene genuinely hard to read. */
const fishEyeLensStrength = createDevNumber('jar:dev:fishEyeLensStrength', 0.35);
export const getFishEyeLensStrength = fishEyeLensStrength.getValue;
export const setFishEyeLensStrength = fishEyeLensStrength.setValue;
export const useFishEyeLensStrength = fishEyeLensStrength.useValue;
