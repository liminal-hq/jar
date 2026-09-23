// A fish's current motion mode — shared between the steering layer
// (`useFishSteering.ts`'s `setMode`, `Fish.tsx`'s pause/night-settle/chase
// transitions, `SteeringSystem.tsx`'s velocity decay for non-self-propelled
// fish) and the animation layer (`FishModel.tsx`'s idle/rest pose), so both
// sides agree on what "the fish isn't actively swimming right now" means
// instead of each inferring it from speed alone.
//
// - `active`: wander + separation + containment, the normal cruising mix.
// - `paused`: a brief rest between wander cycles (`Sleepy`'s and every
//   personality's base `pauseChance`, `steeringParams.ts`) — everything off
//   except separation, so a paused fish still yields space.
// - `settling`: night has fallen, or a daytime "visit the favourite spot"
//   roll — arrive-only toward the favourite spot, wander and separation off,
//   per `docs/architecture/3d-engine.md` §4.1.
// - `settled`: arrived (or timed out) while settling, or a longer rest —
//   everything off.
// - `chasing`: pursuing a nearby tankmate in a short burst (`chaseParams.ts`,
//   `chaseTarget.ts`) — pursuit + separation, wander and arrive off; see
//   `docs/architecture/3d-engine.md` §4.1's chase-bursts paragraph.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

export type FishMotionMode = 'active' | 'paused' | 'settling' | 'settled' | 'chasing';

/** Whether a fish is propelling itself under its own steering forces right
 * now, as opposed to decaying toward a stop (`SteeringSystem.tsx`'s
 * `NON_ACTIVE_VELOCITY_DECAY_RATE`) — `active` and `chasing` are the only
 * two; every other mode wants the fish to coast down. */
export function isSelfPropelledMode(mode: FishMotionMode): boolean {
  return mode === 'active' || mode === 'chasing';
}
