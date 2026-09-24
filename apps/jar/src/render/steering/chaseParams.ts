// Pure burst-speed tuning shared by two triggers (`Fish.tsx`): chasing a
// tankmate, and an untargeted "spontaneous" burst of energy during ordinary
// active wandering — both just raise the same speed ceiling via the same
// ramp, the only difference is what starts/ends them. Split out (same
// rationale as `steeringWeights.ts`) so all of it is unit-testable without a
// Yuka vehicle or `useFrame` loop. See `docs/architecture/3d-engine.md`
// §4.1's chase-bursts paragraph.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { Personality } from '../../domain/protocol/generated/Personality';

/** How close a chaser's collider surface has to get to its target's before
 * the chase ends "caught," rather than timing out (`CHASE_MAX_SEC`,
 * `Fish.tsx`) — a gap between the two colliders' own forward/length
 * half-extents, not a raw centre-to-centre distance: an adult pair's
 * length half-extents (`fishCollider.ts`'s `colliderHalfExtentsFor`, up to
 * ~0.72 each for a male Veil) physically can't get their centres closer
 * than the sum of both, so a flat centre-distance threshold this small
 * could never trigger for any adult pair. Chosen small — this is "close
 * enough to count as touching," not a generous catch radius; the chase
 * concludes right around actual contact,
 * which is also roughly where `BASE_SEPARATION_RADIUS`
 * (`steeringParams.ts`) would start pushing the two fish apart anyway. */
export const CHASE_CAUGHT_SURFACE_GAP = 0.15;

/** How far away a tankmate can be and still be considered a chase target —
 * a fish across the whole tank shouldn't suddenly beeline for one it can
 * barely see. */
export const CHASE_TARGET_RADIUS = 2.5;

/** A chase that hasn't caught its target by this long gives up — keeps a
 * burst reading as a short, lively moment rather than a sustained sprint. */
export const CHASE_MAX_SEC = 5;

/** How long a fish keeps excluding its previous chase target
 * (`selectChaseTarget`'s `excludedId`) after a chase ends, before that
 * exclusion clears — a brief anti-ping-pong cooldown, not a permanent ban.
 * In a two-fish tank especially, never clearing this would make the one
 * possible chase target permanently ineligible after the first chase,
 * turning the advertised occasional behaviour into a one-shot. Comfortably
 * longer than `CHASE_MAX_SEC` so a fish doesn't immediately re-target the
 * tankmate it just gave up on, comfortably shorter than the 8-15s roll
 * interval (`Fish.tsx`'s `ROLL_MIN_MS`/`ROLL_MAX_MS`) so the exclusion is
 * usually gone well before the next roll that could act on it. */
export const CHASE_EXCLUSION_COOLDOWN_SEC = 10;

const LOW_MOOD_THRESHOLD = 33;
const HIGH_MOOD_THRESHOLD = 85;
const BASE_CHASE_CHANCE = 0.12;

/** Chance (0-1) a given roll starts a chase — same per-personality/mood
 * table style as `steeringParamsFor`/`animationMulFor`
 * (`steeringParams.ts`), reusing `animationMulFor`'s own low/high mood
 * thresholds so "a fish with a spring in its step" means the same thing in
 * both places. */
export function chaseChanceFor(personality: Personality, mood: number): number {
  let chance = BASE_CHASE_CHANCE;

  switch (personality) {
    case 'Bold':
      chance = 0.22;
      break;
    case 'Curious':
    case 'Dramatic':
      chance = 0.18;
      break;
    case 'Greedy':
      chance = 0.12;
      break;
    case 'Shy':
      chance = 0.06;
      break;
    case 'Sleepy':
      chance = 0.04;
      break;
  }

  if (mood < LOW_MOOD_THRESHOLD) {
    chance *= 0.25;
  } else if (mood > HIGH_MOOD_THRESHOLD) {
    chance *= 1.25;
  }

  return Math.min(1, Math.max(0, chance));
}

/** Chance (0-1) a given roll starts a *spontaneous* burst — a short,
 * untargeted spurt of speed during ordinary active wandering, nothing to do
 * with chasing a tankmate. Lower than `chaseChanceFor` across the board:
 * "occasionally feels energetic" should read as rarer than "occasionally
 * chases something," or the two would blur together. Same personality/mood
 * shape as `chaseChanceFor` for the same reason that one matches
 * `animationMulFor`. */
const BASE_BURST_CHANCE = 0.1;

export function burstChanceFor(personality: Personality, mood: number): number {
  let chance = BASE_BURST_CHANCE;

  switch (personality) {
    case 'Bold':
      chance = 0.18;
      break;
    case 'Dramatic':
      chance = 0.16;
      break;
    case 'Curious':
      chance = 0.14;
      break;
    case 'Greedy':
      chance = 0.1;
      break;
    case 'Shy':
      chance = 0.05;
      break;
    case 'Sleepy':
      chance = 0.03;
      break;
  }

  if (mood < LOW_MOOD_THRESHOLD) {
    chance *= 0.25;
  } else if (mood > HIGH_MOOD_THRESHOLD) {
    chance *= 1.25;
  }

  return Math.min(1, Math.max(0, chance));
}

/** A short, untargeted burst rolled by `burstChanceFor` gets this long before
 * ramping back down (`Fish.tsx`) — shorter than `CHASE_MAX_SEC`: there's no
 * target to catch or lose, just a brief spurt of energy, so it shouldn't
 * read as a sustained sprint either. */
export const SPONTANEOUS_BURST_SEC = 2;

/** Per-personality range for how far above `maxSpeedFor(energy)`
 * (`steeringParams.ts`) a burst's speed ceiling is temporarily raised —
 * rolled fresh (not a fixed per-personality number) each time a burst starts
 * (chase or spontaneous, `Fish.tsx`), so repeated bursts from the same fish
 * don't all cap out identically. Energy already scales the *base* ceiling
 * this multiplies, so a tired fish bursts to a lower absolute speed
 * automatically; every range tops out comfortably under 2.0 so even a
 * full-energy Bold fish's peak burst speed stays under 4. */
const BURST_MULTIPLIER_RANGE: Record<Personality, { min: number; max: number }> = {
  Bold: { min: 1.4, max: 1.95 },
  Dramatic: { min: 1.3, max: 1.85 },
  Curious: { min: 1.2, max: 1.65 },
  Greedy: { min: 1.15, max: 1.55 },
  Shy: { min: 1.1, max: 1.45 },
  Sleepy: { min: 1.05, max: 1.3 },
};

export function burstMultiplierFor(personality: Personality): number {
  const { min, max } = BURST_MULTIPLIER_RANGE[personality];
  return min + Math.random() * (max - min);
}

/** ~0.33s to reach a burst (a lunge) — deliberately faster than the ~0.7s
 * glide back down (`BURST_RAMP_DOWN_RATE`): an instant ceiling *drop* while
 * still moving at burst speed would shear velocity in one frame, the same
 * snap class `BEHAVIOR_WEIGHT_RAMP_RATE` (`steeringWeights.ts`) exists to
 * prevent. */
export const BURST_RAMP_UP_RATE = 3;
export const BURST_RAMP_DOWN_RATE = 1.5;

/** Moves `current` a framerate-independent step toward `target` — same
 * exponential-approach shape as `rampWeights` (`steeringWeights.ts`), with
 * asymmetric up/down rates instead of one shared rate. */
export function rampBurstMultiplier(
  current: number,
  target: number,
  delta: number,
  rampUpRate: number = BURST_RAMP_UP_RATE,
  rampDownRate: number = BURST_RAMP_DOWN_RATE,
): number {
  const rate = target > current ? rampUpRate : rampDownRate;
  const t = 1 - Math.exp(-rate * delta);
  return current + (target - current) * t;
}

/** How far a bursting fish's *actual* speed is beyond its own normal
 * (energy-only, no burst) ceiling — 0 at or below that ceiling, growing
 * toward roughly `burstMultiplierFor(personality) - 1` at full burst
 * (chase or spontaneous). Driven by real speed rather than mode, so it
 * decays naturally as the burst ramps down instead of needing its own
 * separate fade. `FishModel.tsx` uses this to make the tail beat visibly
 * harder during a burst, not just faster — without it, normalizing
 * `speedNorm` against the raised ceiling would clamp right back to the same
 * 0-1 range a normal cruise already reaches, and a burst would look
 * identical to top gear at rest. */
export function burstOverdrive(speed: number, baseCeiling: number): number {
  return Math.max(0, speed / baseCeiling - 1);
}
