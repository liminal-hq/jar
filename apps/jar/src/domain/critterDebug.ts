// Cross-window live telemetry bridge for the critter debug rig
// (`windows/TankMonitor/TankMonitorWindow.tsx`) — the tank window's fish
// publish a throttled batch snapshot of every fish's steering/animation
// state (`render/steering/SteeringSystem.tsx`), and each snail publishes
// its own single-entry snapshot independently (`render/tank/Snail.tsx`,
// which has no equivalent shared registry to batch from) — the Tank
// monitor window subscribes and merges whatever entries arrive into one
// live table and top-down map, keyed by critter id, evicting an id that
// stops refreshing (a despawned critter, most likely). Plain Tauri app
// events, same pattern as `selection.ts`'s critter-selection broadcast —
// this is debugging state, not simulation state, so it doesn't belong in
// `jarClient`'s store.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';

const CRITTER_DEBUG_EVENT = 'jar://critter-debug';

/** Shared by every publisher (`SteeringSystem.tsx`'s fish batch,
 * `Snail.tsx`'s per-snail publish) so they stay at the same cadence without
 * each hardcoding its own copy of the number. */
export const DEBUG_PUBLISH_INTERVAL_SEC = 0.2;

/** One critter's state as of its publisher's last emit — world-space
 * position/heading (not screen-space), so the listener can lay out its own
 * map however it likes. `mode` is a plain string rather than a shared enum
 * because each species' state machine has its own vocabulary
 * (`FishMotionMode` in `render/steering/motionState.ts`, `SnailMotionMode`
 * in `render/tank/snailBehaviour.ts`) with no reason to unify. `turnRate`/
 * `isResting` are fish-only (steering-derived) — omitted for a snail row,
 * which the Tank monitor window renders as blank/`n/a` rather than a fake
 * zero or `false`. */
export interface CritterDebugEntry {
  id: number;
  mode: string;
  pos: [number, number, number];
  speed: number;
  yawDeg: number;
  pitchDeg: number;
  turnRate?: number;
  isResting?: boolean;
  /** 0-360, `Critter.hue` — lets the map colour each dot the same as the
   * critter's own body, so it's identifiable at a glance against the tank. */
  hue: number;
}

export interface CritterDebugSnapshot {
  entries: CritterDebugEntry[];
  simSeconds: number;
  isNight: boolean;
}

export async function emitCritterDebug(snapshot: CritterDebugSnapshot): Promise<void> {
  await emit(CRITTER_DEBUG_EVENT, snapshot);
}

export function onCritterDebug(
  callback: (snapshot: CritterDebugSnapshot) => void,
): Promise<UnlistenFn> {
  return listen<CritterDebugSnapshot>(CRITTER_DEBUG_EVENT, (e) => callback(e.payload));
}
