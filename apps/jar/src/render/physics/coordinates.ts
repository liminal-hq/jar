// Maps the sim's 0-100 percent coordinates onto the tank's 3D world volume
// — `docs/architecture/3d-engine.md` §2.2. Scale convention: 1 world unit
// ≈ 10 cm, so Rapier's damping/impulse magnitudes below are tuned assuming
// roughly real-world scale.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';

/** Tank volume in world units — width (x), height (y), depth (z). A modest
 * desktop tank at the "6x4x3 units" example in `docs/architecture/3d-engine.md`
 * §2.2. */
export const TANK_WIDTH = 6;
export const TANK_HEIGHT = 4;
export const TANK_DEPTH = 3;

/** How far the glass walls sit in from the tank's outer volume
 * (`AquariumEnvironment.tsx`) — a fish's centre should never legally cross
 * this margin. Exported (not just local to `AquariumEnvironment.tsx`) so
 * anything checking "is this position actually inside the tank" — the Dev
 * settings fish-position debug panel included — uses the exact same
 * boundary the walls themselves are built from, not a re-guessed one. */
export const WALL_INSET = 0.15;

/** Half-extents of the space the walls actually enclose — the real legal
 * bounds for a fish's `RigidBody` centre, smaller than `TANK_WIDTH`/etc by
 * `WALL_INSET` on every side. */
export const TANK_INNER_BOUNDS = {
  x: TANK_WIDTH / 2 - WALL_INSET,
  y: TANK_HEIGHT / 2 - WALL_INSET,
  z: TANK_DEPTH / 2 - WALL_INSET,
};

/** Converts sim percent coordinates (0-100, `y=0` is the surface/top) to a
 * world-space position (Y-up, so sim `y=0` maps to `+TANK_HEIGHT/2`). Called
 * once per critter per physics step to feed the steering layer's target —
 * see `docs/architecture/3d-engine.md` §2.2's note that physics/render
 * positions are the source of truth once a critter exists; this function
 * only ever produces an *intent* signal (favourite spot, spawn point).
 *
 * Maps onto `TANK_INNER_BOUNDS`, not the full `TANK_WIDTH`/`HEIGHT`/`DEPTH`
 * — the backend rolls `favourite_spot` uniformly across the whole 0-100
 * range with no notion of the walls' inset, so mapping onto the outer
 * volume let a spawn/target near 0% or 100% on any axis land *past* the
 * wall's actual containment boundary before physics ever ran a single
 * step: not a near-miss, a real penetration deep enough (worse yet,
 * sometimes on two or three axes at once, a corner) that Rapier's
 * first-step correction could send a fish tens of world units away in one
 * frame — the "fish flew out of the tank right after spawning" bug. */
export function simPercentToWorld(
  xPercent: number,
  yPercent: number,
  zPercent: number,
): THREE.Vector3 {
  const x = (xPercent / 100 - 0.5) * 2 * TANK_INNER_BOUNDS.x;
  const y = (0.5 - yPercent / 100) * 2 * TANK_INNER_BOUNDS.y;
  const z = (zPercent / 100 - 0.5) * 2 * TANK_INNER_BOUNDS.z;
  return new THREE.Vector3(x, y, z);
}
