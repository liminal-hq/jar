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

/** The single avoidance behaviours' own `STRENGTH` (`tankContainmentBehaviour.ts`,
 * `castleAvoidanceBehaviour.ts`) — kept as its own named constant here
 * (rather than left as a bare `4` folded into `PILOTED_MAX_FORCE` below)
 * specifically so it stays *searchable*: if either avoidance behaviour's
 * own `STRENGTH` ever changes, this is the value that has to change with
 * it, or `PILOTED_MAX_FORCE`'s own "always leave a single avoidance source
 * its full natural push" guarantee quietly stops holding. Not imported
 * from either file directly to avoid coupling this debug tool's module
 * graph to both avoidance behaviours' internals for one shared number;
 * revisit that choice if a third place ever needs it too. */
const AVOIDANCE_STRENGTH = 4;

/** How hard the player's own held-key input pushes once a *single*
 * avoidance source (wall or castle) is fully engaged — not, despite the
 * name, the magnitude `ManualPilotBehaviour.calculate()` actually
 * requests; see `PILOTED_MAX_FORCE` and its own comment for why. Yuka's
 * `SteeringManager` accumulates each behaviour's force in insertion order
 * against `vehicle.maxForce` (`_accumulate`'s real mechanics, verified
 * against the Yuka source), and this is what's left over for the pilot
 * once `containment`/`castleAvoidance` (inserted first, and *not* silenced
 * by piloting) have claimed their own full share of the widened budget
 * below.
 *
 * This used to *be* the requested magnitude, on the theory that matching
 * `vehicle.maxForce` itself (3) would "win" it after avoidance's share —
 * live testing (driving a fish toward the glass) showed that reasoning was
 * incomplete: `containment`'s own requested magnitude ramps linearly up to
 * `AVOIDANCE_STRENGTH` and gets clamped to whatever's left of the shared
 * budget, so containment ALONE can claim the *entire* original 3-wide
 * budget at only 75% of the way through its margin band, not at full
 * penetration — a pilot force capped at exactly 3 could never win any
 * budget back past that mark. Widening the budget to `PILOTED_MAX_FORCE`
 * fixed that near a wall, but a second bug was hiding behind it: in open
 * water, with no avoidance competing at all, a pilot force still literally
 * capped at 3 only consumed 3 of the widened 7-unit budget, leaving 4
 * whole units unclaimed for `wander`/`separation` to keep contributing on
 * top of the player's own input — the exact "silences everything after it"
 * guarantee this file's own header claims, quietly not holding except
 * right at a wall. `ManualPilotBehaviour.calculate()` below requests
 * `PILOTED_MAX_FORCE` itself, not this constant — Yuka clips an
 * over-requested force down to whatever's actually left, the same trick
 * `containment`'s own `STRENGTH` already uses to monopolize the *un-widened*
 * budget alone — which is what makes this constant's own name true again:
 * right at a fully-engaged single wall, the clip lands the pilot back at
 * exactly this value (`PILOTED_MAX_FORCE - AVOIDANCE_STRENGTH`); in open
 * water, it claims the *entire* widened budget instead, silencing
 * `wander`/`separation`/`pursuit`/`arrive` unconditionally rather than only
 * near a wall. */
export const PILOT_STRENGTH = 3;

/** `vehicle.maxForce` while a fish is *actively* piloted (a key genuinely
 * held, `pilotInputState.ts`'s `isActivelyPiloted` — not merely selected)
 * — applied per frame in `SteeringSystem.tsx`, reverted to the normal
 * `MAX_STEERING_FORCE` the instant no key is held, so an idle piloted fish
 * still behaves exactly like an unpiloted one. Sized as a single avoidance
 * behaviour's own full request (`AVOIDANCE_STRENGTH`) plus `PILOT_STRENGTH`,
 * so a single avoidance source *always* gets its full, unclamped natural
 * push — identical to how it behaves unpiloted — while the pilot's own
 * request (see `PILOT_STRENGTH`'s comment for why it requests *this*
 * constant, not its own name) still has real budget left over to actually
 * contest it, rather than being starved out by the shared-budget clamp
 * described above. A fish squeezed by *two* maxed-out avoidance sources at
 * once (a tight corner between the glass and the castle, up to
 * `AVOIDANCE_STRENGTH * 2 = 8`) can still fully starve the pilot —
 * deliberately: that's a genuinely tight spot, not the ordinary
 * single-wall approach this tool exists to force. */
export const PILOTED_MAX_FORCE = AVOIDANCE_STRENGTH + PILOT_STRENGTH;

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

    // `PILOTED_MAX_FORCE`, not `PILOT_STRENGTH` — see `PILOT_STRENGTH`'s
    // own comment. Requesting more than could ever be left of the budget
    // is deliberate: Yuka clips it down to whatever actually remains,
    // which is exactly how `containment` itself already claims its own
    // full share regardless of what's ahead of it in the accumulation
    // order.
    force.x = thrust.x * PILOTED_MAX_FORCE;
    force.y = thrust.y * PILOTED_MAX_FORCE;
    force.z = thrust.z * PILOTED_MAX_FORCE;
    return force;
  }
}
