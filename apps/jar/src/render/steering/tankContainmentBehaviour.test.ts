// Tests for pushAxis's gating/direction/graded magnitude, and for the
// square-on-approach fix (a wall push mirrored onto a different axis so
// it's never purely antiparallel to a fish's heading).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';
import * as YUKA from 'yuka';

import { TANK_INNER_BOUNDS } from '../physics/coordinates';
import { pushAxis, TankContainmentBehaviour } from './tankContainmentBehaviour';

const BOUND = 3;
const MARGIN = 0.5;
const STRENGTH = 4;

describe('pushAxis', () => {
  it('is zero comfortably clear of the wall', () => {
    expect(pushAxis(0, BOUND, MARGIN, STRENGTH)).toBe(0);
  });

  it('is zero exactly at the margin boundary', () => {
    expect(pushAxis(BOUND - MARGIN, BOUND, MARGIN, STRENGTH)).toBeCloseTo(0, 5);
    expect(pushAxis(-(BOUND - MARGIN), BOUND, MARGIN, STRENGTH)).toBeCloseTo(0, 5);
  });

  it('pushes back toward the centre near the positive wall', () => {
    expect(pushAxis(BOUND - MARGIN / 2, BOUND, MARGIN, STRENGTH)).toBeLessThan(0);
  });

  it('pushes back toward the centre near the negative wall', () => {
    expect(pushAxis(-(BOUND - MARGIN / 2), BOUND, MARGIN, STRENGTH)).toBeGreaterThan(0);
  });

  it('ramps to full strength right at the wall', () => {
    expect(pushAxis(BOUND, BOUND, MARGIN, STRENGTH)).toBeCloseTo(-STRENGTH, 5);
  });

  it('clamps at full strength past the wall rather than growing further', () => {
    expect(pushAxis(BOUND + 10, BOUND, MARGIN, STRENGTH)).toBeCloseTo(-STRENGTH, 5);
  });
});

describe('TankContainmentBehaviour', () => {
  it('produces zero force in the middle of the tank', () => {
    const behaviour = new TankContainmentBehaviour(MARGIN);
    const vehicle = new YUKA.Vehicle();
    vehicle.position.set(0, 0, 0);
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force.x).toBe(0);
    expect(force.y).toBe(0);
    expect(force.z).toBe(0);
  });

  it('gives a square-on approach to a wall a nonzero sideways component', () => {
    // Centred on x and y (the degenerate case: a naive push here is purely
    // antiparallel to a fish heading straight at the +z wall, with nothing
    // to turn it aside).
    const behaviour = new TankContainmentBehaviour(MARGIN);
    const vehicle = new YUKA.Vehicle();
    vehicle.position.set(0, 0, TANK_INNER_BOUNDS.z);
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force.z).toBeLessThan(0); // still pushes back off the wall
    expect(force.x).not.toBe(0); // but no longer a pure straight line
  });

  it('keeps the sideways nudge small relative to the main push', () => {
    const behaviour = new TankContainmentBehaviour(MARGIN);
    const vehicle = new YUKA.Vehicle();
    vehicle.position.set(0, 0, TANK_INNER_BOUNDS.z);
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(Math.abs(force.x)).toBeLessThan(Math.abs(force.z));
  });

  it('gives the same fish a consistent turn direction across repeated calls', () => {
    const behaviour = new TankContainmentBehaviour(MARGIN);
    const vehicle = new YUKA.Vehicle();
    vehicle.position.set(0, 0, TANK_INNER_BOUNDS.z);

    const first = new YUKA.Vector3();
    behaviour.calculate(vehicle, first);
    const second = new YUKA.Vector3();
    behaviour.calculate(vehicle, second);

    expect(Math.sign(second.x)).toBe(Math.sign(first.x));
  });

  it('still resolves toward the centre from a corner, on every axis at once', () => {
    const behaviour = new TankContainmentBehaviour(MARGIN);
    const vehicle = new YUKA.Vehicle();
    vehicle.position.set(TANK_INNER_BOUNDS.x, TANK_INNER_BOUNDS.y, TANK_INNER_BOUNDS.z);
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force.x).toBeLessThan(0);
    expect(force.y).toBeLessThan(0);
    expect(force.z).toBeLessThan(0);
  });
});
