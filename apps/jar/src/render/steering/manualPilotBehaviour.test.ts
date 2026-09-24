// Tests for ManualPilotBehaviour: idle when unpiloted, idle, or unseeded;
// correct thrust direction/magnitude relative to the driven yaw once
// engaged; and that switching the piloted fish clears stale key state.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { beforeEach, describe, expect, it } from 'vitest';
import * as YUKA from 'yuka';

import { ManualPilotBehaviour, PILOT_STRENGTH } from './manualPilotBehaviour';
import {
  clearKeys,
  REVERSE_THRUST_FACTOR,
  seedPilotYaw,
  setKey,
  setPilotedId,
} from './pilotInputState';

const FISH_ID = 7;
const OTHER_FISH_ID = 8;

describe('ManualPilotBehaviour', () => {
  beforeEach(() => {
    setPilotedId(null);
  });

  it('is zero when no fish is piloted', () => {
    setKey('KeyW', true);
    const behaviour = new ManualPilotBehaviour(FISH_ID);
    const vehicle = new YUKA.Vehicle();
    const force = new YUKA.Vector3(1, 1, 1);

    behaviour.calculate(vehicle, force);

    expect(force).toEqual(new YUKA.Vector3(0, 0, 0));
    clearKeys();
  });

  it('is zero for a fish other than the piloted one', () => {
    setPilotedId(OTHER_FISH_ID);
    setKey('KeyW', true);
    const behaviour = new ManualPilotBehaviour(FISH_ID);
    const vehicle = new YUKA.Vehicle();
    const force = new YUKA.Vector3(1, 1, 1);

    behaviour.calculate(vehicle, force);

    expect(force).toEqual(new YUKA.Vector3(0, 0, 0));
  });

  it('is zero when piloted but no key is held', () => {
    setPilotedId(FISH_ID);
    const behaviour = new ManualPilotBehaviour(FISH_ID);
    const vehicle = new YUKA.Vehicle();
    const force = new YUKA.Vector3(1, 1, 1);

    behaviour.calculate(vehicle, force);

    expect(force).toEqual(new YUKA.Vector3(0, 0, 0));
  });

  it('is zero on KeyW when the driven yaw is not yet seeded', () => {
    setPilotedId(FISH_ID);
    setKey('KeyW', true);
    const behaviour = new ManualPilotBehaviour(FISH_ID);
    const vehicle = new YUKA.Vehicle();
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force).toEqual(new YUKA.Vector3(0, 0, 0));
  });

  it('KeyW thrusts along the driven yaw (yaw 0 -> +Z)', () => {
    setPilotedId(FISH_ID);
    seedPilotYaw(0);
    setKey('KeyW', true);
    const behaviour = new ManualPilotBehaviour(FISH_ID);
    const vehicle = new YUKA.Vehicle();
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force.x).toBeCloseTo(0);
    expect(force.y).toBeCloseTo(0);
    expect(force.z).toBeCloseTo(PILOT_STRENGTH);
  });

  it('KeyW thrusts along the driven yaw (yaw pi/2 -> +X)', () => {
    setPilotedId(FISH_ID);
    seedPilotYaw(Math.PI / 2);
    setKey('KeyW', true);
    const behaviour = new ManualPilotBehaviour(FISH_ID);
    const vehicle = new YUKA.Vehicle();
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force.x).toBeCloseTo(PILOT_STRENGTH);
    expect(force.y).toBeCloseTo(0);
    expect(force.z).toBeCloseTo(0, 4);
  });

  it('KeyS thrusts backward, weaker than KeyW', () => {
    setPilotedId(FISH_ID);
    seedPilotYaw(0);
    setKey('KeyS', true);
    const behaviour = new ManualPilotBehaviour(FISH_ID);
    const vehicle = new YUKA.Vehicle();
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force.z).toBeCloseTo(-PILOT_STRENGTH * REVERSE_THRUST_FACTOR);
  });

  it('is zero on KeyA alone — turning does not thrust', () => {
    setPilotedId(FISH_ID);
    seedPilotYaw(0);
    setKey('KeyA', true);
    const behaviour = new ManualPilotBehaviour(FISH_ID);
    const vehicle = new YUKA.Vehicle();
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force).toEqual(new YUKA.Vector3(0, 0, 0));
  });

  it('normalizes a forward+vertical diagonal to the same magnitude as a single key', () => {
    setPilotedId(FISH_ID);
    seedPilotYaw(0);
    setKey('KeyW', true);
    setKey('KeyR', true);
    const behaviour = new ManualPilotBehaviour(FISH_ID);
    const vehicle = new YUKA.Vehicle();
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force.length()).toBeCloseTo(PILOT_STRENGTH);
  });

  it('clears held keys and un-seeds yaw when the piloted fish changes', () => {
    setPilotedId(FISH_ID);
    seedPilotYaw(0);
    setKey('KeyW', true);
    setPilotedId(FISH_ID);
    const behaviour = new ManualPilotBehaviour(FISH_ID);
    const vehicle = new YUKA.Vehicle();
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force).toEqual(new YUKA.Vector3(0, 0, 0));
  });
});
