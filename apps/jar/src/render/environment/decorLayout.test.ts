// Tests for the decor layout constants — mostly bounds-checking, since the
// actual visual placement is a judgment call, not something to assert an
// exact value for.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { SVG_SCALE } from '../models/fishGeometry';
import { simPercentToWorld, TANK_INNER_BOUNDS, WALL_THICKNESS } from '../physics/coordinates';
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

  it('stays inside the tank even when no axis can clear the box without leaving it', () => {
    // The right tower sits close enough to the +x glass, the floor and the
    // back glass at once that for a female Forked fish's adult-collider
    // margin, *all three* escape directions from the corner of its expanded
    // box land outside the tank. With no feasible axis to prefer, the push
    // falls back to the cheapest one — and unclamped, that put the critter's
    // spawn point past the +x wall collider entirely, on the wrong side of
    // the glass, where nothing can ever steer it back in
    // (`render/physics/tankEscape.ts`).
    const margin = 0.456;
    const tower = CASTLE_COLLIDER_BOXES[4]!; // right tower
    const towerWorld = {
      x: CASTLE_POSITION.x + tower.position.x,
      y: CASTLE_POSITION.y + tower.position.y,
      z: CASTLE_POSITION.z + tower.position.z,
    };
    // Offset toward the glass, the floor and the back wall — the one octant
    // of the expanded box where every escape target is out of bounds.
    const cornered = { x: towerWorld.x + 0.05, y: towerWorld.y - 0.05, z: towerWorld.z - 0.05 };
    const pushed = keepClearOfCastle(cornered, margin);

    expect(Math.abs(pushed.x)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.x - margin + 1e-9);
    expect(Math.abs(pushed.y)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.y - margin + 1e-9);
    expect(Math.abs(pushed.z)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.z - margin + 1e-9);
  });

  it('never leaves the tank for any favourite spot a critter can actually roll', () => {
    // `Fish.tsx` feeds this the output of `simPercentToWorld` for a rolled
    // `favourite_spot` and mounts the fish's RigidBody at the result, so a
    // single out-of-bounds point anywhere in that space is a fish spawned
    // outside the glass. Margins span every fin/sex adult collider length
    // (`fishCollider.ts`'s `adultColliderHalfExtentsFor(...).z`).
    // Collected rather than asserted per point: one `expect` over the whole
    // space names the offending spot if there is one, without paying for a
    // few million assertions to prove there isn't.
    const escaped: Array<{ margin: number; percent: number[]; pushed: unknown }> = [];
    for (const margin of [0.456, 0.508, 0.547, 0.604, 0.61, 0.725]) {
      const clearance = WALL_THICKNESS / 2 + margin;
      for (let xPercent = 0; xPercent <= 100; xPercent += 1) {
        for (let yPercent = 0; yPercent <= 100; yPercent += 1) {
          for (let zPercent = 0; zPercent <= 100; zPercent += 2) {
            const spot = simPercentToWorld(xPercent, yPercent, zPercent, clearance);
            const pushed = keepClearOfCastle(spot, margin);
            if (!isInsideTank(pushed)) {
              escaped.push({ margin, percent: [xPercent, yPercent, zPercent], pushed });
            }
          }
        }
      }
    }
    expect(escaped).toEqual([]);
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
