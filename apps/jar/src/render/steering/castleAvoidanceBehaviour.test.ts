// Tests for pushFromBox's gating, direction, and graded magnitude.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';
import * as YUKA from 'yuka';

import { CASTLE_POSITION } from '../environment/decorLayout';
import { CastleAvoidanceBehaviour, pushFromBox } from './castleAvoidanceBehaviour';

const BOX_CENTER = { x: 1, y: 0.5, z: -0.5 };
const HALF_EXTENTS = { x: 0.3, y: 0.9, z: 0.3 };
const MARGIN = 0.5;
const STRENGTH = 4;

describe('pushFromBox', () => {
  it('is zero when far outside on even a single axis', () => {
    // Same y and z as the box, but well clear in x.
    const far = { x: BOX_CENTER.x + 5, y: BOX_CENTER.y, z: BOX_CENTER.z };
    expect(pushFromBox(far, BOX_CENTER, HALF_EXTENTS, MARGIN, STRENGTH)).toEqual({
      x: 0,
      y: 0,
      z: 0,
    });
  });

  it('is zero just past the margin, on every axis', () => {
    const justPastX = {
      x: BOX_CENTER.x + HALF_EXTENTS.x + MARGIN + 0.01,
      y: BOX_CENTER.y,
      z: BOX_CENTER.z,
    };
    expect(pushFromBox(justPastX, BOX_CENTER, HALF_EXTENTS, MARGIN, STRENGTH)).toEqual({
      x: 0,
      y: 0,
      z: 0,
    });
  });

  it('pushes away from the box centre, along the nearest-face axis', () => {
    // Well within margin on x, comfortably within the (larger) margin on
    // y/z too — x is the nearest face here.
    const nearXFace = {
      x: BOX_CENTER.x + HALF_EXTENTS.x + 0.1,
      y: BOX_CENTER.y,
      z: BOX_CENTER.z,
    };
    const push = pushFromBox(nearXFace, BOX_CENTER, HALF_EXTENTS, MARGIN, STRENGTH);
    expect(push.x).toBeGreaterThan(0); // away from the box, toward +x
    expect(push.y).toBe(0);
    expect(push.z).toBe(0);
  });

  it('pushes in the negative direction on the opposite side', () => {
    const nearXFaceNegative = {
      x: BOX_CENTER.x - HALF_EXTENTS.x - 0.1,
      y: BOX_CENTER.y,
      z: BOX_CENTER.z,
    };
    const push = pushFromBox(nearXFaceNegative, BOX_CENTER, HALF_EXTENTS, MARGIN, STRENGTH);
    expect(push.x).toBeLessThan(0);
  });

  it('ramps from 0 at the margin boundary to full strength at the real surface', () => {
    const atMarginEdge = {
      x: BOX_CENTER.x + HALF_EXTENTS.x + MARGIN,
      y: BOX_CENTER.y,
      z: BOX_CENTER.z,
    };
    const atSurface = { x: BOX_CENTER.x + HALF_EXTENTS.x, y: BOX_CENTER.y, z: BOX_CENTER.z };
    expect(pushFromBox(atMarginEdge, BOX_CENTER, HALF_EXTENTS, MARGIN, STRENGTH).x).toBeCloseTo(
      0,
      5,
    );
    expect(pushFromBox(atSurface, BOX_CENTER, HALF_EXTENTS, MARGIN, STRENGTH).x).toBeCloseTo(
      STRENGTH,
      5,
    );
  });

  it('clamps magnitude at strength even if the point is inside the real box', () => {
    const deepInside = { x: BOX_CENTER.x, y: BOX_CENTER.y, z: BOX_CENTER.z };
    const push = pushFromBox(deepInside, BOX_CENTER, HALF_EXTENTS, MARGIN, STRENGTH);
    const magnitude = Math.hypot(push.x, push.y, push.z);
    expect(magnitude).toBeCloseTo(STRENGTH, 5);
  });

  it('picks whichever axis is nearest to its own real surface, not the largest half-extent', () => {
    // z is the tightest axis here (smallest half-extent), and the point is
    // closest to the z face specifically.
    const nearZFace = {
      x: BOX_CENTER.x,
      y: BOX_CENTER.y,
      z: BOX_CENTER.z + HALF_EXTENTS.z + 0.05,
    };
    const push = pushFromBox(nearZFace, BOX_CENTER, HALF_EXTENTS, MARGIN, STRENGTH);
    expect(push.z).toBeGreaterThan(0);
    expect(push.x).toBe(0);
    expect(push.y).toBe(0);
  });
});

describe('CastleAvoidanceBehaviour', () => {
  it('produces zero force for a fish centred in the doorway, despite overlapping wall margins', () => {
    // A margin big enough that the flanking wall segments' expanded zones
    // would otherwise overlap past the doorway's own centre (the exact bug
    // this exemption exists to prevent) — see CASTLE_DOORWAY_CORRIDOR's
    // comment for the arithmetic.
    const bigFishMargin = 0.9;
    const colliderRadius = 0.3;
    const behaviour = new CastleAvoidanceBehaviour(bigFishMargin, colliderRadius);
    const vehicle = new YUKA.Vehicle();
    vehicle.position.set(CASTLE_POSITION.x, CASTLE_POSITION.y + 0.5, CASTLE_POSITION.z);
    const force = new YUKA.Vector3(1, 1, 1); // non-zero, to prove calculate() resets it

    behaviour.calculate(vehicle, force);

    expect(force.x).toBe(0);
    expect(force.y).toBe(0);
    expect(force.z).toBe(0);
  });

  it('still pushes a large fish away from a tower, well outside the doorway corridor', () => {
    const bigFishMargin = 0.9;
    const colliderRadius = 0.3;
    const behaviour = new CastleAvoidanceBehaviour(bigFishMargin, colliderRadius);
    const vehicle = new YUKA.Vehicle();
    // Just past a tower's real surface, same x as the tower itself.
    vehicle.position.set(CASTLE_POSITION.x + 1.8, CASTLE_POSITION.y + 0.4, CASTLE_POSITION.z);
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force.length()).toBeGreaterThan(0);
  });

  it('does not exempt an off-centre position whose collider would still reach the flanking wall', () => {
    // Doorway half-width is 0.65; a 0.5-radius collider shrinks the
    // exemption to ±0.15, so x=0.3 (inside the *raw* 0.65 corridor) must no
    // longer be exempted — this is the actual regression: checking only the
    // centre against the full doorway width let a fish's real body already
    // clip the wall while avoidance sat fully off.
    const margin = 0.9; // comfortably reaches the flanking wall from x=0.3
    const colliderRadius = 0.5;
    const behaviour = new CastleAvoidanceBehaviour(margin, colliderRadius);
    const vehicle = new YUKA.Vehicle();
    vehicle.position.set(CASTLE_POSITION.x + 0.3, CASTLE_POSITION.y + 0.5, CASTLE_POSITION.z);
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force.length()).toBeGreaterThan(0);
  });

  it('still exempts the same off-centre position for a small enough fish', () => {
    const margin = 0.3;
    const colliderRadius = 0.1; // shrinks the corridor only to ±0.55 — 0.3 stays inside
    const behaviour = new CastleAvoidanceBehaviour(margin, colliderRadius);
    const vehicle = new YUKA.Vehicle();
    vehicle.position.set(CASTLE_POSITION.x + 0.3, CASTLE_POSITION.y + 0.5, CASTLE_POSITION.z);
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force.x).toBe(0);
    expect(force.y).toBe(0);
    expect(force.z).toBe(0);
  });

  it('never exempts a fish whose own collider radius exceeds the doorway half-width', () => {
    // The single largest fin/sex combination doesn't fit the exemption at
    // all, even dead-centre — the doorway was already sized knowing it
    // wouldn't perfectly fit that one case (decorLayout.ts), so avoidance
    // staying on here is the documented trade-off, not a regression.
    const margin = 1.0;
    const colliderRadius = 0.8; // exceeds CASTLE_DOOR_HALF_WIDTH (0.65)
    const behaviour = new CastleAvoidanceBehaviour(margin, colliderRadius);
    const vehicle = new YUKA.Vehicle();
    vehicle.position.set(CASTLE_POSITION.x, CASTLE_POSITION.y + 0.5, CASTLE_POSITION.z);
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force.length()).toBeGreaterThan(0);
  });
});
