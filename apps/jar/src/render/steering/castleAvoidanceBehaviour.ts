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
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as YUKA from 'yuka';

import {
  CASTLE_COLLIDER_BOXES,
  CASTLE_DOORWAY_CORRIDOR,
  CASTLE_POSITION,
} from '../environment/decorLayout';

/** Same rationale as `TankContainmentBehaviour`'s own `STRENGTH` — has to
 * be able to out-vote `WanderBehavior`'s clamped force
 * (`vehicle.maxForce = 3`, `useFishSteering.ts`) at full penetration. */
const STRENGTH = 4;

/** A single box's push on a point within `margin` of it, or a zero vector
 * if the point isn't within `margin` on *every* axis — checking axes
 * independently (as `tankContainmentBehaviour.ts`'s `pushAxis` does for
 * the tank's infinite walls) would wrongly push a point that merely shares
 * this box's height or depth from clear across the tank. Once genuinely
 * near the box, the push goes out along whichever axis is closest to the
 * box's real surface (the shortest way clear) — the same "nearest face"
 * idea `decorLayout.ts`'s `keepClearOfCastle` uses for a one-off point
 * correction, applied here as a continuous, smoothly-graded force (0 at
 * `margin` out from the surface, `strength` right at it) instead of a
 * discrete snap. */
export function pushFromBox(
  position: { x: number; y: number; z: number },
  boxCentre: { x: number; y: number; z: number },
  halfExtents: { x: number; y: number; z: number },
  margin: number,
  strength: number,
): { x: number; y: number; z: number } {
  const dx = position.x - boxCentre.x;
  const dy = position.y - boxCentre.y;
  const dz = position.z - boxCentre.z;
  const ex = halfExtents.x + margin;
  const ey = halfExtents.y + margin;
  const ez = halfExtents.z + margin;
  if (Math.abs(dx) >= ex || Math.abs(dy) >= ey || Math.abs(dz) >= ez) {
    return { x: 0, y: 0, z: 0 };
  }

  const penetration = {
    x: ex - Math.abs(dx),
    y: ey - Math.abs(dy),
    z: ez - Math.abs(dz),
  };
  const minPenetration = Math.min(penetration.x, penetration.y, penetration.z);
  const magnitude = (Math.min(minPenetration, margin) / margin) * strength;

  if (minPenetration === penetration.x) return { x: Math.sign(dx || 1) * magnitude, y: 0, z: 0 };
  if (minPenetration === penetration.y) return { x: 0, y: Math.sign(dy || 1) * magnitude, z: 0 };
  return { x: 0, y: 0, z: Math.sign(dz || 1) * magnitude };
}

/** Whether `position` falls inside a fixed (non-margin-expanded) box — used
 * for `CASTLE_DOORWAY_CORRIDOR`'s hard exemption, as opposed to
 * `pushFromBox`'s margin-expanded, graded check. */
export function isInsideBox(
  position: { x: number; y: number; z: number },
  boxCentre: { x: number; y: number; z: number },
  halfExtents: { x: number; y: number; z: number },
): boolean {
  return (
    Math.abs(position.x - boxCentre.x) < halfExtents.x &&
    Math.abs(position.y - boxCentre.y) < halfExtents.y &&
    Math.abs(position.z - boxCentre.z) < halfExtents.z
  );
}

export class CastleAvoidanceBehaviour extends YUKA.SteeringBehavior {
  /** `margin`: same derivation contract as `TankContainmentBehaviour` — the
   * caller (`useFishSteering.ts`) passes this fish's own *eventual adult*
   * collider radius plus a buffer, so the turn away happens before the
   * body itself is close enough to actually touch the castle, even once
   * this fish is fully grown. `getColliderRadius`: a getter (not a fixed
   * value) for the same fish's real physical radius alone, with no
   * anticipatory buffer *and no adult-size assumption* — read fresh each
   * frame to size the doorway exemption below, since a fry's actual
   * collider is genuinely smaller than its adult one and can fit through
   * a gap its future self won't; using the fixed adult radius here would
   * needlessly deny the exemption to every fish that hasn't finished
   * growing yet. */
  constructor(
    private readonly margin: number,
    private readonly getColliderRadius: () => number,
  ) {
    super();
  }

  calculate(vehicle: YUKA.Vehicle, force: YUKA.Vector3): YUKA.Vector3 {
    force.x = 0;
    force.y = 0;
    force.z = 0;
    const position = { x: vehicle.position.x, y: vehicle.position.y, z: vehicle.position.z };

    // A fish lined up with the doorway is meant to be there — exempt it
    // entirely rather than merely softening the push, or it still gets
    // deflected before threading the actual opening (see
    // `CASTLE_DOORWAY_CORRIDOR`'s own comment). The exemption box itself is
    // shrunk by this fish's own collider radius on the axes that actually
    // border a wall (x: the flanking wall segments; y: the lintel above) —
    // checking only the *centre* against the corridor's full width would
    // exempt a fish whose real body already pokes past the doorway's edge
    // into the solid wall, avoidance fully off while the body clips. z is
    // left alone: nothing borders the corridor in that direction. A fish
    // whose collider radius alone exceeds the door's own half-width (the
    // single largest fin/sex combination, which the doorway was already
    // sized knowing wouldn't perfectly fit) gets no exemption at all —
    // avoidance stays on and it may still brush the frame, the same
    // documented trade-off `decorLayout.ts` already accepts, not a new one.
    const corridorCentre = {
      x: CASTLE_POSITION.x + CASTLE_DOORWAY_CORRIDOR.position.x,
      y: CASTLE_POSITION.y + CASTLE_DOORWAY_CORRIDOR.position.y,
      z: CASTLE_POSITION.z + CASTLE_DOORWAY_CORRIDOR.position.z,
    };
    const colliderRadius = this.getColliderRadius();
    const corridorHalfExtents = {
      x: Math.max(0, CASTLE_DOORWAY_CORRIDOR.halfExtents.x - colliderRadius),
      y: Math.max(0, CASTLE_DOORWAY_CORRIDOR.halfExtents.y - colliderRadius),
      z: CASTLE_DOORWAY_CORRIDOR.halfExtents.z,
    };
    if (isInsideBox(position, corridorCentre, corridorHalfExtents)) {
      return force;
    }

    // For the one fish size that never gets the exemption above (§ the
    // comment on it), the two flanking wall boxes are mirror images of each
    // other around the doorway's own centreline — a fish approaching
    // dead-centre gets equal, opposite `pushFromBox` contributions from
    // them that sum to zero in x, leaving only the lintel's downward push
    // once its collider also fails to clear the doorway height. That's a
    // stall, not a route-around: known and accepted as part of the same
    // single-non-fitting-combination trade-off `decorLayout.ts` already
    // documents, not a new regression, and not a permanent trap in
    // practice — `WanderBehavior`/`SeparationBehavior` still get whatever's
    // left of `vehicle.maxForce` each frame (this behaviour's own force
    // stays well under that cap here) and their own randomness is what
    // eventually nudges the fish enough off-centre to break the symmetry
    // and let the horizontal pushes actually diverge again.
    for (const box of CASTLE_COLLIDER_BOXES) {
      const boxCentre = {
        x: CASTLE_POSITION.x + box.position.x,
        y: CASTLE_POSITION.y + box.position.y,
        z: CASTLE_POSITION.z + box.position.z,
      };
      const push = pushFromBox(position, boxCentre, box.halfExtents, this.margin, STRENGTH);
      force.x += push.x;
      force.y += push.y;
      force.z += push.z;
    }
    return force;
  }
}
