// Tests for bladeSwayAngle's per-height bend envelope.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import {
  bladeSwayAngle,
  DISTURBANCE_MAX_ANGLE,
  DISTURBANCE_RADIUS,
  plantDisturbanceAngle,
  SWAY_AMPLITUDE,
} from './plantSway';

function maxAbsOverTime(tt: number, phase: number): number {
  let max = 0;
  for (let t = 0; t < 20; t += 0.01) {
    max = Math.max(max, Math.abs(bladeSwayAngle(tt, t, phase)));
  }
  return max;
}

describe('bladeSwayAngle', () => {
  it('is always zero at the base (tt=0), regardless of time or phase', () => {
    // toBeCloseTo rather than toBe: `0 * sin(...)` can land on -0, which
    // fails a strict Object.is(-0, 0) check despite being numerically zero.
    for (const t of [0, 1.3, 7, 15.9]) {
      expect(bladeSwayAngle(0, t, 0)).toBeCloseTo(0, 10);
      expect(bladeSwayAngle(0, t, 2.4)).toBeCloseTo(0, 10);
    }
  });

  it("the tip's swing envelope reaches the full SWAY_AMPLITUDE", () => {
    expect(maxAbsOverTime(1, 0)).toBeCloseTo(SWAY_AMPLITUDE, 2);
  });

  it("a mid-blade point's swing envelope is proportionally smaller than the tip's", () => {
    const mid = maxAbsOverTime(0.5, 0);
    const tip = maxAbsOverTime(1, 0);
    expect(mid).toBeCloseTo(tip * 0.5, 2);
  });

  it('two different phases produce different instantaneous angles at the same tt/t', () => {
    const a = bladeSwayAngle(0.8, 3, 0);
    const b = bladeSwayAngle(0.8, 3, Math.PI / 2);
    expect(a).not.toBeCloseTo(b, 5);
  });

  it('the per-height stagger shifts phase, not just amplitude: angle is not simply proportional to tt alone', () => {
    // Without SWAY_PHASE_LAG, angle/tt would be identical at every tt (just
    // SWAY_AMPLITUDE * sin(t * SWAY_FREQUENCY + phase)) — the stagger term
    // makes it genuinely vary with tt instead.
    const t = 3;
    const ratioShallow = bladeSwayAngle(0.3, t, 0) / 0.3;
    const ratioDeep = bladeSwayAngle(0.9, t, 0) / 0.9;
    expect(ratioShallow).not.toBeCloseTo(ratioDeep, 3);
  });
});

describe('plantDisturbanceAngle', () => {
  it('is zero at or beyond the disturbance radius', () => {
    expect(plantDisturbanceAngle(0.2, DISTURBANCE_RADIUS)).toBe(0);
    expect(plantDisturbanceAngle(0.2, DISTURBANCE_RADIUS + 1)).toBe(0);
  });

  it('reaches the full DISTURBANCE_MAX_ANGLE right at distance 0', () => {
    expect(Math.abs(plantDisturbanceAngle(0.2, 0))).toBeCloseTo(DISTURBANCE_MAX_ANGLE, 5);
  });

  it('grows as the fish gets closer', () => {
    const far = Math.abs(plantDisturbanceAngle(0.2, DISTURBANCE_RADIUS * 0.8));
    const near = Math.abs(plantDisturbanceAngle(0.2, DISTURBANCE_RADIUS * 0.2));
    expect(near).toBeGreaterThan(far);
  });

  it('leans away from whichever side the fish is on', () => {
    const fishOnRight = plantDisturbanceAngle(0.3, 0.1);
    const fishOnLeft = plantDisturbanceAngle(-0.3, 0.1);
    expect(Math.sign(fishOnRight)).toBe(-1);
    expect(Math.sign(fishOnLeft)).toBe(1);
  });
});
