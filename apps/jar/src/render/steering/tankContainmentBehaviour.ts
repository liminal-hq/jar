// Anticipatory wall-avoidance for fish — steers a vehicle back toward the
// tank's centre once it's within `MARGIN` of any wall, rather than relying
// purely on the physical `CuboidCollider` walls (`AquariumEnvironment.tsx`)
// to correct a bad heading after the fact. Without this, `WanderBehavior`
// keeps commanding fish toward the glass (it has no notion of the tank's
// bounds at all), and the resulting fight between the commanded direction
// and the physical collision response is a real source of visible jitter
// right at the walls.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as YUKA from 'yuka';

import { TANK_INNER_BOUNDS } from '../physics/coordinates';

/** Must be able to out-vote `WanderBehavior`'s own clamped force
 * (`vehicle.maxForce = 3`, `useFishSteering.ts`) at full penetration, or a
 * fish committed to wandering straight at the glass would still win. */
const STRENGTH = 4;

export function pushAxis(
  position: number,
  bound: number,
  margin: number,
  strength: number,
): number {
  const innerEdge = bound - margin;
  if (position > innerEdge) {
    const penetration = Math.min(position - innerEdge, margin);
    return -(penetration / margin) * strength;
  }
  if (position < -innerEdge) {
    const penetration = Math.min(-innerEdge - position, margin);
    return (penetration / margin) * strength;
  }
  return 0;
}

/** How much of the dominant push's own magnitude gets mirrored sideways as
 * the tangential nudge below — small enough to leave wall-avoidance itself
 * clearly dominant, large enough to reliably break a square-on approach's
 * exact symmetry within a handful of frames. Tune by eye. */
const TANGENT_FRACTION = 0.2;

export class TankContainmentBehaviour extends YUKA.SteeringBehavior {
  /** A fixed per-fish left/right bias, rolled once at construction rather
   * than per frame — this is what makes the tangential nudge below a
   * consistent turn instead of a frame-to-frame flicker with no net
   * effect. */
  private readonly handedness: number;

  /** How far from a wall the push starts — the caller (`useFishSteering.ts`)
   * derives this from the specific fish's own collider radius plus a
   * buffer, so the turn happens before the body itself is ever close
   * enough to touch the glass. A flat margin here used to undersize this
   * badly for a male Veil-tailed adult (~0.72 radius against a 0.6
   * margin), letting exactly the wall contact/jitter this behaviour exists
   * to prevent happen anyway. */
  constructor(private readonly margin: number) {
    super();
    this.handedness = Math.random() < 0.5 ? 1 : -1;
  }

  calculate(vehicle: YUKA.Vehicle, force: YUKA.Vector3): YUKA.Vector3 {
    const pushX = pushAxis(vehicle.position.x, TANK_INNER_BOUNDS.x, this.margin, STRENGTH);
    const pushY = pushAxis(vehicle.position.y, TANK_INNER_BOUNDS.y, this.margin, STRENGTH);
    const pushZ = pushAxis(vehicle.position.z, TANK_INNER_BOUNDS.z, this.margin, STRENGTH);

    // A fish approaching a wall square-on (centred on the tank's other two
    // axes) gets a push that's purely antiparallel to its own heading —
    // nothing to turn it aside. WanderBehavior is the usual source of that
    // turn, but Yuka's steering budget (SteeringManager._accumulate) stops
    // adding anything once the running force magnitude reaches
    // vehicle.maxForce, and this behaviour's own STRENGTH is deliberately
    // set to reach that cap alone at full penetration — so wander can get
    // zero contribution at exactly the moment a fish most needs it to turn
    // away. Mirroring each axis's push onto a *different* axis (cyclically:
    // Z's push nudges X, X's push nudges Y, Y's push nudges Z) adds a
    // perpendicular component to the force by construction, breaking a
    // square-on approach's symmetry directly rather than depending on
    // wander ever getting a turn.
    force.x = pushX + this.handedness * Math.abs(pushZ) * TANGENT_FRACTION;
    force.y = pushY + this.handedness * Math.abs(pushX) * TANGENT_FRACTION;
    force.z = pushZ + this.handedness * Math.abs(pushY) * TANGENT_FRACTION;
    return force;
  }
}
