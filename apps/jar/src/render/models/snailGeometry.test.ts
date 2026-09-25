// Tests for snailGeometry.ts's pure parts: measured constants, pattern-path
// id filtering, and the tuck timeline's phase-window logic. Mirrors
// `fishCollider.test.ts`'s discipline — the shader injection and the
// model's actual look are live-visual territory, out of scope here.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import type { ShellType } from '../../domain/protocol/generated/ShellType';
import {
  FOOT_TAIL_TIP_X,
  FOOT_TOE_X,
  OPERCULUM_EXTRUSION_DEPTH,
  SHELL_APEX_HEIGHT_ABOVE_SOLE,
  SHELL_BASE_Y,
  SHELL_EXTRUSION_DEPTH,
  SHELL_SEALED_DROP,
  shellIdentityDecalIds,
  shellPatternDecalIds,
  SOLE_Y,
  STARTLE_MAX_PROGRESS,
  tuckPose,
  tuckPoseForMode,
} from './snailGeometry';

const SHELL_TYPES: ShellType[] = ['Coil', 'Ramshorn', 'Turret'];

describe('measured shell constants', () => {
  it('gives every shell type a positive extrusion depth, with Ramshorn the thinnest', () => {
    for (const shell of SHELL_TYPES) {
      expect(SHELL_EXTRUSION_DEPTH[shell]).toBeGreaterThan(0);
    }
    expect(SHELL_EXTRUSION_DEPTH.Ramshorn).toBeLessThan(SHELL_EXTRUSION_DEPTH.Coil);
    expect(SHELL_EXTRUSION_DEPTH.Ramshorn).toBeLessThan(SHELL_EXTRUSION_DEPTH.Turret);
  });

  it('derives the operculum depth as shell depth minus 6, never duplicated', () => {
    for (const shell of SHELL_TYPES) {
      expect(OPERCULUM_EXTRUSION_DEPTH[shell]).toBe(SHELL_EXTRUSION_DEPTH[shell] - 6);
    }
  });

  it('gives Turret the tallest apex, matching the drama-piece framing', () => {
    expect(SHELL_APEX_HEIGHT_ABOVE_SOLE.Turret).toBeGreaterThan(SHELL_APEX_HEIGHT_ABOVE_SOLE.Coil);
    expect(SHELL_APEX_HEIGHT_ABOVE_SOLE.Turret).toBeGreaterThan(
      SHELL_APEX_HEIGHT_ABOVE_SOLE.Ramshorn,
    );
  });

  it('places the shell drop exactly where the base lands on the sole line', () => {
    expect(SHELL_BASE_Y - SHELL_SEALED_DROP).toBe(SOLE_Y);
    expect(SHELL_SEALED_DROP).toBe(30);
  });

  it('gives the foot a positive length, toe ahead of the tail tip', () => {
    expect(FOOT_TOE_X).toBeGreaterThan(FOOT_TAIL_TIP_X);
    expect(FOOT_TOE_X - FOOT_TAIL_TIP_X).toBe(221);
  });
});

describe('shellIdentityDecalIds / shellPatternDecalIds', () => {
  it('always shows each shell type’s own identity decal(s), regardless of pattern', () => {
    expect(shellIdentityDecalIds('Coil')).toEqual(['shell-whorl']);
    expect(shellIdentityDecalIds('Ramshorn')).toEqual([
      'shell-ring-outer',
      'shell-ring-inner',
      'shell-core',
    ]);
    expect(shellIdentityDecalIds('Turret')).toEqual(['shell-tip']);
  });

  it('shows no pattern decal ids for Solid', () => {
    for (const shell of SHELL_TYPES) {
      expect(shellPatternDecalIds(shell, 'Solid')).toEqual([]);
    }
  });

  it('gives Turret four banded ids (one per whorl step) and the others one', () => {
    expect(shellPatternDecalIds('Coil', 'Banded')).toEqual(['shell-band']);
    expect(shellPatternDecalIds('Ramshorn', 'Banded')).toEqual(['shell-band']);
    expect(shellPatternDecalIds('Turret', 'Banded')).toEqual([
      'shell-band-1',
      'shell-band-2',
      'shell-band-3',
      'shell-band-4',
    ]);
  });

  it('gives Coil the most spots, Ramshorn/Turret four each', () => {
    expect(shellPatternDecalIds('Coil', 'Spotted')).toHaveLength(6);
    expect(shellPatternDecalIds('Ramshorn', 'Spotted')).toHaveLength(4);
    expect(shellPatternDecalIds('Turret', 'Spotted')).toHaveLength(4);
  });

  it('never overlaps an identity decal id with a pattern decal id, per shell', () => {
    for (const shell of SHELL_TYPES) {
      const identity = new Set(shellIdentityDecalIds(shell));
      for (const pattern of ['Banded', 'Spotted'] as const) {
        for (const id of shellPatternDecalIds(shell, pattern)) {
          expect(identity.has(id)).toBe(false);
        }
      }
    }
  });
});

describe('tuckPose', () => {
  it('is fully awake/emerged at t=0', () => {
    const pose = tuckPose(0);
    expect(pose.eyestalkFold).toBe(0);
    expect(pose.footWithdraw).toBe(0);
    expect(pose.shellSettle).toBe(0);
    expect(pose.operculumSeal).toBe(0);
  });

  it('is fully sealed at t=1', () => {
    const pose = tuckPose(1);
    expect(pose.eyestalkFold).toBe(1);
    expect(pose.footWithdraw).toBe(1);
    expect(pose.shellSettle).toBe(1);
    expect(pose.operculumSeal).toBe(1);
  });

  it('clamps outside [0,1] rather than overshooting', () => {
    expect(tuckPose(-1).eyestalkFold).toBe(0);
    expect(tuckPose(2).operculumSeal).toBe(1);
  });

  it('folds the eyestalks over the first 45%, finishing well before the foot starts withdrawing ends', () => {
    expect(tuckPose(0.45).eyestalkFold).toBe(1);
    expect(tuckPose(0.3).eyestalkFold).toBeGreaterThan(0);
    expect(tuckPose(0.3).eyestalkFold).toBeLessThan(1);
  });

  it('withdraws the foot from 10% to 72%, at rest before and after', () => {
    expect(tuckPose(0.1).footWithdraw).toBe(0);
    expect(tuckPose(0.72).footWithdraw).toBe(1);
    expect(tuckPose(0.05).footWithdraw).toBe(0);
    expect(tuckPose(0.9).footWithdraw).toBe(1);
    const mid = tuckPose(0.41).footWithdraw;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('seals the operculum only over the last 30%', () => {
    expect(tuckPose(0.7).operculumSeal).toBe(0);
    expect(tuckPose(0.69).operculumSeal).toBe(0);
    expect(tuckPose(0.85).operculumSeal).toBeGreaterThan(0);
    expect(tuckPose(0.85).operculumSeal).toBeLessThan(1);
  });
});

describe('tuckPoseForMode', () => {
  it('sleep mode matches the plain tuckPose timeline', () => {
    for (const t of [0, 0.3, 0.72, 0.9, 1]) {
      expect(tuckPoseForMode(t, 'sleep')).toEqual(tuckPose(t));
    }
  });

  it('startle never opens the operculum, even driven all the way to t=1', () => {
    expect(tuckPoseForMode(1, 'startle').operculumSeal).toBe(0);
    expect(tuckPoseForMode(0.8, 'startle').operculumSeal).toBe(0);
  });

  it('startle still folds the eyestalks and withdraws the foot', () => {
    const pose = tuckPoseForMode(1, 'startle');
    expect(pose.eyestalkFold).toBe(1);
    expect(pose.footWithdraw).toBeGreaterThan(0.9);
  });

  it('startle matches sleep up to the point it caps progress', () => {
    expect(tuckPoseForMode(0.5, 'startle')).toEqual(tuckPose(0.5));
    expect(STARTLE_MAX_PROGRESS).toBeLessThanOrEqual(1);
    expect(STARTLE_MAX_PROGRESS).toBeGreaterThan(0);
  });
});
