// Tests for the pilot input singleton's yaw integration and thrust
// direction — the pieces `manualPilotBehaviour.test.ts` doesn't already
// cover through `ManualPilotBehaviour.calculate()` itself.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { beforeEach, describe, expect, it } from 'vitest';

import {
  advancePilotYaw,
  clearKeys,
  getPilotThrust,
  getPilotYaw,
  seedPilotYaw,
  setKey,
  setPilotedId,
} from './pilotInputState';

describe('pilotInputState yaw', () => {
  beforeEach(() => {
    setPilotedId(null);
  });

  it('is null until seeded', () => {
    expect(getPilotYaw()).toBeNull();
  });

  it('KeyA increases yaw, KeyD decreases it', () => {
    seedPilotYaw(0);
    setKey('KeyA', true);
    advancePilotYaw(0.5);
    expect(getPilotYaw()).toBeGreaterThan(0);
    clearKeys();

    seedPilotYaw(0);
    setKey('KeyD', true);
    advancePilotYaw(0.5);
    expect(getPilotYaw()).toBeLessThan(0);
    clearKeys();
  });

  it('does not advance when neither turn key is held', () => {
    seedPilotYaw(1.23);
    advancePilotYaw(1);
    expect(getPilotYaw()).toBeCloseTo(1.23);
  });

  it('opposing turn keys cancel', () => {
    seedPilotYaw(0);
    setKey('KeyA', true);
    setKey('KeyD', true);
    advancePilotYaw(1);
    expect(getPilotYaw()).toBeCloseTo(0);
    clearKeys();
  });

  it('is a no-op while unseeded', () => {
    setKey('KeyA', true);
    advancePilotYaw(1);
    expect(getPilotYaw()).toBeNull();
    clearKeys();
  });

  it('un-seeds the moment the held-key set empties', () => {
    seedPilotYaw(0.5);
    setKey('KeyW', true);
    expect(getPilotYaw()).toBe(0.5);
    setKey('KeyW', false);
    expect(getPilotYaw()).toBeNull();
  });

  it('un-seeds on clearKeys', () => {
    seedPilotYaw(0.5);
    clearKeys();
    expect(getPilotYaw()).toBeNull();
  });

  it('un-seeds when the piloted fish changes', () => {
    setPilotedId(1);
    seedPilotYaw(0.5);
    setPilotedId(2);
    expect(getPilotYaw()).toBeNull();
  });
});

describe('getPilotThrust', () => {
  beforeEach(() => {
    setPilotedId(null);
  });

  it('is null with nothing held', () => {
    expect(getPilotThrust()).toBeNull();
  });

  it('is null on a thrust key alone with no seeded yaw', () => {
    setKey('KeyW', true);
    expect(getPilotThrust()).toBeNull();
    clearKeys();
  });

  it('KeyR/KeyF thrust world-up/down independent of yaw', () => {
    setKey('KeyR', true);
    const up = getPilotThrust();
    expect(up).toEqual({ x: 0, y: 1, z: 0 });
    setKey('KeyR', false);

    setKey('KeyF', true);
    const down = getPilotThrust();
    expect(down).toEqual({ x: 0, y: -1, z: 0 });
    clearKeys();
  });

  it('KeyS is weaker than KeyW at the same yaw', () => {
    seedPilotYaw(0);
    setKey('KeyW', true);
    const forward = getPilotThrust()!;
    setKey('KeyW', false);

    // Releasing KeyW drops the held-key set to empty, which un-seeds yaw
    // (`setKey`'s own doc comment) — harmless in production, since
    // `SteeringSystem.tsx` re-seeds from the fish's real heading every
    // frame it's piloted, but this bare unit test has no such driver, so
    // it reseeds explicitly here to isolate what this test actually cares
    // about (KeyS's weaker magnitude), not the reseed lifecycle itself.
    seedPilotYaw(0);
    setKey('KeyS', true);
    const backward = getPilotThrust()!;
    clearKeys();

    expect(Math.hypot(backward.x, backward.y, backward.z)).toBeLessThan(
      Math.hypot(forward.x, forward.y, forward.z),
    );
  });

  it('clamps a forward+vertical diagonal to unit length', () => {
    seedPilotYaw(0);
    setKey('KeyW', true);
    setKey('KeyR', true);
    const thrust = getPilotThrust()!;
    clearKeys();

    expect(Math.hypot(thrust.x, thrust.y, thrust.z)).toBeCloseTo(1);
  });
});
