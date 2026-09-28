// Tests for the decor layout constants — mostly bounds-checking, since the
// actual visual placement is a judgment call, not something to assert an
// exact value for.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { SVG_SCALE } from '../models/fishGeometry';
import { simPercentToWorld, TANK_INNER_BOUNDS, WALL_THICKNESS } from '../physics/coordinates';
import { adultColliderHalfExtentsFor, COLLIDER_HALF_THICKNESS_SVG } from '../tank/fishCollider';
import type { Critter } from '../../domain/protocol/generated/Critter';
import type { FinType } from '../../domain/protocol/generated/FinType';
import type { LifeStage } from '../../domain/protocol/generated/LifeStage';
import type { Sex } from '../../domain/protocol/generated/Sex';
import { FLOOR_SPAWN_CASTLE_MARGIN } from './crawlSurfaces';
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
  keepFloorPointClearOfCastle,
  nearestClearPoint,
  PLANT_BROADLEAF_POSITION,
  PLANT_FRONT_RIGHT_POSITION,
  PLANT_LEFT_OF_KEEP_POSITION,
  PLANT_SMALL_KELP_POSITION,
  PLANT_TALL_KELP_POSITION,
  type WorldBox,
} from './decorLayout';

const ALL_PLANT_POSITIONS = [
  PLANT_TALL_KELP_POSITION,
  PLANT_BROADLEAF_POSITION,
  PLANT_SMALL_KELP_POSITION,
  PLANT_FRONT_RIGHT_POSITION,
  PLANT_LEFT_OF_KEEP_POSITION,
];

function makeCritter(fin: FinType, sex: Sex, lifeStage: LifeStage): Critter {
  return {
    id: 1,
    species: 'Fish',
    name: 'Test',
    hue: 200,
    fin,
    shell: null,
    pattern: 'Solid',
    sex,
    personality: 'Curious',
    mood: 1,
    energy: 1,
    age_sec: 0,
    life_stage: lifeStage,
    life: 1,
    gen: 1,
    parents: null,
    alive: true,
    born: 0,
    died: null,
    favourite_spot: { x: 0, y: 0, z: 0 },
  };
}

/** The margin `Fish.tsx` passes for each fin/sex adult — the six values a
 * spawn point is actually cleared by. */
const FISH_MARGINS = (['Fan', 'Forked', 'Veil'] as FinType[]).flatMap((fin) =>
  (['Male', 'Female'] as Sex[]).map(
    (sex) => adultColliderHalfExtentsFor(makeCritter(fin, sex, 'Adult')).z,
  ),
);

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

describe('the fish margins under test', () => {
  it('cover all six fin and sex combinations', () => {
    expect(FISH_MARGINS).toHaveLength(6);
  });
});

describe('keepClearOfCastle', () => {
  const MARGIN = Math.min(...FISH_MARGINS); // the smallest adult fish collider half-length

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

  it('clears the castle even when the cheapest push axis would land past the tank wall', () => {
    // A female Forked fish's adult-collider margin, starting inside the
    // right wall segment's expanded box close enough to the back wall that
    // the smallest-penetration axis (z) pushes past `TANK_INNER_BOUNDS.z`,
    // which the tank bound then pulls straight back inside the box on
    // that same axis — the choice of escape has to account for the bounds.
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

    expect(isOutsideEveryColliderBox(pushed, margin)).toBe(true);
    expect(Math.abs(pushed.x)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.x - margin + 1e-9);
    expect(Math.abs(pushed.y)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.y - margin + 1e-9);
    expect(Math.abs(pushed.z)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.z - margin + 1e-9);
  });

  it.each(FISH_MARGINS.map((margin) => [margin]))(
    'clears the castle and stays in the tank for every favourite spot a critter can roll at margin %s',
    (margin) => {
      // `Fish.tsx` feeds this the output of `simPercentToWorld` for a rolled
      // `favourite_spot` and mounts the fish's RigidBody at the result, so a
      // single spot left inside the castle (a Rapier depenetration pop) or
      // outside the glass (unrecoverable) is a visible bug. Failures are
      // collected rather than asserted per point: one `expect` over the
      // whole lattice names the offending spots without paying for half a
      // million assertions to prove there are none.
      const clearance = WALL_THICKNESS / 2 + margin;
      const failures: Array<{ percent: number[]; reasons: string[]; pushed: unknown }> = [];
      let rawInside = 0;
      for (let xPercent = 0; xPercent <= 100; xPercent += 1) {
        for (let yPercent = 0; yPercent <= 100; yPercent += 1) {
          for (let zPercent = 0; zPercent <= 100; zPercent += 2) {
            const spot = simPercentToWorld(xPercent, yPercent, zPercent, clearance);
            const pushed = keepClearOfCastle(spot, margin);
            const reasons: string[] = [];
            if (!isInsideTank(pushed, margin)) reasons.push('outside the tank');
            if (!isOutsideEveryColliderBox(pushed, 0)) {
              rawInside++;
              reasons.push('inside a raw box');
            }
            if (!isOutsideEveryColliderBox(pushed, margin)) reasons.push('inside an expanded box');
            if (
              isOutsideEveryColliderBox(spot, margin) &&
              isInsideTank(spot, margin) &&
              (pushed.x !== spot.x || pushed.y !== spot.y || pushed.z !== spot.z)
            ) {
              reasons.push('moved a spot that was already clear');
            }
            if (reasons.length > 0) {
              failures.push({ percent: [xPercent, yPercent, zPercent], reasons, pushed });
            }
          }
        }
      }
      expect({ count: failures.length, rawInside, sample: failures.slice(0, 10) }).toEqual({
        count: 0,
        rawInside: 0,
        sample: [],
      });
    },
    { timeout: 30_000 },
  );
});

describe('keepClearOfCastle regressions', () => {
  function expectClear(point: { x: number; y: number; z: number }, margin: number, raw = true) {
    expect(isInsideTank(point, margin)).toBe(true);
    if (raw) expect(isOutsideEveryColliderBox(point, 0)).toBe(true);
    expect(isOutsideEveryColliderBox(point, margin)).toBe(true);
  }
  const distance = (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
  ) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

  it.each([0.456, 0.508, 0.547])(
    'clears the pocket between a wall segment and its tower at margin %s',
    (margin) => {
      // The wall segment's and the tower's expanded boxes overlap here
      // (2 * margin exceeds the 0.325 keep-to-tower gap), so pushing out
      // of one lands inside the other.
      expectClear(keepClearOfCastle({ x: -1.0, y: -1.2, z: -0.3 }, margin), margin);
    },
  );

  it('clears a traced favourite spot (20%, 91.5%, 16%) at margin 0.456', () => {
    const margin = 0.456;
    const spot = simPercentToWorld(20, 91.5, 16, WALL_THICKNESS / 2 + margin);
    expectClear(keepClearOfCastle(spot, margin), margin);
  });

  it('takes the short two-axis move at the doorway and lintel corner rather than a long single-axis one', () => {
    const margin = 0.456;
    const start = { x: 0.14, y: -1.05, z: -0.844 };
    const pushed = keepClearOfCastle(start, margin);
    expectClear(pushed, margin);
    expect(distance(pushed, start)).toBeLessThan(0.05);
    expect(pushed.x).toBeCloseTo(0.181001, 5);
    expect(pushed.y).toBeCloseTo(-1.056001, 5);
    expect(pushed.z).toBeCloseTo(-0.844, 5);
  });

  it('finds the only clear space by moving on two axes at margin 1.0', () => {
    const pushed = keepClearOfCastle({ x: -0.5, y: -1.0, z: -0.3 }, 1.0);
    expectClear(pushed, 1.0);
    expect(pushed.x).toBeCloseTo(-1.825, 2);
    expect(pushed.y).toBeCloseTo(0.15, 2);
    expect(pushed.z).toBeCloseTo(-0.3, 2);
  });

  it('falls back to raw clearance when no point clears the expanded boxes (margin 1.2)', () => {
    const margin = 1.2;
    const pushed = keepClearOfCastle({ x: -0.5, y: -1.0, z: -0.3 }, margin);
    expect(isInsideTank(pushed, margin)).toBe(true);
    expect(isOutsideEveryColliderBox(pushed, 0)).toBe(true);
    expect(isOutsideEveryColliderBox(pushed, margin)).toBe(false);
    expect(pushed.x).toBeCloseTo(-0.5, 2);
    expect(pushed.y).toBeCloseTo(-0.65, 2);
    expect(pushed.z).toBeCloseTo(-0.025, 2);
  });
});

describe('nearestClearPoint', () => {
  const bounds = { x: 2, y: 2, z: 2 };

  it('returns the clamped input when a box covers the whole bounds', () => {
    const everything: WorldBox = {
      centre: { x: 0, y: 0, z: 0 },
      half: { x: 10, y: 10, z: 10 },
    };
    expect(nearestClearPoint({ x: 5, y: 0.5, z: -7 }, [everything], bounds, 0)).toEqual({
      x: 2,
      y: 0.5,
      z: -2,
    });
  });

  it('resolves a tie deterministically to the +x face', () => {
    const cube: WorldBox = { centre: { x: 0, y: 0, z: 0 }, half: { x: 1, y: 1, z: 1 } };
    const first = nearestClearPoint({ x: 0, y: 0, z: 0 }, [cube], bounds, 0);
    const second = nearestClearPoint({ x: 0, y: 0, z: 0 }, [cube], bounds, 0);
    expect(first.x).toBeCloseTo(1, 5);
    expect(first.x).toBeGreaterThan(1);
    expect(first.y).toBe(0);
    expect(first.z).toBe(0);
    expect(second).toEqual(first);
  });

  it('never moves a held axis', () => {
    const cube: WorldBox = { centre: { x: 0, y: 0, z: 0 }, half: { x: 1, y: 1, z: 1 } };
    const pushed = nearestClearPoint({ x: 0.2, y: 0.3, z: 0.1 }, [cube], bounds, 0, ['y']);
    expect(pushed.y).toBe(0.3);
    expect(Math.abs(pushed.x) >= 1 || Math.abs(pushed.z) >= 1).toBe(true);
  });
});

describe('keepFloorPointClearOfCastle', () => {
  it.each([FLOOR_SPAWN_CASTLE_MARGIN, 0.3, 0.5])(
    'keeps a footprint of half-length %s off every floor-standing box and inside the tank',
    (margin) => {
      // 0.5 is the unscaled adult snail half-length — headroom for the
      // pending collider retune. Boxes 0, 1, 3 and 4 stand on the sand; the
      // lintel floats above the doorway, so the floor beneath it is open.
      const floorBoxes = [0, 1, 3, 4].map((index) => CASTLE_COLLIDER_BOXES[index]!);
      const failures: Array<{ x: number; z: number; reason: string; clear: unknown }> = [];
      const xSteps = 1000;
      const zSteps = 500;
      for (let i = 0; i <= xSteps; i++) {
        for (let k = 0; k <= zSteps; k++) {
          const x = -TANK_INNER_BOUNDS.x + (2 * TANK_INNER_BOUNDS.x * i) / xSteps;
          const z = -TANK_INNER_BOUNDS.z + (2 * TANK_INNER_BOUNDS.z * k) / zSteps;
          const clear = keepFloorPointClearOfCastle({ x, z }, margin);
          const onBox = floorBoxes.some(
            (box) =>
              Math.abs(clear.x - (CASTLE_POSITION.x + box.position.x)) <
                box.halfExtents.x + margin &&
              Math.abs(clear.z - (CASTLE_POSITION.z + box.position.z)) < box.halfExtents.z + margin,
          );
          if (onBox) failures.push({ x, z, reason: 'on a floor-standing box', clear });
          if (
            Math.abs(clear.x) > TANK_INNER_BOUNDS.x - margin + 1e-9 ||
            Math.abs(clear.z) > TANK_INNER_BOUNDS.z - margin + 1e-9
          ) {
            failures.push({ x, z, reason: 'outside the tank', clear });
          }
        }
      }
      expect({ count: failures.length, sample: failures.slice(0, 10) }).toEqual({
        count: 0,
        sample: [],
      });
      // The doorway floor is open, so a point under the castle's centre stays put.
      const doorway = { x: CASTLE_POSITION.x, z: CASTLE_POSITION.z };
      expect(keepFloorPointClearOfCastle(doorway, margin)).toEqual(doorway);
    },
    { timeout: 30_000 },
  );
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
