// Pure velocity-to-orientation math for a fish's RigidBody heading — split
// out of `SteeringSystem.tsx`'s per-frame loop specifically so it's
// unit-testable without mocking Rapier/Yuka (velocity vector in, quaternion
// out, no side effects).
//
// A fish's heading is yaw-dominant with a *clamped* pitch, never a full 3D
// alignment to the raw velocity vector — real fish (and the "chill, upright"
// look this replaces a bug with) stay close to dorsal-up and yaw to turn,
// nosing up/down only a little when ascending/descending. Roll is always 0
// here; a small cosmetic bank belongs to `FishModel.tsx`'s own root group,
// layered on top of this, never the RigidBody itself
// (`docs/architecture/3d-engine.md` §6.6).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';

/** Below this horizontal speed, a velocity's yaw is too noisy to commit to
 * (e.g. a fish moving almost straight up/down, or nearly stopped) — callers
 * already tracking a heading should release it (hold the last one) rather
 * than call this.
 *
 * This is one half of a hysteresis pair with `HEADING_COMMIT_SPEED`, not a
 * single shared threshold — a fish decelerating toward a pause/rest/night
 * settle (or merely being nudged by a neighbour's separation force while
 * otherwise at rest) has a horizontal speed that lingers and wobbles right
 * around a single boundary for a while rather than crossing it once
 * cleanly. With one threshold, every crossing re-commits a fresh (and, at
 * that speed, essentially noise-dominated) yaw — this is what live testing
 * against the fish monitor (`windows/FishMonitor/FishMonitorWindow.tsx`)
 * confirmed reads as fish visibly stuttering right around night
 * settle/wake, the two transitions where a whole tank's worth of fish pass
 * through this exact low-speed band together. Requiring a climb back above
 * the higher `HEADING_COMMIT_SPEED` before trusting a new direction again
 * closes that gap: released fish stay released through the whole low-speed
 * wobble. */
export const HEADING_RELEASE_SPEED = 0.05;

/** The other half of the hysteresis pair — see `HEADING_RELEASE_SPEED`.
 * Comfortably above it (not just epsilon-above) so ordinary low-speed
 * wobble from separation/containment nudges on a resting fish can't
 * round-trip across the gap on its own. */
export const HEADING_COMMIT_SPEED = 0.12;

/** ~25°. The tank is 4 units tall vs 6 wide (`coordinates.ts`) — fish
 * routinely climb/dive a meaningful fraction of the tank's height over a
 * couple of seconds, which would demand 30-60° of pitch if uncapped. This
 * keeps them recognizably dorsal-up while still visibly "nosing" toward
 * their vertical goal. */
export const MAX_PITCH = 0.44;

const scratchEuler = new THREE.Euler();
const scratchExtractEuler = new THREE.Euler();

/** Extracts yaw from a heading quaternion built with the same `'YXZ'`
 * convention `quaternionFromYawPitch` below uses (the inverse of that
 * composition) — shared so callers that only need a fish's current yaw
 * (`Fish.tsx`'s live avoidance-margin getter, `SteeringSystem.tsx`'s pilot
 * yaw seeding) don't each independently reimplement the same
 * `setFromQuaternion(..., 'YXZ').y` decomposition with their own scratch
 * `Euler`. A separate scratch object from `scratchEuler` above, since that
 * one is mid-use composing the *other* direction (yaw/pitch -> quaternion)
 * whenever this module's own functions run — sharing one would be safe
 * given neither call chain re-enters the other, but keeping them distinct
 * is one less thing to reason about for zero extra cost. */
export function extractYaw(quaternion: THREE.Quaternion): number {
  return scratchExtractEuler.setFromQuaternion(quaternion, 'YXZ').y;
}

/** How far a fish noses up/down toward its vertical velocity — shared by
 * both heading functions below, since neither has a "driven pitch" input of
 * its own (`KeyR`/`KeyF` are world-space vertical thrust, not a pitch
 * control) — pitch is always derived from velocity, whether or not yaw is. */
function clampedPitch(velocity: THREE.Vector3, horizSpeed: number): number {
  return THREE.MathUtils.clamp(Math.atan2(velocity.y, horizSpeed), -MAX_PITCH, MAX_PITCH);
}

/** Composes a yaw+pitch pair into the roll-free quaternion both heading
 * functions return. `'YXZ'` order: yaw about Y first, then pitch about the
 * (already-yawed) local X — never a Z (roll) component. */
function quaternionFromYawPitch(yaw: number, pitch: number): THREE.Quaternion {
  scratchEuler.set(-pitch, yaw, 0, 'YXZ');
  return new THREE.Quaternion().setFromEuler(scratchEuler);
}

/** Decomposes a world-space velocity into a yaw+clamped-pitch quaternion —
 * `+Z` is the forward convention `Fish.tsx`'s model correction rotation
 * assumes (`docs/architecture/3d-engine.md` §6.2). Returns `null` when
 * horizontal speed is below `threshold`, signalling "hold the current
 * heading" rather than committing to a noisy yaw — callers pick
 * `HEADING_COMMIT_SPEED` or `HEADING_RELEASE_SPEED` depending on whether
 * they're currently tracking a heading, to get the hysteresis both
 * constants exist for. */
export function computeTargetHeading(
  velocity: THREE.Vector3,
  threshold: number,
): THREE.Quaternion | null {
  const horizSpeed = Math.hypot(velocity.x, velocity.z);
  if (horizSpeed < threshold) return null;

  const yaw = Math.atan2(velocity.x, velocity.z);
  return quaternionFromYawPitch(yaw, clampedPitch(velocity, horizSpeed));
}

/** Same yaw+clamped-pitch, roll-free construction as `computeTargetHeading`,
 * but for a manually piloted fish: `yaw` is supplied directly (the driven
 * angle `pilotInputState.ts`'s `KeyA`/`KeyD` maintain), never derived from
 * velocity — turning in place has no velocity to derive a yaw from, which
 * is exactly the case `computeTargetHeading`'s speed threshold would
 * release rather than commit to. Pitch still comes from velocity — at
 * negligible vertical speed this naturally settles to 0, the same flat-pitch
 * look a stationary or purely-turning fish should have. Never returns
 * `null`: a driven yaw is never noisy the way a velocity-derived one can
 * be. */
export function computePilotTargetHeading(yaw: number, velocity: THREE.Vector3): THREE.Quaternion {
  const horizSpeed = Math.hypot(velocity.x, velocity.z);
  return quaternionFromYawPitch(yaw, clampedPitch(velocity, horizSpeed));
}
