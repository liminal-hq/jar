// Pure turn-rate estimation for `FishModel.tsx`'s per-frame animation
// intensity — split out specifically so the low-speed gating below is
// unit-testable without mocking a `useFrame` loop.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';

/** Below this speed, `vehicle.velocity`'s *direction* is noise, not signal
 * (the same underlying issue `heading.ts`'s `HEADING_COMMIT_SPEED` exists
 * for) — `computeTurnRate` below holds the last known-good direction and
 * reports zero rather than measure the angle between two near-random
 * low-speed direction samples. Without this gate, the moment right before a
 * fish commits to resting (speed already low, direction already noisy, but
 * still nominally "active") — and the moment right after it leaves rest,
 * ramping back up through the same low-speed band — fed that noise straight
 * into `FishModel.tsx`'s turn-boosted tail amplitude: the tail visibly
 * thrashing right around a pause or a night settle/wake, which the fish
 * monitor window (`windows/FishMonitor/FishMonitorWindow.tsx`) and screen
 * recordings both caught as fish "stuttering." */
export const MIN_TURN_RATE_SPEED = 0.12;

export interface TurnRateResult {
  /** Radians/second, always `>= 0`. Zero whenever `speed` is below
   * `MIN_TURN_RATE_SPEED` — not a measurement, a deliberate "nothing to
   * report" value. */
  turnRate: number;
  /** Same magnitude as `turnRate`, signed by which way the heading is
   * rotating about world Y (`cross(prevDirection, direction).y`'s sign) —
   * feeds `FishModel.tsx`'s turn-bend term
   * (`docs/architecture/notes/fish-turn-bend.md`). Zero under the same
   * speed gate as `turnRate`, for the same reason: a signed value flapping
   * between +/- from low-speed noise would be worse than the unsigned one
   * ever was. */
  signedTurnRate: number;
  /** The direction callers should keep as `prevDirection` for next frame's
   * call — unchanged from the input `prevDirection` below the speed gate,
   * so the next trustworthy reading compares against the last *real*
   * direction rather than a noisy intermediate one. */
  direction: THREE.Vector3;
}

/** Approximates how fast a vehicle's heading is rotating from consecutive
 * velocity-direction samples — good enough to drive "sharper turn -> bigger
 * S-curve" (`docs/architecture/3d-engine.md` §6.6) without tracking turn
 * rate as a first-class steering output. Never mutates `velocity` or
 * `prevDirection`. */
export function computeTurnRate(
  speed: number,
  velocity: THREE.Vector3,
  prevDirection: THREE.Vector3,
  delta: number,
  minSpeed: number = MIN_TURN_RATE_SPEED,
): TurnRateResult {
  if (speed <= minSpeed) {
    return { turnRate: 0, signedTurnRate: 0, direction: prevDirection };
  }

  const direction = velocity.clone().normalize();
  const angleDelta = prevDirection.angleTo(direction);
  const turnRate = delta > 0 ? angleDelta / delta : 0;
  // cross(prevDirection, direction).y, computed directly rather than via
  // THREE.Vector3.crossVectors — this runs once per fish per frame, and a
  // temp-object allocation per call isn't worth it just to read one
  // component back out.
  const crossY = prevDirection.z * direction.x - prevDirection.x * direction.z;
  const signedTurnRate = turnRate * Math.sign(crossY);
  return { turnRate, signedTurnRate, direction };
}
