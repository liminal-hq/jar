// Tests for ChasePursuitBehaviour's null-evader guard.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';
import * as YUKA from 'yuka';

import { ChasePursuitBehaviour } from './chasePursuitBehaviour';

function makeVehicle(x: number, z: number): YUKA.Vehicle {
  const vehicle = new YUKA.Vehicle();
  vehicle.position.set(x, 0, z);
  vehicle.maxSpeed = 2;
  return vehicle;
}

describe('ChasePursuitBehaviour', () => {
  it('produces zero force with no evader assigned', () => {
    const behaviour = new ChasePursuitBehaviour();
    const vehicle = makeVehicle(0, 0);
    const force = new YUKA.Vector3(1, 1, 1); // non-zero, to prove calculate() resets it

    behaviour.calculate(vehicle, force);

    expect(force.x).toBe(0);
    expect(force.y).toBe(0);
    expect(force.z).toBe(0);
  });

  it('produces a non-zero force toward an assigned evader', () => {
    const evader = makeVehicle(5, 0);
    const behaviour = new ChasePursuitBehaviour(evader);
    const vehicle = makeVehicle(0, 0);
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force.length()).toBeGreaterThan(0);
  });
});
