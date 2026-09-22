// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { MODE_WEIGHTS, rampWeights } from './steeringWeights';

describe('MODE_WEIGHTS', () => {
  it('gives every mode a definite 0-or-1 target for each behavior', () => {
    for (const weights of Object.values(MODE_WEIGHTS)) {
      for (const w of Object.values(weights)) {
        expect(w === 0 || w === 1).toBe(true);
      }
    }
  });

  it('only settling targets arrive', () => {
    expect(MODE_WEIGHTS.settling.arrive).toBe(1);
    expect(MODE_WEIGHTS.active.arrive).toBe(0);
    expect(MODE_WEIGHTS.paused.arrive).toBe(0);
    expect(MODE_WEIGHTS.settled.arrive).toBe(0);
  });

  it('paused keeps separation on but turns wander off, unlike active', () => {
    expect(MODE_WEIGHTS.paused).toEqual({ wander: 0, separation: 1, arrive: 0 });
    expect(MODE_WEIGHTS.active).toEqual({ wander: 1, separation: 1, arrive: 0 });
  });

  it('settled wants every ramped behavior off', () => {
    expect(MODE_WEIGHTS.settled).toEqual({ wander: 0, separation: 0, arrive: 0 });
  });
});

describe('rampWeights', () => {
  it('moves partway toward the target on a normal frame, never overshooting', () => {
    const current = { wander: 0, separation: 0, arrive: 0 };
    const target = MODE_WEIGHTS.settling; // { wander: 0, separation: 0, arrive: 1 }
    const next = rampWeights(current, target, 0.016);
    expect(next.arrive).toBeGreaterThan(0);
    expect(next.arrive).toBeLessThan(1);
    expect(next.wander).toBe(0);
    expect(next.separation).toBe(0);
  });

  it('never mutates the current or target objects', () => {
    const current = { wander: 0, separation: 1, arrive: 0 };
    const currentCopy = { ...current };
    const target = MODE_WEIGHTS.settled;
    const targetCopy = { ...target };
    rampWeights(current, target, 0.1);
    expect(current).toEqual(currentCopy);
    expect(target).toEqual(targetCopy);
  });

  it('converges to (within floating point) the target after many small steps', () => {
    let current = { wander: 1, separation: 1, arrive: 0 };
    const target = MODE_WEIGHTS.settling;
    for (let i = 0; i < 300; i++) {
      current = rampWeights(current, target, 0.016);
    }
    // 300 * 0.016s = 4.8s at the default rate=2 leaves exp(-9.6) ≈ 6.8e-5 of
    // the gap remaining — well converged, just not to full float precision.
    expect(current.wander).toBeCloseTo(0, 3);
    expect(current.separation).toBeCloseTo(0, 3);
    expect(current.arrive).toBeCloseTo(1, 3);
  });

  it('is framerate-independent: many small steps land near one big step covering the same total time', () => {
    const target = MODE_WEIGHTS.settling;
    let stepped = { wander: 0, separation: 0, arrive: 0 };
    const smallDelta = 0.01;
    for (let i = 0; i < 20; i++) {
      stepped = rampWeights(stepped, target, smallDelta);
    }
    const jumped = rampWeights({ wander: 0, separation: 0, arrive: 0 }, target, 20 * smallDelta);
    expect(stepped.arrive).toBeCloseTo(jumped.arrive, 2);
  });

  it('does not move at all with a zero delta', () => {
    const current = { wander: 0.4, separation: 0.6, arrive: 0.1 };
    const next = rampWeights(current, MODE_WEIGHTS.active, 0);
    expect(next).toEqual(current);
  });

  it('ramps symmetrically back down when the target reverses mid-flight', () => {
    let current = rampWeights({ wander: 1, separation: 1, arrive: 0 }, MODE_WEIGHTS.settling, 0.3);
    expect(current.arrive).toBeGreaterThan(0);
    const arriveAfterRampingUp = current.arrive;
    current = rampWeights(current, MODE_WEIGHTS.active, 0.3);
    expect(current.arrive).toBeLessThan(arriveAfterRampingUp);
  });
});
