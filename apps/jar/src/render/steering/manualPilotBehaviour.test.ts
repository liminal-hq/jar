// Tests for ManualPilotBehaviour: idle when unpiloted or idle, correct
// normalized force when engaged, and that switching the piloted fish
// clears stale key state.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { beforeEach, describe, expect, it } from 'vitest';
import * as YUKA from 'yuka';

import { ManualPilotBehaviour, PILOT_STRENGTH } from './manualPilotBehaviour';
import { clearKeys, setKey, setPilotedId } from './pilotInputState';

const FISH_ID = 7;
const OTHER_FISH_ID = 8;

describe('ManualPilotBehaviour', () => {
  beforeEach(() => {
    setPilotedId(null);
  });

  it('is zero when no fish is piloted', () => {
    setKey('KeyD', true);
    const behaviour = new ManualPilotBehaviour(FISH_ID);
    const vehicle = new YUKA.Vehicle();
    const force = new YUKA.Vector3(1, 1, 1);

    behaviour.calculate(vehicle, force);

    expect(force).toEqual(new YUKA.Vector3(0, 0, 0));
    clearKeys();
  });

  it('is zero for a fish other than the piloted one', () => {
    setPilotedId(OTHER_FISH_ID);
    setKey('KeyD', true);
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

  it('drives straight into the front glass on KeyS alone, at full strength', () => {
    setPilotedId(FISH_ID);
    setKey('KeyS', true);
    const behaviour = new ManualPilotBehaviour(FISH_ID);
    const vehicle = new YUKA.Vehicle();
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force.x).toBeCloseTo(0);
    expect(force.y).toBeCloseTo(0);
    expect(force.z).toBeCloseTo(PILOT_STRENGTH);
  });

  it('normalizes diagonal input to the same magnitude as a single key', () => {
    setPilotedId(FISH_ID);
    setKey('KeyD', true);
    setKey('KeyW', true);
    const behaviour = new ManualPilotBehaviour(FISH_ID);
    const vehicle = new YUKA.Vehicle();
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force.length()).toBeCloseTo(PILOT_STRENGTH);
  });

  it('clears held keys when the piloted fish changes', () => {
    setPilotedId(FISH_ID);
    setKey('KeyD', true);
    setPilotedId(FISH_ID);
    const behaviour = new ManualPilotBehaviour(FISH_ID);
    const vehicle = new YUKA.Vehicle();
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force).toEqual(new YUKA.Vector3(0, 0, 0));
  });
});
