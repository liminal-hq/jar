// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { computeTargetHeading, MAX_PITCH, MIN_HEADING_SPEED } from './heading';

/** Applies a heading quaternion to the forward convention (+Z) and returns
 * the resulting direction, so tests can assert on "which way is the fish
 * facing" rather than raw Euler angles. */
function facingDirection(heading: THREE.Quaternion): THREE.Vector3 {
  return new THREE.Vector3(0, 0, 1).applyQuaternion(heading);
}

describe('computeTargetHeading', () => {
  it('faces +Z for velocity straight along +Z (no turn)', () => {
    const heading = computeTargetHeading(new THREE.Vector3(0, 0, 1));
    expect(heading).not.toBeNull();
    const facing = facingDirection(heading!);
    expect(facing.x).toBeCloseTo(0, 5);
    expect(facing.z).toBeCloseTo(1, 5);
  });

  it('yaws to face +X for velocity along +X', () => {
    const heading = computeTargetHeading(new THREE.Vector3(1, 0, 0));
    const facing = facingDirection(heading!);
    expect(facing.x).toBeCloseTo(1, 5);
    expect(facing.z).toBeCloseTo(0, 5);
  });

  it('yaws to face -X for velocity along -X', () => {
    const heading = computeTargetHeading(new THREE.Vector3(-1, 0, 0));
    const facing = facingDirection(heading!);
    expect(facing.x).toBeCloseTo(-1, 5);
    expect(facing.z).toBeCloseTo(0, 5);
  });

  it('yaws to face -Z (backward) for velocity along -Z', () => {
    const heading = computeTargetHeading(new THREE.Vector3(0, 0, -1));
    const facing = facingDirection(heading!);
    expect(facing.x).toBeCloseTo(0, 5);
    expect(facing.z).toBeCloseTo(-1, 5);
  });

  it('pitches upward for a gentle climb without clamping', () => {
    const heading = computeTargetHeading(new THREE.Vector3(0, 0.3, 1));
    const facing = facingDirection(heading!);
    expect(facing.y).toBeGreaterThan(0);
    expect(facing.y).toBeCloseTo(Math.sin(Math.atan2(0.3, 1)), 5);
  });

  it('clamps pitch to MAX_PITCH for a steep climb, staying mostly upright', () => {
    // Raw pitch here would be atan2(10, 1) ≈ 84°, far past the clamp.
    const heading = computeTargetHeading(new THREE.Vector3(1, 10, 0));
    const facing = facingDirection(heading!);
    const impliedPitch = Math.asin(THREE.MathUtils.clamp(facing.y, -1, 1));
    expect(impliedPitch).toBeCloseTo(MAX_PITCH, 5);
  });

  it('clamps pitch symmetrically for a steep dive', () => {
    const heading = computeTargetHeading(new THREE.Vector3(1, -10, 0));
    const facing = facingDirection(heading!);
    const impliedPitch = Math.asin(THREE.MathUtils.clamp(facing.y, -1, 1));
    expect(impliedPitch).toBeCloseTo(-MAX_PITCH, 5);
  });

  it('never introduces roll — the up vector stays in the yaw/pitch plane', () => {
    const heading = computeTargetHeading(new THREE.Vector3(0.7, 0.6, 0.4));
    const euler = new THREE.Euler().setFromQuaternion(heading!, 'YXZ');
    expect(euler.z).toBeCloseTo(0, 10);
  });

  it('returns null (hold last heading) below MIN_HEADING_SPEED, even with strong vertical motion', () => {
    expect(computeTargetHeading(new THREE.Vector3(0, 5, 0))).toBeNull();
    expect(
      computeTargetHeading(new THREE.Vector3(MIN_HEADING_SPEED / 2, 5, MIN_HEADING_SPEED / 2)),
    ).toBeNull();
  });

  it('does not return null right at the MIN_HEADING_SPEED boundary', () => {
    expect(computeTargetHeading(new THREE.Vector3(MIN_HEADING_SPEED * 2, 0, 0))).not.toBeNull();
  });
});
