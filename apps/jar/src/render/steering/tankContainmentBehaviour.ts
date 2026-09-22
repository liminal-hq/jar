// Anticipatory wall-avoidance for fish — steers a vehicle back toward the
// tank's centre once it's within `MARGIN` of any wall, rather than relying
// purely on the physical `CuboidCollider` walls (`AquariumEnvironment.tsx`)
// to correct a bad heading after the fact. Without this, `WanderBehavior`
// keeps commanding fish toward the glass (it has no notion of the tank's
// bounds at all), and the resulting fight between the commanded direction
// and the physical collision response is a real source of visible jitter
// right at the walls.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as YUKA from 'yuka';

import { TANK_INNER_BOUNDS } from '../physics/coordinates';

/** How far from a wall the push starts — comfortably wider than a fish's
 * own collider radius (`Fish.tsx`'s `colliderRadiusFor`, up to ~0.72 for a
 * male Veil-tailed adult) so the turn happens before the body itself is
 * ever close enough to touch the glass. */
const MARGIN = 0.6;

/** Must be able to out-vote `WanderBehavior`'s own clamped force
 * (`vehicle.maxForce = 3`, `useFishSteering.ts`) at full penetration, or a
 * fish committed to wandering straight at the glass would still win. */
const STRENGTH = 4;

function pushAxis(position: number, bound: number, margin: number, strength: number): number {
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

export class TankContainmentBehaviour extends YUKA.SteeringBehavior {
  calculate(vehicle: YUKA.Vehicle, force: YUKA.Vector3): YUKA.Vector3 {
    force.x = pushAxis(vehicle.position.x, TANK_INNER_BOUNDS.x, MARGIN, STRENGTH);
    force.y = pushAxis(vehicle.position.y, TANK_INNER_BOUNDS.y, MARGIN, STRENGTH);
    force.z = pushAxis(vehicle.position.z, TANK_INNER_BOUNDS.z, MARGIN, STRENGTH);
    return force;
  }
}
