// Tests for snailCollider.ts: per-shell-type box extents and the
// centre-offset invariant, mirroring fishCollider.test.ts's discipline of
// pinning the formulas against the measured geometry constants they derive
// from rather than just re-asserting the implementation.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import type { Critter } from '../../domain/protocol/generated/Critter';
import type { LifeStage } from '../../domain/protocol/generated/LifeStage';
import type { ShellType } from '../../domain/protocol/generated/ShellType';
import { lifeStageScale } from '../../domain/simConstants';
import {
  FOOT_DEPTH,
  FOOT_TAIL_TIP_X,
  SHELL_APEX_HEIGHT_ABOVE_SOLE,
  SHELL_EXTRUSION_DEPTH,
  SOLE_Y,
  SVG_SCALE,
} from '../models/snailGeometry';
import { snailColliderHalfExtentsFor, type SnailColliderHalfExtents } from './snailCollider';

function makeCritter(shell: ShellType, lifeStage: LifeStage): Critter {
  return {
    id: 1,
    species: 'Snail',
    name: 'Test',
    hue: 120,
    fin: null,
    spots: false,
    shell,
    pattern: 'Solid',
    sex: 'Female',
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

const SHELL_TYPES: ShellType[] = ['Coil', 'Ramshorn', 'Turret'];

describe('snailColliderHalfExtentsFor', () => {
  it('sizes halfLength from the foot tail-tip extent, scaled by SVG_SCALE, for every shell', () => {
    for (const shell of SHELL_TYPES) {
      const he = snailColliderHalfExtentsFor(makeCritter(shell, 'Adult'));
      expect(he.z).toBeCloseTo(Math.abs(FOOT_TAIL_TIP_X) * SVG_SCALE, 10);
    }
  });

  it('sizes halfHeight from half the apex-above-sole distance, per shell', () => {
    for (const shell of SHELL_TYPES) {
      const he = snailColliderHalfExtentsFor(makeCritter(shell, 'Adult'));
      expect(he.y).toBeCloseTo((SHELL_APEX_HEIGHT_ABOVE_SOLE[shell] / 2) * SVG_SCALE, 10);
    }
  });

  it('positions centreOffsetY so the box bottom face sits exactly on the sole line', () => {
    for (const shell of SHELL_TYPES) {
      const he = snailColliderHalfExtentsFor(makeCritter(shell, 'Adult'));
      expect(he.centreOffsetY - he.y).toBeCloseTo(SOLE_Y * SVG_SCALE, 10);
    }
  });

  it('Turret is the tallest shell and Ramshorn is the thinnest', () => {
    const byShell: Record<ShellType, SnailColliderHalfExtents> = Object.fromEntries(
      SHELL_TYPES.map((shell) => [shell, snailColliderHalfExtentsFor(makeCritter(shell, 'Adult'))]),
    ) as Record<ShellType, SnailColliderHalfExtents>;

    expect(byShell.Turret.y).toBeGreaterThan(byShell.Coil.y);
    expect(byShell.Turret.y).toBeGreaterThan(byShell.Ramshorn.y);

    expect(byShell.Ramshorn.x).toBeLessThan(byShell.Turret.x);
    expect(byShell.Ramshorn.x).toBeLessThan(byShell.Coil.x);
  });

  it('every shell type has real headroom over both the shell and foot extrusion depth', () => {
    for (const shell of SHELL_TYPES) {
      const he = snailColliderHalfExtentsFor(makeCritter(shell, 'Adult'));
      const measuredHalfThickness = Math.max(SHELL_EXTRUSION_DEPTH[shell], FOOT_DEPTH) / 2;
      expect(he.x).toBeGreaterThan(measuredHalfThickness * SVG_SCALE);
    }
  });

  it('scales down for a fry on every axis, keeping the offset self-consistent', () => {
    const fry = makeCritter('Coil', 'Fry');
    const adult = makeCritter('Coil', 'Adult');
    const fryHe = snailColliderHalfExtentsFor(fry);
    const adultHe = snailColliderHalfExtentsFor(adult);

    expect(fryHe.x).toBeLessThan(adultHe.x);
    expect(fryHe.y).toBeLessThan(adultHe.y);
    expect(fryHe.z).toBeLessThan(adultHe.z);
    expect(fryHe.centreOffsetY - fryHe.y).toBeCloseTo(
      SOLE_Y * SVG_SCALE * lifeStageScale('Fry'),
      10,
    );
  });

  it('falls back to Coil sizing when shell is null', () => {
    const noShell = { ...makeCritter('Coil', 'Adult'), shell: null };
    expect(snailColliderHalfExtentsFor(noShell)).toEqual(
      snailColliderHalfExtentsFor(makeCritter('Coil', 'Adult')),
    );
  });
});
