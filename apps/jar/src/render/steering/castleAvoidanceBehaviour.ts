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
import {
  verticalExtent,
  worldExtentX,
  worldExtentZ,
  type ColliderHalfExtents,
} from '../tank/fishCollider';

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
  /** Vertical margin — yaw-independent, computed once (see
   * `TankContainmentBehaviour`'s identical field for the reasoning). */
  private readonly marginY: number;

  /** `adultHalfExtents`/`buffer`/`getYaw`: same contract as
   * `TankContainmentBehaviour`'s constructor — a live yaw-projected
   * margin, not a fixed scalar. This is also what makes the doorway a
   * non-issue without any dedicated exemption: a nose-on fish's live
   * x-margin here (thickness + buffer, ~0.2) never comes close to
   * reaching the doorway's flanking walls from the centreline (they sit
   * 0.65 out) — the centreline stall a fixed length-based margin used to
   * risk simply can't occur once the margin actually reflects the fish's
   * real approach footprint. */
  constructor(
    private readonly adultHalfExtents: ColliderHalfExtents,
    private readonly buffer: number,
    private readonly getYaw: () => number,
  ) {
    super();
    this.marginY = verticalExtent(adultHalfExtents) + this.buffer;
  }

  calculate(vehicle: YUKA.Vehicle, force: YUKA.Vector3): YUKA.Vector3 {
    force.x = 0;
    force.y = 0;
    force.z = 0;
    const position = { x: vehicle.position.x, y: vehicle.position.y, z: vehicle.position.z };
    const yaw = this.getYaw();
    const margin = {
      x: worldExtentX(yaw, this.adultHalfExtents) + this.buffer,
      y: this.marginY,
      z: worldExtentZ(yaw, this.adultHalfExtents) + this.buffer,
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
