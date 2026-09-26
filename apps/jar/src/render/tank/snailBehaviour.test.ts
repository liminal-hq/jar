// Tests for snailBehaviour.ts's pure state machine — no R3F/Rapier
// rendering, per the plan's "pure-logic tests only" convention for this
// PR (mirrors fishCollider.test.ts's own discipline).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { isAsleep } from '../../domain/dayNight';
import { STARTLE_MAX_PROGRESS } from '../models/snailGeometry';
import {
  createInitialSnailBehaviour,
  DETACH_SINK_DURATION_SEC,
  isMoving,
  stepSnailBehaviour,
  type SnailBehaviourInput,
  type SnailBehaviourState,
} from './snailBehaviour';

const fixedRandom = (value: number) => () => value;

function baseInput(overrides: Partial<SnailBehaviourInput> = {}): SnailBehaviourInput {
  return {
    asleep: false,
    onFloor: true,
    startle: false,
    fishContact: false,
    random: fixedRandom(0.5),
    ...overrides,
  };
}

function runFor(
  state: SnailBehaviourState,
  input: SnailBehaviourInput,
  totalSec: number,
  stepSec = 0.25,
): SnailBehaviourState {
  let current = state;
  let remaining = totalSec;
  while (remaining > 0) {
    const dt = Math.min(stepSec, remaining);
    current = stepSnailBehaviour(current, input, dt);
    remaining -= dt;
  }
  return current;
}

describe('stepSnailBehaviour', () => {
  it('day seals a snail (nocturnal asleep-by-day) that starts out crawling on the floor', () => {
    const asleep = isAsleep('Snail', 'day', false);
    expect(asleep).toBe(true);

    let state = createInitialSnailBehaviour(fixedRandom(0.5));
    expect(state.mode).toBe('crawling');

    state = runFor(state, baseInput({ asleep, onFloor: true }), 10);

    expect(state.mode).toBe('sealed');
    expect(state.tuckProgress).toBe(1);
  });

  it('night wakes a sealed snail back up to crawling', () => {
    const asleep = isAsleep('Snail', 'night', false);
    expect(asleep).toBe(false);

    const sealed: SnailBehaviourState = {
      mode: 'sealed',
      elapsed: 0,
      tuckProgress: 1,
      tuckMode: 'sleep',
      nextRollSec: 0,
      pauseDurationSec: 0,
    };

    const afterOneStep = stepSnailBehaviour(sealed, baseInput({ asleep }), 0.1);
    expect(afterOneStep.mode).toBe('waking');

    const final = runFor(afterOneStep, baseInput({ asleep }), 10);
    expect(final.mode).toBe('crawling');
    expect(final.tuckProgress).toBe(0);
  });

  it('waking up mid-seal continues unsealing from where sealing had gotten to, without popping to fully sealed first', () => {
    const partiallySealed: SnailBehaviourState = {
      mode: 'settling',
      elapsed: 1.0, // partway through SEAL_DURATION_SEC (2.5s) — tuckProgress 0.4
      tuckProgress: 0.4,
      tuckMode: 'sleep',
      nextRollSec: 0,
      pauseDurationSec: 0,
    };

    const afterOneStep = stepSnailBehaviour(partiallySealed, baseInput({ asleep: false }), 0.001);

    expect(afterOneStep.mode).toBe('waking');
    // Must continue unsealing from ~0.4, never jump to 1 first.
    expect(afterOneStep.tuckProgress).toBeCloseTo(0.4, 1);
    expect(afterOneStep.tuckProgress).toBeLessThan(0.5);
  });

  it('sleep resuming mid-wake continues sealing from where waking had gotten to, without popping to fully emerged first', () => {
    const partiallyAwake: SnailBehaviourState = {
      mode: 'waking',
      elapsed: 1.0, // partway through WAKE_DURATION_SEC (2.5s) — tuckProgress 0.6
      tuckProgress: 0.6,
      tuckMode: 'sleep',
      nextRollSec: 0,
      pauseDurationSec: 0,
    };

    const afterOneStep = stepSnailBehaviour(partiallyAwake, baseInput({ asleep: true }), 0.001);

    expect(afterOneStep.mode).toBe('settling');
    // Must continue sealing from ~0.6, never jump to 0 first.
    expect(afterOneStep.tuckProgress).toBeCloseTo(0.6, 1);
    expect(afterOneStep.tuckProgress).toBeGreaterThan(0.5);
  });

  it("'active' override never seals a snail regardless of the real clock", () => {
    for (const simNight of [false, true]) {
      const asleep = isAsleep('Snail', 'active', simNight);
      expect(asleep).toBe(false);

      let state = createInitialSnailBehaviour(fixedRandom(0.9));
      state = runFor(state, baseInput({ asleep, onFloor: true }), 120, 1);

      expect(state.mode).not.toBe('settling');
      expect(state.mode).not.toBe('sealed');
      expect(state.tuckProgress).toBe(0);
    }
  });

  it('a wall-sleeper (off the floor) detaches and lands before sealing', () => {
    let state = createInitialSnailBehaviour(fixedRandom(0.5));
    const input = baseInput({ asleep: true, onFloor: false });

    state = stepSnailBehaviour(state, input, 0.1);
    expect(state.mode).toBe('detached');

    // Not yet landed: still asleep, still detached, hasn't jumped straight
    // to settling/sealed.
    state = stepSnailBehaviour(state, input, DETACH_SINK_DURATION_SEC - 0.1);
    expect(state.mode).toBe('detached');

    // Crosses the landing threshold — lands into 'settling', not 'sealed'.
    state = stepSnailBehaviour(state, input, 0.2);
    expect(state.mode).toBe('settling');

    // Only after settling's own seal ramp does it actually seal.
    state = runFor(state, input, 10);
    expect(state.mode).toBe('sealed');
  });

  it('a fish-contact event detaches from any face, floor or wall', () => {
    for (const onFloor of [true, false]) {
      const state = createInitialSnailBehaviour(fixedRandom(0.5));
      const next = stepSnailBehaviour(
        state,
        baseInput({ asleep: false, onFloor, fishContact: true }),
        0.1,
      );
      expect(next.mode).toBe('detached');
    }
  });

  it('fish contact does not re-detach a snail already mid-detach', () => {
    const detached: SnailBehaviourState = {
      mode: 'detached',
      elapsed: 0.5,
      tuckProgress: 0,
      tuckMode: 'sleep',
      nextRollSec: 0,
      pauseDurationSec: 0,
    };
    const next = stepSnailBehaviour(detached, baseInput({ fishContact: true }), 0.1);
    expect(next.mode).toBe('detached');
    expect(next.elapsed).toBeCloseTo(0.6, 5);
  });

  it('startle resumes crawling and never opens the operculum', () => {
    let state = createInitialSnailBehaviour(fixedRandom(0.5));
    state = stepSnailBehaviour(state, baseInput({ startle: true }), 0.05);
    expect(state.mode).toBe('startled');
    expect(state.tuckMode).toBe('startle');

    let sawStartle = false;
    let remaining = 5;
    while (remaining > 0 && state.mode === 'startled') {
      sawStartle = true;
      expect(state.tuckProgress).toBeLessThanOrEqual(STARTLE_MAX_PROGRESS);
      state = stepSnailBehaviour(state, baseInput(), 0.05);
      remaining -= 0.05;
    }

    expect(sawStartle).toBe(true);
    expect(state.mode).toBe('crawling');
    expect(state.tuckProgress).toBe(0);
  });
});

describe('isMoving', () => {
  it('is true only for crawling', () => {
    expect(isMoving('crawling')).toBe(true);
    for (const mode of [
      'pausing',
      'settling',
      'sealed',
      'waking',
      'startled',
      'detached',
    ] as const) {
      expect(isMoving(mode)).toBe(false);
    }
  });
});
