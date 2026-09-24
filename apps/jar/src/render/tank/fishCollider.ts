// A fish's physical/steering size, as a flat box rather than a sphere —
// `Fish.tsx`'s `CuboidCollider` is sized directly from this, and both
// avoidance behaviours (`tankContainmentBehaviour.ts`,
// `castleAvoidanceBehaviour.ts`) project it onto whichever world axis they
// need via `worldExtentX`/`worldExtentZ`, using the fish's own live heading.
// Pure module — no React, Rapier, or three.js objects — so every formula
// here is directly unit-testable.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { Critter } from '../../domain/protocol/generated/Critter';
import { lifeStageScale } from '../../domain/simConstants';
import {
  DORSAL_CREST_SVG_DISTANCE,
  MALE_TAIL_SCALE,
  SVG_SCALE,
  TAIL_TIP_SVG_DISTANCE,
} from '../models/fishGeometry';
import { MAX_PITCH } from '../steering/heading';

/** Half-extents of a fish's collider box, in the RigidBody's own local
 * frame: `x` left-right thickness, `y` up-down height, `z` nose-to-tail
 * length (forward). Matches `heading.ts`'s convention — at yaw 0 a fish's
 * forward/length axis sits on world Z and its thickness on world X. */
export interface ColliderHalfExtents {
  x: number;
  y: number;
  z: number;
}

/** Half-thickness of the physics box per fin type, in SVG units — a
 * policy constant, not a measured silhouette extent (unlike `hz`/`hy`
 * below, which are hard-derived from the model's own geometry): gives
 * roughly 2.4-3x headroom over the pectoral fins, the widest static part
 * of the model (±10.1 SVG units — `FishModel.tsx`'s pectoral pivot sits at
 * `z = ±(BODY_DEPTH/2 - 1) = ±7`, and the pectoral geometry itself, an
 * extrude depth 5 centred plus bevel, spans roughly ±3.1 around that
 * pivot). Veil gets extra for its broader tail silhouette. No sex term: a
 * male tail's own thickness (~±5.5-6 SVG, `MALE_TAIL_SCALE` applied
 * uniformly) stays well under this regardless of fin type. Deliberately
 * does *not* contain the swimming tail's full lateral sweep at high
 * amplitude — see the collider's own doc comment in `Fish.tsx` for why
 * that's an acceptable, documented deviation. Tune by eye. */
export const COLLIDER_HALF_THICKNESS_SVG: Record<'Fan' | 'Forked' | 'Veil', number> = {
  Fan: 24,
  Forked: 24,
  Veil: 30,
};

/** Covers `FishModel.tsx`'s `BODY_BOB_AMPLITUDE` (0.02, applied in world
 * units to the model's root group) so the bobbing body never leaves the
 * box's vertical extent. */
const BODY_BOB_ALLOWANCE = 0.02;

function halfExtentsAt(critter: Critter, stageScale: number): ColliderHalfExtents {
  const finType = critter.fin ?? 'Forked';
  const tailScale = critter.sex === 'Male' ? MALE_TAIL_SCALE : 1;
  return {
    x: COLLIDER_HALF_THICKNESS_SVG[finType] * SVG_SCALE * stageScale,
    y: DORSAL_CREST_SVG_DISTANCE * SVG_SCALE * stageScale + BODY_BOB_ALLOWANCE,
    z: TAIL_TIP_SVG_DISTANCE[finType] * SVG_SCALE * tailScale * stageScale,
  };
}

/** This fish's *current*, life-stage-scaled half-extents — feeds the real
 * `CuboidCollider` (`Fish.tsx`), recomputed fresh every render so it grows
 * live as `critter.life_stage` changes. `.z` is byte-identical to the
 * radius the old `BallCollider` used. */
export function colliderHalfExtentsFor(critter: Critter): ColliderHalfExtents {
  return halfExtentsAt(critter, lifeStageScale(critter.life_stage));
}

/** This fish's eventual adult/elder-size half-extents (life-stage scale
 * pinned to 1), regardless of its actual current age — for anything fixed
 * once and unable to react to the fish growing later: a one-time
 * spawn-point/favourite-spot clearance nudge (`Fish.tsx`'s
 * `spotClearance`/`keepClearOfCastle`), and the steering-avoidance
 * margins `useFishSteering.ts` builds its behaviours from (a fry grows
 * into this box; the margins don't need reconstructing as it does). */
export function adultColliderHalfExtentsFor(critter: Critter): ColliderHalfExtents {
  return halfExtentsAt(critter, 1);
}

/** Effective world-X half-extent of a `ColliderHalfExtents` box at a given
 * yaw — the standard oriented-box-onto-axis projection, valid because
 * fish only ever rotate freely in yaw (pitch is small and clamped to
 * `MAX_PITCH`, roll is always 0). Exact at yaw 0: the RigidBody's own rest
 * frame already has thickness on world X (`heading.ts`'s `forward = (sin
 * yaw, 0, cos yaw)` convention), so `worldExtentX(0, he) === he.x`, not an
 * approximation. A nose-on fish (yaw so its length faces this axis) gets
 * `he.z`; broadside gets close to `he.x`. */
export function worldExtentX(yaw: number, he: ColliderHalfExtents): number {
  return Math.abs(Math.cos(yaw)) * he.x + Math.abs(Math.sin(yaw)) * he.z;
}

/** Same projection as `worldExtentX`, for world Z. */
export function worldExtentZ(yaw: number, he: ColliderHalfExtents): number {
  return Math.abs(Math.sin(yaw)) * he.x + Math.abs(Math.cos(yaw)) * he.z;
}

/** Both `worldExtentX` and `worldExtentZ` at once, sharing a single
 * `Math.cos`/`Math.sin` pair instead of each recomputing them — the
 * behaviours that actually drive avoidance (`TankContainmentBehaviour`,
 * `CastleAvoidanceBehaviour`) both need both values every `calculate()`
 * call, so they use this rather than calling the two functions above
 * separately. `worldExtentX`/`worldExtentZ` stay exported in their own
 * right — simpler to reach for individually in tests, or anywhere that
 * only needs one axis. */
export function horizontalExtents(yaw: number, he: ColliderHalfExtents): { x: number; z: number } {
  const cos = Math.abs(Math.cos(yaw));
  const sin = Math.abs(Math.sin(yaw));
  return { x: cos * he.x + sin * he.z, z: sin * he.x + cos * he.z };
}

/** Worst-case vertical half-extent under `heading.ts`'s `MAX_PITCH` clamp
 * — yaw-independent (pitch doesn't interact with yaw for a vertical
 * extent), so callers compute this once rather than every frame. Uses the
 * clamp's worst case rather than the fish's actual live pitch — a
 * legitimate future refinement (both avoidance behaviours already read a
 * live yaw; reading live pitch too costs nothing extra once that's
 * wired), deliberately left out of scope here. */
export function verticalExtent(he: ColliderHalfExtents): number {
  return he.z * Math.sin(MAX_PITCH) + he.y * Math.cos(MAX_PITCH);
}
