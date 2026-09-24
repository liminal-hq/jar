// Manual keyboard override for one fish's steering, armed from the Fish
// monitor window (`windows/FishMonitor/FishMonitorWindow.tsx`) — built to
// force the exact geometry `tankContainmentBehaviour.ts`'s square-on wall
// stall needs to reproduce on demand, and kept afterward as a small,
// permanent debug tool in its own right.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as YUKA from 'yuka';

import { getPilotDirection, getPilotedFishId } from './pilotInputState';

/** Deliberately equal to `vehicle.maxForce` (`MAX_STEERING_FORCE`,
 * `useFishSteering.ts`) — Yuka's `SteeringManager` accumulates each
 * behaviour's force in insertion order against that budget
 * (`_accumulate`'s real mechanics, verified against the Yuka source), so a
 * force this size claims whatever's left of it once `containment`/
 * `castleAvoidance` (inserted first, and *not* silenced by piloting) have
 * taken their share. That's the point on both ends: it's strong enough to
 * fully silence `wander`/`separation`/`pursuit`/`arrive` — the same
 * accumulator mechanic that already lets wall-avoidance out-vote wander,
 * now doing the "hand the AI's usual slot to the player" work for free —
 * and it's not stronger than the walls, so a piloted fish still can't be
 * forced through the glass. Don't raise this to push harder against a
 * wall; that would let piloting clip through containment instead of
 * exercising the exact budget conflict this tool exists to test. */
export const PILOT_STRENGTH = 3;

export class ManualPilotBehaviour extends YUKA.SteeringBehavior {
  constructor(private readonly critterId: number) {
    super();
  }

  calculate(vehicle: YUKA.Vehicle, force: YUKA.Vector3): YUKA.Vector3 {
    force.x = 0;
    force.y = 0;
    force.z = 0;

    if (getPilotedFishId() !== this.critterId) return force;
    const direction = getPilotDirection();
    if (direction === null) return force;

    force.x = direction.x * PILOT_STRENGTH;
    force.y = direction.y * PILOT_STRENGTH;
    force.z = direction.z * PILOT_STRENGTH;
    return force;
  }
}
