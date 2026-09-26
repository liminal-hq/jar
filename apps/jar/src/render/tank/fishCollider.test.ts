// Tests for fishCollider.ts: the collider box's sizing formulas, and the
// yaw-projection helpers both avoidance behaviours build on.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import {
  CASTLE_DOOR_HALF_WIDTH,
  CASTLE_KEEP_HALF_WIDTH,
  CASTLE_TOWER_HALF_WIDTH,
  CASTLE_TOWER_OFFSET,
} from '../environment/decorLayout';
import { CONTAINMENT_BUFFER } from '../steering/useFishSteering';
import { SVG_SCALE, TAIL_TIP_SVG_DISTANCE } from '../models/fishGeometry';
import type { Critter } from '../../domain/protocol/generated/Critter';
import type { FinType } from '../../domain/protocol/generated/FinType';
import type { LifeStage } from '../../domain/protocol/generated/LifeStage';
import type { Sex } from '../../domain/protocol/generated/Sex';
import {
  adultColliderHalfExtentsFor,
  colliderHalfExtentsFor,
  verticalExtent,
  worldExtentX,
  worldExtentZ,
  type ColliderHalfExtents,
} from './fishCollider';

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

const FIN_TYPES: FinType[] = ['Fan', 'Forked', 'Veil'];
const SEXES: Sex[] = ['Male', 'Female'];
const COMBOS = FIN_TYPES.flatMap((fin) => SEXES.map((sex) => ({ fin, sex })));

// Old `BallCollider` radius formula, kept here only as an independent
// regression oracle — this must never drift from `fishCollider.ts`'s own
// `.z` value.
const MALE_TAIL_SCALE = 1.2;
function legacyBallRadius(fin: FinType, sex: Sex): number {
  const tailScale = sex === 'Male' ? MALE_TAIL_SCALE : 1;
  return TAIL_TIP_SVG_DISTANCE[fin] * SVG_SCALE * tailScale;
}

describe('colliderHalfExtentsFor / adultColliderHalfExtentsFor', () => {
  it("matches the old ball collider's radius exactly on the length axis, at adult scale", () => {
    for (const { fin, sex } of COMBOS) {
      const critter = makeCritter(fin, sex, 'Adult');
      expect(colliderHalfExtentsFor(critter).z).toBeCloseTo(legacyBallRadius(fin, sex), 10);
      expect(adultColliderHalfExtentsFor(critter).z).toBeCloseTo(legacyBallRadius(fin, sex), 10);
    }
  });

  it('gives every combination the same height, well past the belly and a male tail bottom', () => {
    for (const { fin, sex } of COMBOS) {
      const he = adultColliderHalfExtentsFor(makeCritter(fin, sex, 'Adult'));
      expect(he.y).toBeCloseTo(0.312, 3);
      expect(he.y).toBeGreaterThan(46 * SVG_SCALE);
    }
  });

  it('sizes thickness with real headroom over the pectoral fins, with no sex term', () => {
    const pectoralReach = 10.1 * SVG_SCALE;
    for (const { fin, sex } of COMBOS) {
      const he = adultColliderHalfExtentsFor(makeCritter(fin, sex, 'Adult'));
      expect(he.x).toBeGreaterThanOrEqual(pectoralReach * 2);
    }
    // Fan/Forked share a value; Veil is wider; neither varies by sex.
    const fanF = adultColliderHalfExtentsFor(makeCritter('Fan', 'Female', 'Adult'));
    const fanM = adultColliderHalfExtentsFor(makeCritter('Fan', 'Male', 'Adult'));
    expect(fanF.x).toBeCloseTo(fanM.x, 10);
    const veil = adultColliderHalfExtentsFor(makeCritter('Veil', 'Female', 'Adult'));
    expect(veil.x).toBeGreaterThan(fanF.x);
  });

  it('is flatter than it is tall, and taller than it is long-scaled-down (x < y < z)', () => {
    for (const { fin, sex } of COMBOS) {
      const he = adultColliderHalfExtentsFor(makeCritter(fin, sex, 'Adult'));
      expect(he.x).toBeLessThan(he.y);
      expect(he.y).toBeLessThan(he.z);
    }
  });

  it('scales down for a fry on every axis, and adult-stage-fry matches the adult function', () => {
    const fry = makeCritter('Forked', 'Female', 'Fry');
    const adult = makeCritter('Forked', 'Female', 'Adult');
    const fryHe = colliderHalfExtentsFor(fry);
    const adultHe = adultColliderHalfExtentsFor(adult);
    expect(fryHe.x).toBeLessThan(adultHe.x);
    expect(fryHe.y).toBeLessThan(adultHe.y * 1); // bob allowance means not a pure ratio on y
    expect(fryHe.z).toBeLessThan(adultHe.z);

    const grownUp = { ...fry, life_stage: 'Adult' as LifeStage };
    expect(colliderHalfExtentsFor(grownUp)).toEqual(adultColliderHalfExtentsFor(fry));
  });
});

describe('worldExtentX / worldExtentZ', () => {
  const HE: ColliderHalfExtents = { x: 0.1, y: 0.3, z: 0.6 };

  it('is exactly the thickness on X (and length on Z) at yaw 0', () => {
    expect(worldExtentX(0, HE)).toBeCloseTo(HE.x, 10);
    expect(worldExtentZ(0, HE)).toBeCloseTo(HE.z, 10);
  });

  it('is exactly the length on X (and thickness on Z) at yaw π/2', () => {
    expect(worldExtentX(Math.PI / 2, HE)).toBeCloseTo(HE.z, 10);
    expect(worldExtentZ(Math.PI / 2, HE)).toBeCloseTo(HE.x, 10);
  });

  it('is π-periodic and symmetric under yaw negation', () => {
    const yaw = 0.7;
    expect(worldExtentX(yaw + Math.PI, HE)).toBeCloseTo(worldExtentX(yaw, HE), 10);
    expect(worldExtentX(-yaw, HE)).toBeCloseTo(worldExtentX(yaw, HE), 10);
  });

  it('never reports less than the smaller axis, and never exceeds the box diagonal', () => {
    // Not a convex combination (|cos|+|sin| exceeds 1 at intermediate
    // angles), so the projection can legitimately exceed max(x, z) —
    // up to sqrt(x²+z²), the true worst-case diagonal, at a ~45°-ish
    // yaw. This only affects the anticipatory steering margin (more
    // conservative, never less safe); the real physics collider is a
    // rigidly-rotating box, not this projection.
    const diagonal = Math.hypot(HE.x, HE.z);
    for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.3) {
      const ex = worldExtentX(yaw, HE);
      expect(ex).toBeGreaterThanOrEqual(HE.x - 1e-9);
      expect(ex).toBeLessThanOrEqual(diagonal + 1e-9);
    }
  });
});

describe('verticalExtent', () => {
  it('sits strictly between the plain height and height+length', () => {
    const he: ColliderHalfExtents = { x: 0.1, y: 0.3, z: 0.6 };
    const v = verticalExtent(he);
    expect(v).toBeGreaterThan(he.y);
    expect(v).toBeLessThan(he.y + he.z);
  });
});

describe('the goal this whole feature exists for', () => {
  it('every adult combination is thin enough to fit the keep-to-tower gap', () => {
    const gap = CASTLE_TOWER_OFFSET - CASTLE_TOWER_HALF_WIDTH - CASTLE_KEEP_HALF_WIDTH;
    for (const { fin, sex } of COMBOS) {
      const he = adultColliderHalfExtentsFor(makeCritter(fin, sex, 'Adult'));
      expect(2 * he.x).toBeLessThan(gap);
    }
  });

  it('a nose-on approach never reaches the doorway margin that used to require an exemption', () => {
    for (const { fin, sex } of COMBOS) {
      const he = adultColliderHalfExtentsFor(makeCritter(fin, sex, 'Adult'));
      expect(worldExtentX(Math.PI, he) + CONTAINMENT_BUFFER).toBeLessThan(CASTLE_DOOR_HALF_WIDTH);
    }
  });
});
