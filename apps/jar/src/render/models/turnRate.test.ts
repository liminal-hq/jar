// Tests for computeTurnRate's low-speed gating and hold-last-direction behaviour.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { computeTurnRate, MIN_TURN_RATE_SPEED } from './turnRate';

describe('computeTurnRate', () => {
  it('measures the angle to the new direction, scaled by delta, when above the speed gate', () => {
    const prevDirection = new THREE.Vector3(0, 0, 1);
    const velocity = new THREE.Vector3(1, 0, 0).multiplyScalar(MIN_TURN_RATE_SPEED * 2);
    const { turnRate, direction } = computeTurnRate(
      velocity.length(),
      velocity,
      prevDirection,
      0.5,
    );
    expect(turnRate).toBeCloseTo(Math.PI / 2 / 0.5, 5);
    expect(direction.x).toBeCloseTo(1, 5);
    expect(direction.z).toBeCloseTo(0, 5);
  });

  it('reports zero turn rate at or below the speed gate, regardless of direction change', () => {
    const prevDirection = new THREE.Vector3(0, 0, 1);
    const velocity = new THREE.Vector3(1, 0, 0).multiplyScalar(MIN_TURN_RATE_SPEED);
    const { turnRate } = computeTurnRate(velocity.length(), velocity, prevDirection, 0.016);
    expect(turnRate).toBe(0);
  });

  it('holds the previous direction (not the noisy new one) below the speed gate', () => {
    const prevDirection = new THREE.Vector3(0, 0, 1);
    // A direction that would otherwise register a sharp turn.
    const noisyVelocity = new THREE.Vector3(1, 1, 0).multiplyScalar(MIN_TURN_RATE_SPEED * 0.5);
    const { direction } = computeTurnRate(
      noisyVelocity.length(),
      noisyVelocity,
      prevDirection,
      0.016,
    );
    expect(direction).toBe(prevDirection);
  });

  it('does not compound noise across consecutive low-speed frames', () => {
    // The exact bug this fixes: several frames of tiny, randomly-directed
    // velocity right around a pause or night settle/wake used to each
    // register as a "sharp turn" against the previous (equally noisy)
    // sample. Held direction means every one of these frames reports zero.
    let prevDirection = new THREE.Vector3(0, 0, 1);
    const noisySamples = [
      new THREE.Vector3(0.01, 0, -0.02),
      new THREE.Vector3(-0.015, 0.01, 0.005),
      new THREE.Vector3(0.02, -0.01, -0.01),
    ];
    for (const velocity of noisySamples) {
      const result = computeTurnRate(velocity.length(), velocity, prevDirection, 0.016);
      expect(result.turnRate).toBe(0);
      prevDirection = result.direction;
    }
  });

  it('resumes real measurement once speed climbs back above the gate, against the last held direction', () => {
    const originalDirection = new THREE.Vector3(0, 0, 1);
    // A low-speed noisy frame that must not update the held direction.
    const { direction: heldDirection } = computeTurnRate(
      0.01,
      new THREE.Vector3(1, 0, 0).multiplyScalar(0.01),
      originalDirection,
      0.016,
    );
    expect(heldDirection).toBe(originalDirection);

    // Speed climbs back up, turning 90 degrees from the original direction.
    const resumedVelocity = new THREE.Vector3(1, 0, 0).multiplyScalar(MIN_TURN_RATE_SPEED * 2);
    const { turnRate } = computeTurnRate(
      resumedVelocity.length(),
      resumedVelocity,
      heldDirection,
      0.5,
    );
    expect(turnRate).toBeCloseTo(Math.PI / 2 / 0.5, 5);
  });

  it('does not return null/NaN for a zero delta', () => {
    const prevDirection = new THREE.Vector3(0, 0, 1);
    const velocity = new THREE.Vector3(1, 0, 0).multiplyScalar(MIN_TURN_RATE_SPEED * 2);
    const { turnRate } = computeTurnRate(velocity.length(), velocity, prevDirection, 0);
    expect(turnRate).toBe(0);
  });
});
