// Tests for selectChaseTarget's nearest-eligible-candidate selection.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { CHASE_TARGET_RADIUS } from './chaseParams';
import { selectChaseTarget, type ChaseCandidate } from './chaseTarget';

describe('selectChaseTarget', () => {
  it('picks the nearest eligible candidate', () => {
    const candidates: ChaseCandidate[] = [
      { id: 1, distance: 1.5, mode: 'active' },
      { id: 2, distance: 0.8, mode: 'active' },
      { id: 3, distance: 2.0, mode: 'active' },
    ];
    expect(selectChaseTarget(candidates, null)).toBe(2);
  });

  it('skips a non-active candidate even when it is the nearest', () => {
    const candidates: ChaseCandidate[] = [
      { id: 1, distance: 0.5, mode: 'settled' },
      { id: 2, distance: 1.5, mode: 'active' },
    ];
    expect(selectChaseTarget(candidates, null)).toBe(2);
  });

  it('skips a candidate beyond CHASE_TARGET_RADIUS', () => {
    const candidates: ChaseCandidate[] = [
      { id: 1, distance: CHASE_TARGET_RADIUS + 0.1, mode: 'active' },
    ];
    expect(selectChaseTarget(candidates, null)).toBeNull();
  });

  it('skips the excluded id and picks the next-nearest instead', () => {
    const candidates: ChaseCandidate[] = [
      { id: 1, distance: 0.5, mode: 'active' },
      { id: 2, distance: 1.2, mode: 'active' },
    ];
    expect(selectChaseTarget(candidates, 1)).toBe(2);
  });

  it('returns null for an empty candidate list', () => {
    expect(selectChaseTarget([], null)).toBeNull();
  });

  it('returns null when every candidate is excluded, non-active, or too far', () => {
    const candidates: ChaseCandidate[] = [
      { id: 1, distance: 0.5, mode: 'active' },
      { id: 2, distance: 1.0, mode: 'paused' },
      { id: 3, distance: CHASE_TARGET_RADIUS + 1, mode: 'active' },
    ];
    expect(selectChaseTarget(candidates, 1)).toBeNull();
  });
});
