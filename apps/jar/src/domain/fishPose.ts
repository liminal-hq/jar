// Cross-window live pose bridge for the fish-eye window
// (`windows/FishEye/FishEyeWindow.tsx`) — the tank window publishes every
// fish's world-space position and rendered heading at a much higher rate
// than `fishDebug.ts`'s 5Hz telemetry (smooth enough to drive a camera,
// too much to also drive a table/map nobody needs updated that often), and
// the fish-eye window subscribes to render its own scene from it. Plain
// Tauri app events, same pattern as `fishDebug.ts` — this is debugging/
// tooling state, not simulation state, so it doesn't belong in
// `jarClient`'s store.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';

const FISH_POSE_EVENT = 'jar://fish-pose';

/** One fish's pose as of the last publish — `quat` is exactly
 * `SteeringSystem.tsx`'s own `currentHeading` (already slerped, already the
 * real rendered orientation, including a manually piloted fish's driven
 * yaw), not reconstructed from velocity — the fish-eye window's camera and
 * tankmate models can use it directly, no smoothing/hysteresis of their
 * own needed on top. `colliderRadius` sizes the camera's forward offset
 * (`Fish.tsx`'s `colliderRadiusFor`, life-stage scaled) so it sits just
 * ahead of the fish's own body rather than inside it. */
export interface FishPoseEntry {
  id: number;
  pos: [number, number, number];
  quat: [number, number, number, number];
  colliderRadius: number;
}

export interface FishPoseSnapshot {
  poses: FishPoseEntry[];
  /** Which fish (if any) the fish-eye window should follow — mirrors
   * `devSettings.ts`'s `pilotedFishId` so that window doesn't need its own
   * separate subscription just to know who the camera fish is. */
  pilotedId: number | null;
  t: number;
}

export async function emitFishPoses(snapshot: FishPoseSnapshot): Promise<void> {
  await emit(FISH_POSE_EVENT, snapshot);
}

export function onFishPoses(callback: (snapshot: FishPoseSnapshot) => void): Promise<UnlistenFn> {
  return listen<FishPoseSnapshot>(FISH_POSE_EVENT, (e) => callback(e.payload));
}
