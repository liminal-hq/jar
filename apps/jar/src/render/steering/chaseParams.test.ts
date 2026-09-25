// Tests for burst-speed tuning: chase/burst trigger chances, the randomized
// burst multiplier, the asymmetric ramp, and the overdrive animation term.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import {
  burstChanceFor,
  burstMultiplierFor,
  burstOverdrive,
  chaseChanceFor,
  rampBurstMultiplier,
} from './chaseParams';

const PERSONALITIES = ['Shy', 'Greedy', 'Curious', 'Sleepy', 'Bold', 'Dramatic'] as const;

/** Mean of many draws — used to compare personalities' burst ranges without
 * pinning an exact (now randomized) value, same "roughly" pattern as the
 * Rust genetics tests (e.g. the personality-inheritance-rate test in
 * `genetics.rs`). */
function meanBurstMultiplier(personality: (typeof PERSONALITIES)[number], samples = 500): number {
  let total = 0;
  for (let i = 0; i < samples; i++) total += burstMultiplierFor(personality);
  return total / samples;
}

const NEUTRAL_MOOD = 66; // SPEC.md §5's base mood target — neither low nor high gate

describe('chaseChanceFor', () => {
  it('stays within [0, 1] for every personality across a range of moods', () => {
    const personalities = ['Shy', 'Greedy', 'Curious', 'Sleepy', 'Bold', 'Dramatic'] as const;
    for (const personality of personalities) {
      for (const mood of [0, 20, 50, 66, 90, 100]) {
        const chance = chaseChanceFor(personality, mood);
        expect(chance).toBeGreaterThanOrEqual(0);
        expect(chance).toBeLessThanOrEqual(1);
      }
    }
  });

  it('orders personalities: Bold highest, Sleepy and Shy below the base rate', () => {
    const bold = chaseChanceFor('Bold', NEUTRAL_MOOD);
    const greedy = chaseChanceFor('Greedy', NEUTRAL_MOOD);
    const sleepy = chaseChanceFor('Sleepy', NEUTRAL_MOOD);
    const shy = chaseChanceFor('Shy', NEUTRAL_MOOD);

    expect(bold).toBeGreaterThan(greedy);
    expect(sleepy).toBeLessThan(greedy);
    expect(shy).toBeLessThan(greedy);
  });

  it('a low mood quarters the chance relative to neutral', () => {
    const neutral = chaseChanceFor('Curious', NEUTRAL_MOOD);
    const low = chaseChanceFor('Curious', 20);
    expect(low).toBeCloseTo(neutral * 0.25, 5);
  });

  it('a high mood raises the chance above neutral', () => {
    const neutral = chaseChanceFor('Curious', NEUTRAL_MOOD);
    const high = chaseChanceFor('Curious', 90);
    expect(high).toBeGreaterThan(neutral);
  });
});

describe('burstChanceFor', () => {
  it('stays within [0, 1] for every personality across a range of moods', () => {
    for (const personality of PERSONALITIES) {
      for (const mood of [0, 20, 50, 66, 90, 100]) {
        const chance = burstChanceFor(personality, mood);
        expect(chance).toBeGreaterThanOrEqual(0);
        expect(chance).toBeLessThanOrEqual(1);
      }
    }
  });

  it('orders personalities: Bold highest, Sleepy and Shy below the base rate', () => {
    const bold = burstChanceFor('Bold', NEUTRAL_MOOD);
    const greedy = burstChanceFor('Greedy', NEUTRAL_MOOD);
    const sleepy = burstChanceFor('Sleepy', NEUTRAL_MOOD);
    const shy = burstChanceFor('Shy', NEUTRAL_MOOD);

    expect(bold).toBeGreaterThan(greedy);
    expect(sleepy).toBeLessThan(greedy);
    expect(shy).toBeLessThan(greedy);
  });

  it('is lower than chaseChanceFor for every personality at neutral mood', () => {
    // A "little burst of energy" should read as rarer than "chasing
    // something," or the two would blur together.
    for (const personality of PERSONALITIES) {
      expect(burstChanceFor(personality, NEUTRAL_MOOD)).toBeLessThan(
        chaseChanceFor(personality, NEUTRAL_MOOD),
      );
    }
  });
});

describe('burstMultiplierFor', () => {
  // [min, max) mirroring chaseParams.ts's BURST_MULTIPLIER_RANGE — every
  // range tops out under 2.0 so even a full-energy Bold fish's peak burst
  // speed (`maxSpeedFor(100)` is 2.0) stays under 4.
  const RANGE: Record<(typeof PERSONALITIES)[number], [number, number]> = {
    Shy: [1.1, 1.45],
    Greedy: [1.15, 1.55],
    Curious: [1.2, 1.65],
    Sleepy: [1.05, 1.3],
    Bold: [1.4, 1.95],
    Dramatic: [1.3, 1.85],
  };

  it('stays within its personality range, at least 1, and under 2 across many draws', () => {
    for (const personality of PERSONALITIES) {
      const [min, max] = RANGE[personality];
      for (let i = 0; i < 200; i++) {
        const m = burstMultiplierFor(personality);
        expect(m).toBeGreaterThanOrEqual(min);
        expect(m).toBeLessThan(max);
        expect(m).toBeLessThan(2);
      }
    }
  });

  it('draws different values across calls rather than a fixed constant', () => {
    const draws = new Set(Array.from({ length: 20 }, () => burstMultiplierFor('Bold')));
    expect(draws.size).toBeGreaterThan(1);
  });

  it('gives Bold and Dramatic a bigger mean burst than Greedy, and Sleepy the smallest', () => {
    const bold = meanBurstMultiplier('Bold');
    const dramatic = meanBurstMultiplier('Dramatic');
    const greedy = meanBurstMultiplier('Greedy');
    const sleepy = meanBurstMultiplier('Sleepy');

    expect(bold).toBeGreaterThan(greedy);
    expect(dramatic).toBeGreaterThan(greedy);
    expect(sleepy).toBeLessThan(greedy);
  });
});

describe('rampBurstMultiplier', () => {
  it('moves partway toward the target on a normal frame, never overshooting', () => {
    const next = rampBurstMultiplier(1, 1.6, 0.016);
    expect(next).toBeGreaterThan(1);
    expect(next).toBeLessThan(1.6);
  });

  it('is framerate-independent: many small steps land near one big step covering the same total time', () => {
    let stepped = 1;
    const smallDelta = 0.01;
    for (let i = 0; i < 20; i++) {
      stepped = rampBurstMultiplier(stepped, 1.6, smallDelta);
    }
    const jumped = rampBurstMultiplier(1, 1.6, 20 * smallDelta);
    expect(stepped).toBeCloseTo(jumped, 2);
  });

  it('ramps up faster than it ramps down (asymmetric rates)', () => {
    const rampedUp = rampBurstMultiplier(1, 1.6, 0.2);
    const upFraction = (rampedUp - 1) / (1.6 - 1);

    const rampedDown = rampBurstMultiplier(1.6, 1, 0.2);
    const downFraction = (1.6 - rampedDown) / (1.6 - 1);

    expect(upFraction).toBeGreaterThan(downFraction);
  });

  it('converges to the target after many steps', () => {
    let current = 1;
    for (let i = 0; i < 300; i++) {
      current = rampBurstMultiplier(current, 1.6, 0.016);
    }
    expect(current).toBeCloseTo(1.6, 3);
  });

  it('does not move at all with a zero delta', () => {
    expect(rampBurstMultiplier(1.2, 1.6, 0)).toBe(1.2);
  });
});

describe('burstOverdrive', () => {
  it('is zero at or below the base ceiling', () => {
    expect(burstOverdrive(1.0, 1.0)).toBe(0);
    expect(burstOverdrive(0.5, 1.0)).toBe(0);
  });

  it('is never negative', () => {
    expect(burstOverdrive(0, 1.0)).toBeGreaterThanOrEqual(0);
  });

  it('reads about 0.6 at 1.6x the base ceiling', () => {
    expect(burstOverdrive(1.6, 1.0)).toBeCloseTo(0.6, 5);
  });
});
