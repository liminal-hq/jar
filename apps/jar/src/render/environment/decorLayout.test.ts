// Tests for the decor layout constants — mostly bounds-checking, since the
// actual visual placement is a judgment call, not something to assert an
// exact value for.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { TANK_INNER_BOUNDS } from '../physics/coordinates';
import {
  CASTLE_COLLIDER_BOXES,
  CASTLE_DOOR_HALF_WIDTH,
  CASTLE_KEEP_HALF_WIDTH,
  CASTLE_POSITION,
  CASTLE_ROOF_HALF_WIDTH,
  CASTLE_TOWER_OFFSET,
  CASTLE_TOWER_HALF_WIDTH,
  HIDE_JITTER,
  HIDE_POINT,
  keepClearOfCastle,
  PLANT_BROADLEAF_POSITION,
  PLANT_FRONT_RIGHT_POSITION,
  PLANT_LEFT_OF_KEEP_POSITION,
  PLANT_SMALL_KELP_POSITION,
  PLANT_TALL_KELP_POSITION,
} from './decorLayout';

const ALL_PLANT_POSITIONS = [
  PLANT_TALL_KELP_POSITION,
  PLANT_BROADLEAF_POSITION,
  PLANT_SMALL_KELP_POSITION,
  PLANT_FRONT_RIGHT_POSITION,
  PLANT_LEFT_OF_KEEP_POSITION,
];

function isInsideTank(point: { x: number; y: number; z: number }, margin = 0): boolean {
  return (
    Math.abs(point.x) <= TANK_INNER_BOUNDS.x - margin &&
    Math.abs(point.y) <= TANK_INNER_BOUNDS.y - margin &&
    Math.abs(point.z) <= TANK_INNER_BOUNDS.z - margin
  );
}

describe('castle footprint', () => {
  it('the widest extent (towers + roof overhang) stays inside the tank', () => {
    const halfSpan = CASTLE_TOWER_OFFSET + CASTLE_ROOF_HALF_WIDTH;
    expect(CASTLE_POSITION.x + halfSpan).toBeLessThanOrEqual(TANK_INNER_BOUNDS.x);
    expect(CASTLE_POSITION.x - halfSpan).toBeGreaterThanOrEqual(-TANK_INNER_BOUNDS.x);
  });

  it('the door is narrower than the keep it is cut into', () => {
    expect(CASTLE_DOOR_HALF_WIDTH).toBeLessThan(CASTLE_KEEP_HALF_WIDTH);
  });

  it('towers sit outside the keep half-width (they flank it, not overlap its centre)', () => {
    expect(CASTLE_TOWER_OFFSET).toBeGreaterThan(CASTLE_KEEP_HALF_WIDTH - CASTLE_TOWER_HALF_WIDTH);
  });

  it('collider boxes never gap — each box has a positive half-extent on every axis', () => {
    for (const box of CASTLE_COLLIDER_BOXES) {
      expect(box.halfExtents.x).toBeGreaterThan(0);
      expect(box.halfExtents.y).toBeGreaterThan(0);
      expect(box.halfExtents.z).toBeGreaterThan(0);
    }
  });

  it('the two wall segments leave the door width clear between them', () => {
    const [left, right] = CASTLE_COLLIDER_BOXES;
    if (!left || !right) throw new Error('expected at least two collider boxes');
    const leftInnerEdge = left.position.x + left.halfExtents.x;
    const rightInnerEdge = right.position.x - right.halfExtents.x;
    expect(rightInnerEdge - leftInnerEdge).toBeCloseTo(CASTLE_DOOR_HALF_WIDTH * 2, 5);
  });
});

describe('hide point', () => {
  it('sits inside the tank, with margin for the jitter applied on top of it', () => {
    const maxJitter = Math.max(HIDE_JITTER.x, HIDE_JITTER.y, HIDE_JITTER.z);
    expect(isInsideTank(HIDE_POINT, maxJitter)).toBe(true);
  });

  it('sits behind the castle keep (further from the camera) rather than in front of it', () => {
    expect(HIDE_POINT.z).toBeLessThan(CASTLE_POSITION.z);
  });

  it('is not inside any collider box (it should be reachable, not embedded in a wall)', () => {
    for (const box of CASTLE_COLLIDER_BOXES) {
      const boxWorldX = CASTLE_POSITION.x + box.position.x;
      const boxWorldY = CASTLE_POSITION.y + box.position.y;
      const boxWorldZ = CASTLE_POSITION.z + box.position.z;
      const inside =
        Math.abs(HIDE_POINT.x - boxWorldX) < box.halfExtents.x &&
        Math.abs(HIDE_POINT.y - boxWorldY) < box.halfExtents.y &&
        Math.abs(HIDE_POINT.z - boxWorldZ) < box.halfExtents.z;
      expect(inside).toBe(false);
    }
  });
});

describe('plant positions', () => {
  it('all five sit inside the tank', () => {
    for (const plant of ALL_PLANT_POSITIONS) {
      expect(isInsideTank(plant)).toBe(true);
    }
  });

  it('none of the five sit inside a castle collider box (they surround the castle, not just sit to one side of it)', () => {
    for (const plant of ALL_PLANT_POSITIONS) {
      for (const box of CASTLE_COLLIDER_BOXES) {
        const boxWorldX = CASTLE_POSITION.x + box.position.x;
        const boxWorldY = CASTLE_POSITION.y + box.position.y;
        const boxWorldZ = CASTLE_POSITION.z + box.position.z;
        const inside =
          Math.abs(plant.x - boxWorldX) < box.halfExtents.x &&
          Math.abs(plant.y - boxWorldY) < box.halfExtents.y &&
          Math.abs(plant.z - boxWorldZ) < box.halfExtents.z;
        expect(inside).toBe(false);
      }
    }
  });
});

function isOutsideEveryColliderBox(
  point: { x: number; y: number; z: number },
  margin: number,
): boolean {
  return CASTLE_COLLIDER_BOXES.every((box) => {
    const boxWorldX = CASTLE_POSITION.x + box.position.x;
    const boxWorldY = CASTLE_POSITION.y + box.position.y;
    const boxWorldZ = CASTLE_POSITION.z + box.position.z;
    const inside =
      Math.abs(point.x - boxWorldX) < box.halfExtents.x + margin &&
      Math.abs(point.y - boxWorldY) < box.halfExtents.y + margin &&
      Math.abs(point.z - boxWorldZ) < box.halfExtents.z + margin;
    return !inside;
  });
}

describe('keepClearOfCastle', () => {
  const MARGIN = 0.3; // a plausible fish collider radius (Fish.tsx's colliderRadiusFor runs 0.46-0.72)

  it('leaves a point that is already clear of every box untouched', () => {
    const farAway = { x: -3, y: 0, z: -3 };
    expect(keepClearOfCastle(farAway, MARGIN)).toEqual(farAway);
  });

  it('pushes a point out of a wall segment box it started inside', () => {
    const box = CASTLE_COLLIDER_BOXES[0]!; // left wall segment
    const deepInside = {
      x: CASTLE_POSITION.x + box.position.x,
      y: CASTLE_POSITION.y + box.position.y,
      z: CASTLE_POSITION.z + box.position.z,
    };
    const pushed = keepClearOfCastle(deepInside, MARGIN);
    expect(isOutsideEveryColliderBox(pushed, MARGIN)).toBe(true);
  });

  it('pushes a point out even when only the margin (not the raw box) reaches it', () => {
    const box = CASTLE_COLLIDER_BOXES[0]!; // left wall segment
    // Perturbed along Z, not X: an X push from this box's edge lands close
    // enough to the neighbouring tower box that it's ambiguous which one
    // "outside" means relative to — Z has no such neighbour to interfere.
    const boxWorldZ = CASTLE_POSITION.z + box.position.z;
    const justOutsideRawBox = {
      x: CASTLE_POSITION.x + box.position.x,
      y: CASTLE_POSITION.y + box.position.y,
      z: boxWorldZ + box.halfExtents.z + MARGIN / 2,
    };
    const pushed = keepClearOfCastle(justOutsideRawBox, MARGIN);
    expect(isOutsideEveryColliderBox(pushed, MARGIN)).toBe(true);
  });

  it('leaves the doorway opening itself untouched (not inside any box by design)', () => {
    // Same point HIDE_POINT targets — a hiding fish must still be able to
    // reach it without this function shoving it back out.
    expect(keepClearOfCastle(HIDE_POINT, MARGIN)).toEqual(HIDE_POINT);
  });
});
