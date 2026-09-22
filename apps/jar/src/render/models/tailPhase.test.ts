// Tests for advanceTailPhase's accumulation and the session-length drift
// regression it exists to prevent.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { advanceTailPhase } from './tailPhase';

describe('advanceTailPhase', () => {
  it('advances by frequency * delta', () => {
    expect(advanceTailPhase(1, 4, 0.1)).toBeCloseTo(1 + 4 * 0.1, 10);
  });

  it('wraps modulo 2π rather than growing without bound', () => {
    const phase = advanceTailPhase(Math.PI * 2 - 0.05, 4, 0.1);
    expect(phase).toBeCloseTo(0.35, 5);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(Math.PI * 2);
  });

  it('advances by only the current step, regardless of elapsed session length', () => {
    // Reproduces the actual bug: under the old `phase = elapsedTime *
    // frequency` formula, a changing frequency late in a long session
    // produced a per-step jump proportional to elapsed time
    // (frequency + elapsedTime * dFrequency/dt), not just frequency * delta.
    // A real accumulator can't do that — each step only ever depends on
    // this step's own frequency and delta.
    const delta = 1 / 60;
    let phaseEarly = 0.7; // arbitrary starting phase, as if freshly spawned
    let phaseLate = 0.7; // same starting phase, as if hours into a session

    const frequencies = [4.0, 4.02, 3.98, 4.05, 4.01];
    for (const frequency of frequencies) {
      phaseEarly = advanceTailPhase(phaseEarly, frequency, delta);
      phaseLate = advanceTailPhase(phaseLate, frequency, delta);
    }

    // Session length never entered the calculation, so two fish that
    // started at the same phase and saw the same frequency sequence end up
    // at the same phase — whether one of them is a minute old or a day old.
    expect(phaseLate).toBeCloseTo(phaseEarly, 10);
  });

  it('handles a zero delta without changing phase', () => {
    expect(advanceTailPhase(1.23, 4, 0)).toBeCloseTo(1.23, 10);
  });
});
