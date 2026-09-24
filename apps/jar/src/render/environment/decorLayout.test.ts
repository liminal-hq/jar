// Tests for the decor layout constants — mostly bounds-checking, since the
// actual visual placement is a judgment call, not something to assert an
// exact value for.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { SVG_SCALE } from '../models/fishGeometry';
import { TANK_INNER_BOUNDS, WALL_THICKNESS } from '../physics/coordinates';
import { COLLIDER_HALF_THICKNESS_SVG } from '../tank/fishCollider';
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
  const MARGIN = 0.3; // a plausible fish collider length (fishCollider.ts's adultColliderHalfExtentsFor(...).z runs 0.46-0.72)

  it('leaves a point that is already clear of every box, well inside the tank, untouched', () => {
    const clear = { x: -2, y: 0, z: 0 };
    expect(keepClearOfCastle(clear, MARGIN)).toEqual(clear);
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

  it('does not push a point past the tank wall while clearing a tower near it', () => {
    // A tower sits close enough to the back wall that pushing straight out
    // of it, with no tank-bounds awareness, can land past that wall.
    const tower = CASTLE_COLLIDER_BOXES[3]!; // left tower
    const towerWorld = {
      x: CASTLE_POSITION.x + tower.position.x,
      y: CASTLE_POSITION.y + tower.position.y,
      z: CASTLE_POSITION.z + tower.position.z,
    };
    const behindTower = {
      x: towerWorld.x,
      y: towerWorld.y,
      z: towerWorld.z - tower.halfExtents.z - 0.05, // just past its back face
    };
    const pushed = keepClearOfCastle(behindTower, MARGIN);

    expect(isOutsideEveryColliderBox(pushed, MARGIN)).toBe(true);
    expect(Math.abs(pushed.x)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.x - MARGIN + 1e-9);
    expect(Math.abs(pushed.y)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.y - MARGIN + 1e-9);
    expect(Math.abs(pushed.z)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.z - MARGIN + 1e-9);
  });

  it('converges even when the cheapest push axis would land past the tank wall', () => {
    // A female Forked fish's adult-collider margin, starting inside the
    // right wall segment's expanded box close enough to the back wall that
    // the smallest-penetration axis (z) pushes past `TANK_INNER_BOUNDS.z`,
    // which the next pass's clamp then pulls straight back inside the box
    // on that same axis — an infinite oscillation unless the axis choice
    // itself accounts for tank-bounds feasibility.
    const margin = 0.456;
    // x tracks the right wall segment box's own position (`CASTLE_POSITION.x
    // + CASTLE_KEEP_HALF_WIDTH`-ish), which moved when `CASTLE_POSITION.x`
    // did (0.5 -> 0.375, widening the tower-to-glass gap) — offset by the
    // same amount so this still starts inside that box, close to the back
    // wall, reproducing the same edge case.
    const start = { x: 1.4 - (0.5 - CASTLE_POSITION.x), y: -1.1, z: -0.5 };
    const pushed = keepClearOfCastle(start, margin);

    expect(isOutsideEveryColliderBox(pushed, margin)).toBe(true);
    expect(Math.abs(pushed.x)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.x - margin + 1e-9);
    expect(Math.abs(pushed.y)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.y - margin + 1e-9);
    expect(Math.abs(pushed.z)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.z - margin + 1e-9);
  });
});

describe('the keep-to-tower gap', () => {
  it('stays wide enough for the flattest fish collider to fit through (fishCollider.test.ts pins the fish side of this)', () => {
    const gap = CASTLE_TOWER_OFFSET - CASTLE_TOWER_HALF_WIDTH - CASTLE_KEEP_HALF_WIDTH;
    expect(gap).toBeCloseTo(0.325, 5);
  });
});

describe('the tower-to-glass gap', () => {
  it('stays wide enough for even the widest (Veil) fish collider to physically fit through', () => {
    // Tank glass's clear inner face — `TANK_INNER_BOUNDS.x` is the wall
    // collider's own *centre* plane (its own doc comment), not the clear
    // face, so half the wall thickness comes off.
    const glassInnerFace = TANK_INNER_BOUNDS.x - WALL_THICKNESS / 2;
    const towerOuterEdge = CASTLE_POSITION.x + CASTLE_TOWER_OFFSET + CASTLE_TOWER_HALF_WIDTH;
    const gap = glassInnerFace - towerOuterEdge;
    // Computed from the real collider policy constants, not copied as a
    // literal, so a future change to `COLLIDER_HALF_THICKNESS_SVG` can't
    // silently widen the fish past this gap without this test catching
    // it. Sex-independent for thickness, so no fin/sex loop is needed —
    // just the single widest fin type. This gap used to be 0.225, *under*
    // even the widest fish, before `CASTLE_POSITION.x` moved from 0.5 to
    // 0.375 specifically to fix it.
    const widestFishThicknessSvg = Math.max(...Object.values(COLLIDER_HALF_THICKNESS_SVG));
    const widestFishDiameter = widestFishThicknessSvg * SVG_SCALE * 2;
    expect(gap).toBeGreaterThan(widestFishDiameter);
  });
});
