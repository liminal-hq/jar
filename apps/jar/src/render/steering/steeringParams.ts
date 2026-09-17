// Per-`Personality` steering parameter table — `docs/architecture/3d-engine.md`
// §4.1's trait-modulation table, re-expressed as numbers `FishController`
// applies to a `YUKA.Vehicle`'s behaviors. Population-dependent effects
// (shy/curious separation radius) take the current living population as an
// argument rather than baking it in, since that count changes at runtime.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { Personality } from '../../domain/protocol/generated/Personality';

export const BASE_WANDER_RADIUS = 1.2;
export const BASE_SEPARATION_RADIUS = 0.8;
export const BASE_WANDER_JITTER = 0.6;

export interface SteeringParams {
  wanderRadius: number;
  separationRadius: number;
  wanderJitter: number;
  /** Extra chance (0-1) of a zero-length pause between wander-circle
   * updates — sleepy fish pause more (SPEC.md §5). */
  pauseChance: number;
}

export function steeringParamsFor(
  personality: Personality,
  livingPopulation: number,
): SteeringParams {
  const params: SteeringParams = {
    wanderRadius: BASE_WANDER_RADIUS,
    separationRadius: BASE_SEPARATION_RADIUS,
    wanderJitter: BASE_WANDER_JITTER,
    pauseChance: 0,
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
