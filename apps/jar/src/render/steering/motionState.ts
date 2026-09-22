// A fish's current motion mode — shared between the steering layer
// (`useFishSteering.ts`'s `setMode`, `Fish.tsx`'s pause/night-settle
// transitions, `SteeringSystem.tsx`'s velocity decay for non-active fish)
// and the animation layer (`FishModel.tsx`'s idle/rest pose), so both sides
// agree on what "the fish isn't actively swimming right now" means instead
// of each inferring it from speed alone.
//
// - `active`: wander + separation + containment, the normal cruising mix.
// - `paused`: a brief rest between wander cycles (`Sleepy`'s and every
//   personality's base `pauseChance`, `steeringParams.ts`) — everything off
//   except separation, so a paused fish still yields space.
// - `settling`: night has fallen — arrive-only toward the favourite spot,
//   wander and separation off, per `docs/architecture/3d-engine.md` §4.1.
// - `settled`: arrived (or timed out) while settling, or a longer rest —
//   everything off.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

export type FishMotionMode = 'active' | 'paused' | 'settling' | 'settled';
