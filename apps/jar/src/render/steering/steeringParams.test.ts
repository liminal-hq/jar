// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { animationMulFor } from './steeringParams';

const NEUTRAL_MOOD = 66;

describe('animationMulFor', () => {
  it('leaves neutral-mood Shy/Curious/Greedy fish unmultiplied', () => {
    for (const personality of ['Shy', 'Curious', 'Greedy'] as const) {
      expect(animationMulFor(personality, NEUTRAL_MOOD)).toEqual({ freqMul: 1, ampMul: 1 });
    }
  });

  it('bumps Dramatic amplitude only', () => {
    expect(animationMulFor('Dramatic', NEUTRAL_MOOD)).toEqual({ freqMul: 1, ampMul: 1.25 });
  });

  it('slows Sleepy frequency only', () => {
    expect(animationMulFor('Sleepy', NEUTRAL_MOOD)).toEqual({ freqMul: 0.8, ampMul: 1 });
  });

  it('quickens Bold frequency only', () => {
    expect(animationMulFor('Bold', NEUTRAL_MOOD)).toEqual({ freqMul: 1.1, ampMul: 1 });
  });

  it('droops both frequency and amplitude for low mood', () => {
    const { freqMul, ampMul } = animationMulFor('Shy', 10);
    expect(freqMul).toBeCloseTo(0.85, 5);
    expect(ampMul).toBeCloseTo(0.85, 5);
  });

  it('lifts amplitude only for high mood', () => {
    const { freqMul, ampMul } = animationMulFor('Shy', 95);
    expect(freqMul).toBeCloseTo(1, 5);
    expect(ampMul).toBeCloseTo(1.1, 5);
  });

  it('stacks personality and mood multipliers rather than one overriding the other', () => {
    const { freqMul, ampMul } = animationMulFor('Dramatic', 10);
    expect(freqMul).toBeCloseTo(0.85, 5);
    expect(ampMul).toBeCloseTo(1.25 * 0.85, 5);
  });

  it('treats the mood thresholds as exclusive of the neutral band', () => {
    expect(animationMulFor('Shy', 33)).toEqual({ freqMul: 1, ampMul: 1 }); // not < 33
    expect(animationMulFor('Shy', 85)).toEqual({ freqMul: 1, ampMul: 1 }); // not > 85
  });
});
