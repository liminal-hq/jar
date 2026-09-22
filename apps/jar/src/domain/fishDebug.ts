// Cross-window live telemetry bridge for the fish debug rig
// (`windows/FishMonitor/FishMonitorWindow.tsx`) — the tank window publishes
// a throttled snapshot of every fish's steering/animation state
// (`render/steering/SteeringSystem.tsx`), and the fish monitor window
// subscribes to render a live table and top-down map. Plain Tauri app
// events, same pattern as `selection.ts`'s critter-selection broadcast —
// this is debugging state, not simulation state, so it doesn't belong in
// `jarClient`'s store.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';

import type { FishMotionMode } from '../render/steering/motionState';

const FISH_DEBUG_EVENT = 'jar://fish-debug';

/** One fish's state as of the last publish — world-space position/heading
 * (not screen-space), so the listener can lay out its own map however it
 * likes. */
export interface FishDebugEntry {
  id: number;
  mode: FishMotionMode;
  pos: [number, number, number];
  speed: number;
  yawDeg: number;
  pitchDeg: number;
  turnRate: number;
  isResting: boolean;
  /** 0-360, `Critter.hue` — lets the map colour each dot the same as the
   * fish's own body, so it's identifiable at a glance against the tank. */
  hue: number;
}

export interface FishDebugSnapshot {
  entries: FishDebugEntry[];
  simSeconds: number;
  isNight: boolean;
}

export async function emitFishDebug(snapshot: FishDebugSnapshot): Promise<void> {
  await emit(FISH_DEBUG_EVENT, snapshot);
}

export function onFishDebug(callback: (snapshot: FishDebugSnapshot) => void): Promise<UnlistenFn> {
  return listen<FishDebugSnapshot>(FISH_DEBUG_EVENT, (e) => callback(e.payload));
}
