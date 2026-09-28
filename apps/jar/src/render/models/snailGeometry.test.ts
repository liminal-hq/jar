// Tests for snailGeometry.ts's pure parts: measured constants, pattern-path
// id filtering, and the tuck timeline's phase-window logic. Mirrors
// `fishCollider.test.ts`'s discipline — the shader injection and the
// model's actual look are live-visual territory, out of scope here.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import type { ShellType } from '../../domain/protocol/generated/ShellType';
import {
  addFootSkinAttributes,
  createFootBones,
  createFootGeometry,
  FOOT_BONE_COUNT,
  FOOT_BONE_XS,
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

describe('foot bone chain', () => {
  it('spans exactly the foot`s own measured x extent, evenly spaced, tail to toe', () => {
    expect(FOOT_BONE_XS).toHaveLength(FOOT_BONE_COUNT);
    expect(FOOT_BONE_XS[0]).toBeCloseTo(FOOT_TAIL_TIP_X, 9);
    expect(FOOT_BONE_XS[FOOT_BONE_XS.length - 1]!).toBeCloseTo(FOOT_TOE_X, 9);
    for (let i = 1; i < FOOT_BONE_XS.length; i++) {
      expect(FOOT_BONE_XS[i]!).toBeGreaterThan(FOOT_BONE_XS[i - 1]!);
    }
    const spacing = FOOT_BONE_XS[1]! - FOOT_BONE_XS[0]!;
    for (let i = 2; i < FOOT_BONE_XS.length; i++) {
      expect(FOOT_BONE_XS[i]! - FOOT_BONE_XS[i - 1]!).toBeCloseTo(spacing, 9);
    }
  });

  it('builds a chain whose composed world positions reconstruct FOOT_BONE_XS exactly, at rest', () => {
    const bones = createFootBones();
    expect(bones).toHaveLength(FOOT_BONE_COUNT);
    // Every bone at rest should sit on the sole line with zero rotation —
    // a `Bone` extends `Object3D`, so `updateWorldMatrix` composes each
    // one's parent-relative `position` up the chain root-to-tip.
    bones[0]!.updateWorldMatrix(true, true);
    const world = new THREE.Vector3();
    bones.forEach((bone, i) => {
      bone.getWorldPosition(world);
      expect(world.x).toBeCloseTo(FOOT_BONE_XS[i]!, 9);
      expect(world.y).toBeCloseTo(SOLE_Y, 9);
      expect(world.z).toBeCloseTo(0, 9);
    });
  });

  it('parents each bone under the previous one, tail-most as the root', () => {
    const bones = createFootBones();
    expect(bones[0]!.parent).toBeNull();
    for (let i = 1; i < bones.length; i++) {
      expect(bones[i]!.parent).toBe(bones[i - 1]);
    }
  });
});

describe('addFootSkinAttributes', () => {
  it('gives every vertex skin weights that sum to exactly 1', () => {
    const geometry = createFootGeometry();
    addFootSkinAttributes(geometry);
    const weights = geometry.attributes.skinWeight!;
    for (let i = 0; i < weights.count; i++) {
      const sum = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it('only ever assigns two adjacent, in-range bone indices per vertex', () => {
    const geometry = createFootGeometry();
    addFootSkinAttributes(geometry);
    const indices = geometry.attributes.skinIndex!;
    const weights = geometry.attributes.skinWeight!;
    for (let i = 0; i < indices.count; i++) {
      const boneA = indices.getX(i);
      const boneB = indices.getY(i);
      expect(boneB).toBe(boneA + 1);
      expect(boneA).toBeGreaterThanOrEqual(0);
      expect(boneB).toBeLessThanOrEqual(FOOT_BONE_XS.length - 1);
      expect(indices.getZ(i)).toBe(0);
      expect(weights.getZ(i)).toBe(0);
      expect(indices.getW(i)).toBe(0);
      expect(weights.getW(i)).toBe(0);
    }
  });

  it('assigns the outermost bone pair, fully weighted to the extreme, for a vertex beyond the named extent', () => {
    // `FOOT_TAIL_TIP_X`/`FOOT_TOE_X` are the *named* extremes, not a laser-
    // tight bound on literally every extruded vertex (a curve's own control
    // points can extend a little past its labelled anchor — the same
    // caveat `fishGeometry.ts`'s `DORSAL_CREST_SVG_DISTANCE` documents for
    // itself) — `addFootSkinAttributes`'s own clamp is what keeps a vertex
    // out there fully (not over-) weighted onto the outermost bone.
    const geometry = createFootGeometry();
    addFootSkinAttributes(geometry);
    const position = geometry.attributes.position!;
    const indices = geometry.attributes.skinIndex!;
    const weights = geometry.attributes.skinWeight!;
    const lastBone = FOOT_BONE_XS.length - 1;
    let sawOneBeyond = false;
    for (let i = 0; i < position.count; i++) {
      if (position.getX(i) <= FOOT_TOE_X) continue;
      sawOneBeyond = true;
      expect(indices.getY(i)).toBe(lastBone);
      expect(weights.getY(i)).toBeCloseTo(1, 6);
    }
    expect(sawOneBeyond).toBe(true);
  });
});
