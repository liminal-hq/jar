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

/** Converts sim percent coordinates (0-100, `y=0` is the surface/top) to a
 * world-space position (Y-up, so sim `y=0` maps to `+TANK_HEIGHT/2`). Called
 * once per critter per physics step to feed the steering layer's target —
 * see `docs/architecture/3d-engine.md` §2.2's note that physics/render
 * positions are the source of truth once a critter exists; this function
 * only ever produces an *intent* signal (favourite spot, spawn point). */
export function simPercentToWorld(
  xPercent: number,
  yPercent: number,
  zPercent: number,
): THREE.Vector3 {
  const x = (xPercent / 100 - 0.5) * TANK_WIDTH;
  const y = (0.5 - yPercent / 100) * TANK_HEIGHT;
  const z = (zPercent / 100 - 0.5) * TANK_DEPTH;
  return new THREE.Vector3(x, y, z);
}
