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
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';

/** Below this horizontal speed, a velocity's yaw is too noisy to commit to
 * (e.g. a fish moving almost straight up/down) — callers should hold the
 * last heading rather than call this. */
export const MIN_HEADING_SPEED = 0.05;

/** ~25°. The tank is 4 units tall vs 6 wide (`coordinates.ts`) — fish
 * routinely climb/dive a meaningful fraction of the tank's height over a
 * couple of seconds, which would demand 30-60° of pitch if uncapped. This
 * keeps them recognizably dorsal-up while still visibly "nosing" toward
 * their vertical goal. */
export const MAX_PITCH = 0.44;

const scratchEuler = new THREE.Euler();

/** Decomposes a world-space velocity into a yaw+clamped-pitch quaternion —
 * `+Z` is the forward convention `Fish.tsx`'s model correction rotation
 * assumes (`docs/architecture/3d-engine.md` §6.2). Returns `null` when
 * horizontal speed is below `MIN_HEADING_SPEED`, signalling "hold the
 * current heading" rather than committing to a noisy yaw. */
export function computeTargetHeading(velocity: THREE.Vector3): THREE.Quaternion | null {
  const horizSpeed = Math.hypot(velocity.x, velocity.z);
  if (horizSpeed < MIN_HEADING_SPEED) return null;

  const yaw = Math.atan2(velocity.x, velocity.z);
  const pitch = THREE.MathUtils.clamp(Math.atan2(velocity.y, horizSpeed), -MAX_PITCH, MAX_PITCH);

  // 'YXZ' order: yaw about Y first, then pitch about the (already-yawed)
  // local X — never a Z (roll) component.
  scratchEuler.set(-pitch, yaw, 0, 'YXZ');
  return new THREE.Quaternion().setFromEuler(scratchEuler);
}
