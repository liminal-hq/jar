// Pure chase-target selection — `Fish.tsx` builds the candidate list from
// `useSteeringRegistry()` each roll and hands it here, so the selection
// logic itself (nearest eligible tankmate) is unit-testable without a Yuka
// vehicle or the steering registry.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { CritterId } from '../../domain/protocol/generated/CritterId';
import type { FishMotionMode } from './motionState';
import { CHASE_TARGET_RADIUS } from './chaseParams';

export interface ChaseCandidate {
  id: CritterId;
  distance: number;
  mode: FishMotionMode;
}

/** Picks the nearest eligible tankmate to chase, or `null` if nobody
 * qualifies — only a genuinely `'active'` fish (don't chase one that's
 * resting or already being chased elsewhere) within `CHASE_TARGET_RADIUS`,
 * excluding `excludedId` (the fish's own previous chase target, so a pair
 * doesn't immediately ping-pong back onto each other). */
export function selectChaseTarget(
  candidates: ChaseCandidate[],
  excludedId: CritterId | null,
): CritterId | null {
  let nearest: ChaseCandidate | null = null;

  for (const candidate of candidates) {
    if (candidate.mode !== 'active') continue;
    if (candidate.distance > CHASE_TARGET_RADIUS) continue;
    if (candidate.id === excludedId) continue;
    if (nearest === null || candidate.distance < nearest.distance) nearest = candidate;
  }

  return nearest?.id ?? null;
}
