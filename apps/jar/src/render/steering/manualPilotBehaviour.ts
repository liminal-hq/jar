// Manual keyboard override for one fish's steering, armed from the Fish
// monitor window (`windows/FishMonitor/FishMonitorWindow.tsx`) — built to
// force the exact geometry `tankContainmentBehaviour.ts`'s square-on wall
// stall needs to reproduce on demand, and kept afterward as a small,
// permanent debug tool in its own right.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as YUKA from 'yuka';

import { getPilotedFishId, getPilotThrust } from './pilotInputState';

/** How hard the player's own held-key input pushes — Yuka's
 * `SteeringManager` accumulates each behaviour's force in insertion order
 * against `vehicle.maxForce` (`_accumulate`'s real mechanics, verified
 * against the Yuka source), so this is what claims whatever's left of that
 * budget once `containment`/`castleAvoidance` (inserted first, and *not*
 * silenced by piloting) have taken their share — the same accumulator
 * mechanic that already lets wall-avoidance out-vote `wander` silences
 * `wander`/`separation`/`pursuit`/`arrive` here too, for free.
 *
 * This used to equal `vehicle.maxForce` itself (3), on the theory that
 * matching the whole budget would "win" it after avoidance's share — live
 * testing (driving a fish toward the glass) showed that reasoning was
 * wrong: `containment`'s own requested magnitude ramps linearly up to its
 * `STRENGTH` (4, exceeding the 3-wide budget on purpose, `tankContainment
 * Behaviour.ts`) and gets clamped to whatever's left of the shared budget —
 * which means containment ALONE can claim the *entire* budget once its own
 * push reaches magnitude 3, at only 75% of the way through its margin band
 * (3/4), not at full penetration. Past that point *nothing* added after it
 * gets any share, regardless of how large its own requested magnitude is —
 * so a pilot force capped at exactly 3 could never win any budget back
 * past that 75% mark, no matter how long a key was held. A piloted fish
 * visibly couldn't get anywhere near as close to the glass (or fit behind
 * the castle) as one clearly still fits. See `PILOTED_MAX_FORCE` below for
 * the actual fix — this constant itself didn't need to change, the shared
 * budget it competes for did. */
export const PILOT_STRENGTH = 3;

/** `vehicle.maxForce` while a fish is *actively* piloted (a key genuinely
 * held, `pilotInputState.ts`'s `isActivelyPiloted` — not merely selected)
 * — applied per frame in `SteeringSystem.tsx`, reverted to the normal
 * `MAX_STEERING_FORCE` the instant no key is held, so an idle piloted fish
 * still behaves exactly like an unpiloted one. Sized as the worst single
 * avoidance behaviour's own request (`STRENGTH = 4`, shared by both
 * `TankContainmentBehaviour` and `CastleAvoidanceBehaviour`) plus
 * `PILOT_STRENGTH`, so a single avoidance source *always* gets its full,
 * unclamped natural push — identical to how it behaves unpiloted — while
 * `PILOT_STRENGTH` still has real budget left over to actually contest it,
 * rather than being starved out by the shared-budget clamp described
 * above. A fish squeezed by *two* maxed-out avoidance sources at once (a
 * tight corner between the glass and the castle, up to `4 + 4 = 8`) can
 * still fully starve the pilot — deliberately: that's a genuinely tight
 * spot, not the ordinary single-wall approach this tool exists to force. */
export const PILOTED_MAX_FORCE = 4 + PILOT_STRENGTH;

export class ManualPilotBehaviour extends YUKA.SteeringBehavior {
  constructor(private readonly critterId: number) {
    super();
  }

  // Deliberately no yaw math and no use of the `delta` Yuka passes as a
  // third argument here — `pilotInputState.ts`'s `advancePilotYaw` owns
  // that, from `SteeringSystem.tsx`'s `useFrame`, which always runs. This
  // `calculate()` call itself is not guaranteed to: Yuka's
  // `SteeringManager._calculateByOrder` stops calling any further
  // behaviours the instant an earlier one's force exhausts
  // `vehicle.maxForce` (`_accumulate(force) === false` short-circuits the
  // whole loop), which a maxed-out avoidance corner can do before this
  // behaviour is ever reached — turning would silently stall some frames
  // if it depended on `calculate()` running every one of them.
  calculate(vehicle: YUKA.Vehicle, force: YUKA.Vector3): YUKA.Vector3 {
    force.x = 0;
    force.y = 0;
    force.z = 0;

    if (getPilotedFishId() !== this.critterId) return force;
    const thrust = getPilotThrust();
    if (thrust === null) return force;

    force.x = thrust.x * PILOT_STRENGTH;
    force.y = thrust.y * PILOT_STRENGTH;
    force.z = thrust.z * PILOT_STRENGTH;
    return force;
  }
}
