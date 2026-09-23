// Per-`Personality` steering parameter table — `docs/architecture/3d-engine.md`
// §4.1's trait-modulation table, re-expressed as numbers `FishController`
// applies to a `YUKA.Vehicle`'s behaviors. Population-dependent effects
// (shy/curious separation radius) take the current living population as an
// argument rather than baking it in, since that count changes at runtime.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { Personality } from '../../domain/protocol/generated/Personality';

// Wander circle sized relative to the tank's own 6x4x3 world-unit volume
// (`coordinates.ts`) — 0.8 keeps the widest single-update turn (with
// `WANDER_DISTANCE`, `useFishSteering.ts`) to roughly `atan(0.8/1.6) ≈ 27°`,
// a meander rather than a beeline. This used to be 1.2 with Yuka's own
// unset `wander.distance` defaulting to 5 (bigger than the tank itself) —
// the dominant cause of "wild" swimming; see `useFishSteering.ts`'s own
// comment on `WANDER_DISTANCE` for the other half of that fix.
export const BASE_WANDER_RADIUS = 0.8;
/** How close two fish can drift before `SeparationBehavior` starts pushing
 * them apart — trimmed from an original `0.8`, comfortably larger than the
 * sum of even two adult Veil males' own collider radii (~1.45 combined),
 * which meant the steering-level "personal space" bubble was doing all the
 * spacing work well before either fish's actual body was anywhere close to
 * the other's. Only a starting point, not the real floor: `useFishSteering.ts`
 * still clamps the vehicle's actual `neighborhoodRadius` up to at least this
 * fish's own two-body clearance, so separation never goes fully silent
 * before a pair's colliders would already be touching. */
export const BASE_SEPARATION_RADIUS = 0.4;
export const BASE_WANDER_JITTER = 0.6;
/** Every personality gets some chance of a brief pause between wander
 * cycles, not just Sleepy — otherwise the idle/rest animation state
 * (`FishModel.tsx`) would only ever show up at night. */
export const BASE_PAUSE_CHANCE = 0.08;

export interface SteeringParams {
  wanderRadius: number;
  separationRadius: number;
  wanderJitter: number;
  /** Extra chance (0-1) of a zero-length pause between wander-circle
   * updates — sleepy fish pause more (SPEC.md §5). */
  pauseChance: number;
}

const BASE_MAX_SPEED = 1.0;
const ENERGY_MAX_SPEED_BONUS = 1.0;

/** A fish's speed ceiling, low-energy fish topping out slower — moved here
 * (not just local to `useFishSteering.ts`) so `FishModel.tsx` can normalize
 * its own animation intensity against the same ceiling a tired fish is
 * actually capped at, not an absolute speed. */
export function maxSpeedFor(energyPercent: number): number {
  return BASE_MAX_SPEED + (energyPercent / 100) * ENERGY_MAX_SPEED_BONUS;
}

/** Small, slow ripple on top of a fish's speed ceiling — without it, Yuka's
 * own `vehicle.update()` hard-clamps velocity to `maxSpeed` every frame, so
 * a fish mid-wander sits pinned at *exactly* the same number second after
 * second (confirmed live via the fish monitor's speed readout reading a
 * flat ~1.98-2.00 continuously). This is independent of, and stacks with,
 * a chase burst's much larger mode-gated multiplier
 * (`chaseParams.ts`'s `burstMultiplierFor`) — that's a deliberate, sizeable
 * "going for something" moment; this is just ordinary texture so a normal
 * cruise doesn't read as capped at a flat number either. */
export const BREATHING_AMPLITUDE = 0.06;
/** ~7.9s period (`2π / rate`) — slow enough to read as organic variance,
 * not a jitter. */
export const BREATHING_ANGULAR_RATE = 0.8;

export function breathingMultiplier(elapsedSec: number, phaseSeed: number): number {
  return 1 + BREATHING_AMPLITUDE * Math.sin(elapsedSec * BREATHING_ANGULAR_RATE + phaseSeed);
}

export function steeringParamsFor(
  personality: Personality,
  livingPopulation: number,
): SteeringParams {
  const params: SteeringParams = {
    wanderRadius: BASE_WANDER_RADIUS,
    separationRadius: BASE_SEPARATION_RADIUS,
    wanderJitter: BASE_WANDER_JITTER,
    pauseChance: BASE_PAUSE_CHANCE,
  };

  switch (personality) {
    case 'Bold':
      params.wanderRadius *= 1.6;
      break;
    case 'Shy':
      // Mirrors the mood formula's `-3 x population` penalty — shy fish
      // keep more distance as the tank fills up.
      params.separationRadius += 0.05 * livingPopulation;
      break;
    case 'Curious':
      params.separationRadius = Math.max(0.2, params.separationRadius - 0.03 * livingPopulation);
      break;
    case 'Sleepy':
      params.pauseChance = 0.35;
      break;
    case 'Dramatic':
      params.wanderJitter *= 4;
      break;
    case 'Greedy':
      // No steering effect — SPEC.md §5's greedy penalty is mood-only.
      break;
  }

  return params;
}

export interface AnimationMultipliers {
  /** Tail-beat/flutter frequency multiplier. */
  freqMul: number;
  /** Tail-beat/flutter amplitude multiplier. */
  ampMul: number;
}

const LOW_MOOD_THRESHOLD = 33;
const HIGH_MOOD_THRESHOLD = 85;

/** Small, tasteful per-personality/mood nudges on top of `FishModel.tsx`'s
 * speed-tiered animation intensity — same per-personality table style as
 * `steeringParamsFor` above, kept as a plain pure function (personality +
 * mood in, multipliers out) so it's trivial to unit test on its own. */
export function animationMulFor(personality: Personality, mood: number): AnimationMultipliers {
  let freqMul = 1;
  let ampMul = 1;

  switch (personality) {
    case 'Dramatic':
      ampMul *= 1.25;
      break;
    case 'Sleepy':
      freqMul *= 0.8;
      break;
    case 'Bold':
      freqMul *= 1.1;
      break;
    case 'Shy':
    case 'Curious':
    case 'Greedy':
      break;
  }

  if (mood < LOW_MOOD_THRESHOLD) {
    freqMul *= 0.85;
    ampMul *= 0.85;
  } else if (mood > HIGH_MOOD_THRESHOLD) {
    ampMul *= 1.1;
  }

  return { freqMul, ampMul };
}
