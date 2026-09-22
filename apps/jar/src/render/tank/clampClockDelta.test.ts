// Tests for clampClockDelta's frame-delta capping and elapsedTime rollback.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { clampClockDelta, type DeltaClock } from './clampClockDelta';

/** A `DeltaClock` whose `getDelta` returns a scripted sequence of raw
 * (unclamped) values, one per call — stands in for `THREE.Clock` without
 * depending on real wall-clock time. */
function fakeClock(rawDeltas: number[]): DeltaClock {
  let i = 0;
  const clock: DeltaClock = {
    getDelta: () => rawDeltas[i++]!,
    elapsedTime: 0,
  };
  return clock;
}

describe('clampClockDelta', () => {
  it('passes small deltas through unchanged', () => {
    const clock = fakeClock([0.016, 0.02]);
    clampClockDelta(clock, 0.1);
    expect(clock.getDelta()).toBeCloseTo(0.016, 10);
    expect(clock.getDelta()).toBeCloseTo(0.02, 10);
  });

  it('clamps a delta above the max to exactly the max', () => {
    const clock = fakeClock([0.6]);
    clampClockDelta(clock, 0.1);
    expect(clock.getDelta()).toBe(0.1);
  });

  it('does not clamp a delta exactly at the max', () => {
    const clock = fakeClock([0.1]);
    clampClockDelta(clock, 0.1);
    expect(clock.getDelta()).toBe(0.1);
  });

  it('rolls elapsedTime back by the trimmed amount, keeping it continuous', () => {
    const clock = fakeClock([0.6]);
    clock.elapsedTime = 10;
    clampClockDelta(clock, 0.1);
    clock.getDelta();
    // 10 already includes the full 0.6s raw delta (real THREE.Clock updates
    // elapsedTime inside the same getDelta() call) — trimming 0.5s off
    // brings it back to what elapsedTime would be had this frame only
    // advanced by the clamped 0.1s.
    expect(clock.elapsedTime).toBeCloseTo(9.5, 10);
  });

  it('leaves elapsedTime untouched when not clamping', () => {
    const clock = fakeClock([0.016]);
    clock.elapsedTime = 5;
    clampClockDelta(clock, 0.1);
    clock.getDelta();
    expect(clock.elapsedTime).toBe(5);
  });

  it('clamps every call independently across repeated stalls', () => {
    const clock = fakeClock([0.5, 0.02, 0.8, 0.03]);
    clampClockDelta(clock, 0.1);
    expect(clock.getDelta()).toBe(0.1);
    expect(clock.getDelta()).toBeCloseTo(0.02, 10);
    expect(clock.getDelta()).toBe(0.1);
    expect(clock.getDelta()).toBeCloseTo(0.03, 10);
  });
});
