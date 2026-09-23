// Tests for thrustMultiplierFor's pulse shape and its mean-preserving
// normalization.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { thrustMultiplierFor } from './thrustEnvelope';

describe('thrustMultiplierFor', () => {
  it('is zero only at instantaneous stroke-reversal points, not a sustained window', () => {
    expect(thrustMultiplierFor(0)).toBeCloseTo(0, 10);
    expect(thrustMultiplierFor(Math.PI)).toBeCloseTo(0, 10);
    expect(thrustMultiplierFor(Math.PI * 2)).toBeCloseTo(0, 10);
    // Immediately either side of a reversal, thrust is already back up —
    // never a dead half-cycle for damping to coast through unopposed.
    expect(thrustMultiplierFor(0.05)).toBeGreaterThan(0);
    expect(thrustMultiplierFor(Math.PI - 0.05)).toBeGreaterThan(0);
    expect(thrustMultiplierFor(Math.PI + 0.05)).toBeGreaterThan(0);
  });

  it('is positive through the entire cycle except at the reversal points', () => {
    for (const phase of [0.5, 1, 2, 3, 4, 5, 6]) {
      expect(thrustMultiplierFor(phase)).toBeGreaterThan(0);
    }
  });

  it('peaks once per half-stroke, at π/2 and 3π/2', () => {
    const peakFront = thrustMultiplierFor(Math.PI / 2);
    const peakBack = thrustMultiplierFor((Math.PI * 3) / 2);
    expect(peakFront).toBeCloseTo(peakBack, 10);
    for (const phase of [0.1, 1, 2, 3, 4, 5, 6]) {
      expect(thrustMultiplierFor(phase)).toBeLessThanOrEqual(peakFront + 1e-9);
    }
  });

  it('has a time-average of ~1 across a full cycle, preserving mean thrust', () => {
    const samples = 10_000;
    let sum = 0;
    for (let i = 0; i < samples; i++) {
      sum += thrustMultiplierFor((i / samples) * Math.PI * 2);
    }
    expect(sum / samples).toBeCloseTo(1, 2);
  });
});
