// Tests for pushFromBox's gating, direction, and graded magnitude (now
// per-axis), and for CastleAvoidanceBehaviour's yaw-aware anisotropic
// margins — including the property that replaced the old doorway
// exemption mechanism: a nose-on fish's live margin never reaches a
// flanking wall from the doorway's centreline, so no fish stalls there.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';
import * as YUKA from 'yuka';

import {
  CASTLE_KEEP_HALF_WIDTH,
  CASTLE_POSITION,
  CASTLE_TOWER_HALF_WIDTH,
  CASTLE_TOWER_HEIGHT,
  CASTLE_TOWER_OFFSET,
} from '../environment/decorLayout';
import type { ColliderHalfExtents } from '../tank/fishCollider';
import { CastleAvoidanceBehaviour, pushFromBox } from './castleAvoidanceBehaviour';

const BOX_CENTRE = { x: 1, y: 0.5, z: -0.5 };
const HALF_EXTENTS = { x: 0.3, y: 0.9, z: 0.3 };
const MARGIN = { x: 0.5, y: 0.5, z: 0.5 };
const STRENGTH = 4;

describe('pushFromBox', () => {
  it('is zero when far outside on even a single axis', () => {
    // Same y and z as the box, but well clear in x.
    const far = { x: BOX_CENTRE.x + 5, y: BOX_CENTRE.y, z: BOX_CENTRE.z };
    expect(pushFromBox(far, BOX_CENTRE, HALF_EXTENTS, MARGIN, STRENGTH)).toEqual({
      x: 0,
      y: 0,
      z: 0,
    });
  });

  it('is zero just past the margin, on every axis', () => {
    const justPastX = {
      x: BOX_CENTRE.x + HALF_EXTENTS.x + MARGIN.x + 0.01,
      y: BOX_CENTRE.y,
      z: BOX_CENTRE.z,
    };
    expect(pushFromBox(justPastX, BOX_CENTRE, HALF_EXTENTS, MARGIN, STRENGTH)).toEqual({
      x: 0,
      y: 0,
      z: 0,
    });
  });

  it('pushes away from the box centre, along the nearest-face axis', () => {
    // Well within margin on x, comfortably within the (larger) margin on
    // y/z too — x is the nearest face here.
    const nearXFace = {
      x: BOX_CENTRE.x + HALF_EXTENTS.x + 0.1,
      y: BOX_CENTRE.y,
      z: BOX_CENTRE.z,
    };
    const push = pushFromBox(nearXFace, BOX_CENTRE, HALF_EXTENTS, MARGIN, STRENGTH);
    expect(push.x).toBeGreaterThan(0); // away from the box, toward +x
    expect(push.y).toBe(0);
    expect(push.z).toBe(0);
  });

  it('pushes in the negative direction on the opposite side', () => {
    const nearXFaceNegative = {
      x: BOX_CENTRE.x - HALF_EXTENTS.x - 0.1,
      y: BOX_CENTRE.y,
      z: BOX_CENTRE.z,
    };
    const push = pushFromBox(nearXFaceNegative, BOX_CENTRE, HALF_EXTENTS, MARGIN, STRENGTH);
    expect(push.x).toBeLessThan(0);
  });

  it('ramps from 0 at the margin boundary to full strength at the real surface', () => {
    const atMarginEdge = {
      x: BOX_CENTRE.x + HALF_EXTENTS.x + MARGIN.x,
      y: BOX_CENTRE.y,
      z: BOX_CENTRE.z,
    };
    const atSurface = { x: BOX_CENTRE.x + HALF_EXTENTS.x, y: BOX_CENTRE.y, z: BOX_CENTRE.z };
    expect(pushFromBox(atMarginEdge, BOX_CENTRE, HALF_EXTENTS, MARGIN, STRENGTH).x).toBeCloseTo(
      0,
      5,
    );
    expect(pushFromBox(atSurface, BOX_CENTRE, HALF_EXTENTS, MARGIN, STRENGTH).x).toBeCloseTo(
      STRENGTH,
      5,
    );
  });

  it('clamps magnitude at strength even if the point is inside the real box', () => {
    const deepInside = { x: BOX_CENTRE.x, y: BOX_CENTRE.y, z: BOX_CENTRE.z };
    const push = pushFromBox(deepInside, BOX_CENTRE, HALF_EXTENTS, MARGIN, STRENGTH);
    const magnitude = Math.hypot(push.x, push.y, push.z);
    expect(magnitude).toBeCloseTo(STRENGTH, 5);
  });

  it('picks whichever axis is nearest to its own real surface, not the largest half-extent', () => {
    // z is the tightest axis here (smallest half-extent), and the point is
    // closest to the z face specifically.
    const nearZFace = {
      x: BOX_CENTRE.x,
      y: BOX_CENTRE.y,
      z: BOX_CENTRE.z + HALF_EXTENTS.z + 0.05,
    };
    const push = pushFromBox(nearZFace, BOX_CENTRE, HALF_EXTENTS, MARGIN, STRENGTH);
    expect(push.z).toBeGreaterThan(0);
    expect(push.x).toBe(0);
    expect(push.y).toBe(0);
  });

  describe('anisotropic margins', () => {
    it('gates per axis independently — a tight margin on one axis can exclude a point a looser one would include', () => {
      const nearXFace = {
        x: BOX_CENTRE.x + HALF_EXTENTS.x + 0.25,
        y: BOX_CENTRE.y,
        z: BOX_CENTRE.z,
      };
      const looseX = { x: 0.5, y: 0.5, z: 0.5 };
      const tightX = { x: 0.2, y: 0.5, z: 0.5 };
      expect(pushFromBox(nearXFace, BOX_CENTRE, HALF_EXTENTS, looseX, STRENGTH).x).toBeGreaterThan(
        0,
      );
      expect(pushFromBox(nearXFace, BOX_CENTRE, HALF_EXTENTS, tightX, STRENGTH)).toEqual({
        x: 0,
        y: 0,
        z: 0,
      });
    });

    it('picks the nearest face by fractional depth, not raw distance, once margins differ', () => {
      // Fractionally deep in x (small margin, close to its own surface) but
      // only shallow in z despite a larger raw gap (huge margin there) —
      // without normalizing by each axis's own margin, the bigger raw z
      // penetration would wrongly win.
      const point = {
        x: BOX_CENTRE.x + HALF_EXTENTS.x + 0.05, // 0.05 into a 0.2 x-margin: 75% depth
        y: BOX_CENTRE.y,
        z: BOX_CENTRE.z + HALF_EXTENTS.z + 1, // 1 into a 5 z-margin: 80% depth... see below
      };
      const margin = { x: 0.2, y: 0.5, z: 5 };
      const push = pushFromBox(point, BOX_CENTRE, HALF_EXTENTS, margin, STRENGTH);
      // x fractional depth = (0.2-0.05)/0.2 = 0.75; z fractional depth =
      // (5-1)/5 = 0.8 — x is still the nearest face by fractional depth.
      expect(push.x).toBeGreaterThan(0);
      expect(push.z).toBe(0);
    });

    it('still reaches exactly strength at a real surface regardless of that axis margin', () => {
      const atSurfaceSmallMargin = {
        x: BOX_CENTRE.x + HALF_EXTENTS.x,
        y: BOX_CENTRE.y,
        z: BOX_CENTRE.z,
      };
      const push = pushFromBox(
        atSurfaceSmallMargin,
        BOX_CENTRE,
        HALF_EXTENTS,
        { x: 0.05, y: 5, z: 5 },
        STRENGTH,
      );
      expect(push.x).toBeCloseTo(STRENGTH, 5);
    });
  });
});

describe('CastleAvoidanceBehaviour', () => {
  // The worst case the old doorway exemption could never fully serve —
  // still just a regular fish here, no special-casing needed.
  const MALE_VEIL: ColliderHalfExtents = { x: 0.12, y: 0.312, z: 0.725 };
  const BUFFER = 0.1;
  // Below the door/lintel's own margin band — a fish actually swimming
  // through the opening, not testing lintel avoidance.
  const DOOR_LEVEL_Y = CASTLE_POSITION.y + 0.2;

  it('produces near-zero force for a nose-on fish centred in the doorway (the old exemption is no longer needed)', () => {
    const behaviour = new CastleAvoidanceBehaviour(MALE_VEIL, BUFFER, () => Math.PI);
    const vehicle = new YUKA.Vehicle();
    vehicle.position.set(CASTLE_POSITION.x, DOOR_LEVEL_Y, CASTLE_POSITION.z);
    const force = new YUKA.Vector3(1, 1, 1); // non-zero, to prove calculate() resets it

    behaviour.calculate(vehicle, force);

    expect(force.x).toBe(0);
    expect(force.y).toBe(0);
    expect(force.z).toBe(0);
  });

  it('produces real repulsion for the same position and fish, broadside instead of nose-on', () => {
    // Not the exact doorway centreline (`CASTLE_POSITION.x`) — the two
    // flanking walls' pushes cancel there by symmetry regardless of yaw
    // (the same corner-cancellation `tankContainmentBehaviour.ts`'s own
    // tests already document), which would make this test pass or fail
    // for the wrong reason. A slight offset breaks that symmetry.
    const offCentreX = CASTLE_POSITION.x + 0.1;
    const behaviour = new CastleAvoidanceBehaviour(MALE_VEIL, BUFFER, () => Math.PI / 2);
    const vehicle = new YUKA.Vehicle();
    vehicle.position.set(offCentreX, DOOR_LEVEL_Y, CASTLE_POSITION.z);
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force.length()).toBeGreaterThan(0);
  });

  it('still pushes a large fish away from a tower, well outside the doorway', () => {
    const behaviour = new CastleAvoidanceBehaviour(MALE_VEIL, BUFFER, () => Math.PI);
    const vehicle = new YUKA.Vehicle();
    // Just past a tower's real surface, same x as the tower itself.
    vehicle.position.set(CASTLE_POSITION.x + CASTLE_TOWER_OFFSET, DOOR_LEVEL_Y, CASTLE_POSITION.z);
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force.length()).toBeGreaterThan(0);
  });

  describe('the keep-to-tower gap', () => {
    // Midpoint of the clear gap between the keep's own edge and the
    // tower's inner face.
    const gapX =
      CASTLE_POSITION.x +
      (CASTLE_KEEP_HALF_WIDTH + CASTLE_TOWER_OFFSET - CASTLE_TOWER_HALF_WIDTH) / 2;
    const gapY = CASTLE_POSITION.y + CASTLE_TOWER_HEIGHT / 2;

    it('a nose-on fish dead-centre in the gap feels only a small net push (the keep wall and tower nearly cancel)', () => {
      const behaviour = new CastleAvoidanceBehaviour(MALE_VEIL, BUFFER, () => Math.PI);
      const vehicle = new YUKA.Vehicle();
      vehicle.position.set(gapX, gapY, CASTLE_POSITION.z);
      const force = new YUKA.Vector3();

      behaviour.calculate(vehicle, force);

      expect(force.length()).toBeLessThan(STRENGTH);
    });

    it('a nose-on fish nudged off-centre in the gap still stays well under full strength', () => {
      // Off-centre enough to break the dead-centre cancellation above, but
      // still deep inside the gap, not at either wall's real surface —
      // demonstrates the push here is a gentle, graded correction (the
      // fish can occupy this space), not a hard expulsion.
      const behaviour = new CastleAvoidanceBehaviour(MALE_VEIL, BUFFER, () => Math.PI);
      const vehicle = new YUKA.Vehicle();
      vehicle.position.set(gapX - 0.05, gapY, CASTLE_POSITION.z);
      const force = new YUKA.Vector3();

      behaviour.calculate(vehicle, force);

      expect(force.length()).toBeGreaterThan(0);
      expect(force.length()).toBeLessThan(STRENGTH);
    });
  });

  it('reads yaw live, per call — no reconstruction needed when a fish turns', () => {
    // Off-centre, same reasoning as the doorway repulsion test above — the
    // exact centreline cancels regardless of yaw.
    const offCentreX = CASTLE_POSITION.x + 0.1;
    let yaw = Math.PI; // nose-on: no push
    const behaviour = new CastleAvoidanceBehaviour(MALE_VEIL, BUFFER, () => yaw);
    const vehicle = new YUKA.Vehicle();
    vehicle.position.set(offCentreX, DOOR_LEVEL_Y, CASTLE_POSITION.z);

    const first = new YUKA.Vector3();
    behaviour.calculate(vehicle, first);
    expect(first.length()).toBe(0);

    yaw = Math.PI / 2; // broadside: real push
    const second = new YUKA.Vector3();
    behaviour.calculate(vehicle, second);
    expect(second.length()).toBeGreaterThan(0);
  });
});
