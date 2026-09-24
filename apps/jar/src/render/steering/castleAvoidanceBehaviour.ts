// Anticipatory avoidance for the castle's static collision geometry —
// steers a vehicle away once it's within `margin` of any of
// `CASTLE_COLLIDER_BOXES` (`decorLayout.ts`), the same anticipatory
// philosophy `TankContainmentBehaviour` uses for the glass: without this,
// `WanderBehavior` has no notion the castle exists at all, and a fish
// committed to wandering straight into it just fights its own physical
// collision response every frame — a fish can get pinned against a tower
// or the doorway indefinitely, barely moving, while `WanderBehavior` keeps
// handing it a fresh, obstacle-blind heading every frame.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as YUKA from 'yuka';

import { CASTLE_COLLIDER_BOXES, CASTLE_POSITION } from '../environment/decorLayout';
import { horizontalExtents, verticalExtent, type ColliderHalfExtents } from '../tank/fishCollider';

/** Same rationale as `TankContainmentBehaviour`'s own `STRENGTH` — has to
 * be able to out-vote `WanderBehavior`'s clamped force
 * (`vehicle.maxForce = 3`, `useFishSteering.ts`) at full penetration. */
const STRENGTH = 4;

/** A single box's push on a point within `margin` of it (now per-axis, not
 * a shared scalar — see `CastleAvoidanceBehaviour.calculate`'s own comment
 * for why), or a zero vector if the point isn't within margin on *every*
 * axis — checking axes independently (as `tankContainmentBehaviour.ts`'s
 * `pushAxis` does for the tank's infinite walls) would wrongly push a
 * point that merely shares this box's height or depth from clear across
 * the tank. Once genuinely near the box, the push goes out along whichever
 * axis is closest to the box's real surface, using each axis's own
 * *fractional* depth (0 at that axis's own margin zone's outer edge, 1 at
 * the box's real surface) rather than raw distance — with differently
 * sized margins per axis, raw penetration values aren't comparable (a
 * length-sized z margin dwarfs a thickness-sized x margin), so both the
 * nearest-face choice and the graded magnitude use this normalized depth
 * instead. With equal margins on every axis this reduces exactly to the
 * previous min-penetration/magnitude logic. */
export function pushFromBox(
  position: { x: number; y: number; z: number },
  boxCentre: { x: number; y: number; z: number },
  halfExtents: { x: number; y: number; z: number },
  margin: { x: number; y: number; z: number },
  strength: number,
): { x: number; y: number; z: number } {
  const dx = position.x - boxCentre.x;
  const dy = position.y - boxCentre.y;
  const dz = position.z - boxCentre.z;
  const ex = halfExtents.x + margin.x;
  const ey = halfExtents.y + margin.y;
  const ez = halfExtents.z + margin.z;
  if (Math.abs(dx) >= ex || Math.abs(dy) >= ey || Math.abs(dz) >= ez) {
    return { x: 0, y: 0, z: 0 };
  }

  const depth = {
    x: Math.min(ex - Math.abs(dx), margin.x) / margin.x,
    y: Math.min(ey - Math.abs(dy), margin.y) / margin.y,
    z: Math.min(ez - Math.abs(dz), margin.z) / margin.z,
  };
  const minDepth = Math.min(depth.x, depth.y, depth.z);
  const magnitude = minDepth * strength;

  if (minDepth === depth.x) return { x: Math.sign(dx || 1) * magnitude, y: 0, z: 0 };
  if (minDepth === depth.y) return { x: 0, y: Math.sign(dy || 1) * magnitude, z: 0 };
  return { x: 0, y: 0, z: Math.sign(dz || 1) * magnitude };
}

export class CastleAvoidanceBehaviour extends YUKA.SteeringBehavior {
  /** `getColliderHalfExtents`/`buffer`/`getYaw`: same contract as
   * `TankContainmentBehaviour`'s constructor — a live, current-size,
   * yaw-projected margin, not a fixed scalar (see that class's own
   * constructor comment for why using the fish's *live* size here, not
   * just its eventual adult one, is both safe and correct — a fry's
   * margin now shrinks to match its real current body).
   *
   * This live margin is also what makes the doorway safe *for a fish
   * approaching it nose-on* without any dedicated exemption: a nose-on
   * fish's x-margin there (thickness + buffer, ~0.2) never comes close to
   * reaching the doorway's flanking walls from the centreline (they sit
   * 0.65 out), so the centreline stall a fixed length-based margin used to
   * risk can't occur for that approach. It's a narrower claim than "can
   * never happen for any orientation," though: at yaws well off nose-on —
   * roughly 40°-140° from it, for the widest fin types — `worldExtentX`
   * itself can still exceed 0.65 (its own peak, `√(thickness²+length²)`,
   * comfortably clears that for a Male Veil), so a fish that happens to be
   * sitting broadside-ish exactly on the doorway centreline can still see
   * the flanking walls' pushes cancel. This is the same class of
   * accepted, self-resolving edge case the old exemption's own comment
   * described for its one non-fitting combination — `WanderBehavior`'s
   * own continuous heading jitter is what breaks the symmetry in
   * practice, here as there — just covering a wider yaw range now rather
   * than one fixed case. It doesn't affect the feature this margin exists
   * for: a fish actually *threading* the doorway is nose-on by
   * definition. */
  constructor(
    private readonly getColliderHalfExtents: () => ColliderHalfExtents,
    private readonly buffer: number,
    private readonly getYaw: () => number,
  ) {
    super();
  }

  calculate(vehicle: YUKA.Vehicle, force: YUKA.Vector3): YUKA.Vector3 {
    force.x = 0;
    force.y = 0;
    force.z = 0;
    const position = { x: vehicle.position.x, y: vehicle.position.y, z: vehicle.position.z };
    const yaw = this.getYaw();
    const halfExtents = this.getColliderHalfExtents();
    const horizontal = horizontalExtents(yaw, halfExtents);
    const margin = {
      x: horizontal.x + this.buffer,
      y: verticalExtent(halfExtents) + this.buffer,
      z: horizontal.z + this.buffer,
    };

    for (const box of CASTLE_COLLIDER_BOXES) {
      const boxCentre = {
        x: CASTLE_POSITION.x + box.position.x,
        y: CASTLE_POSITION.y + box.position.y,
        z: CASTLE_POSITION.z + box.position.z,
      };
      const push = pushFromBox(position, boxCentre, box.halfExtents, margin, STRENGTH);
      force.x += push.x;
      force.y += push.y;
      force.z += push.z;
    }
    return force;
  }
}
