// Tests for the swim-wave math: u parameterization, envelope shaping, the
// per-vertex angle, table building, and applying a frame's deformation.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  applySwimWave,
  buildWaveTables,
  swimWaveAngle,
  swimWaveEnvelope,
  swimWaveU,
} from './swimWave';

/** A minimal real triangle geometry — `applySwimWave` needs an actual
 * `THREE.BufferGeometry` now (it calls `computeVertexNormals()` on it), not
 * just a position/normal attribute pair. */
function triangleGeometry(vertices: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
  geometry.computeVertexNormals();
  return geometry;
}

describe('swimWaveU', () => {
  it('is 0 at onset and 1 at the tip', () => {
    expect(swimWaveU(45, -100, 45)).toBe(0);
    expect(swimWaveU(-100, -100, 45)).toBe(1);
  });

  it('is monotonically increasing as commonX decreases from onset toward the tip', () => {
    const onset = 45;
    const tip = -150;
    const samples = [40, 0, -50, -100, -140];
    let prev = -Infinity;
    for (const x of samples) {
      const u = swimWaveU(x, tip, onset);
      expect(u).toBeGreaterThanOrEqual(prev);
      prev = u;
    }
  });

  it('clamps past the tip and before onset rather than going out of [0,1]', () => {
    expect(swimWaveU(200, -100, 45)).toBe(0); // forward of onset, still 0
    expect(swimWaveU(-500, -100, 45)).toBe(1); // past the tip, still 1
  });
});

describe('swimWaveEnvelope', () => {
  it('equals u through the body zone (u below the seam), independent of tipGain', () => {
    const seamU = 0.5;
    expect(swimWaveEnvelope(0.2, seamU, 3.5)).toBeCloseTo(0.2, 10);
    expect(swimWaveEnvelope(0.5, seamU, 3.5)).toBeCloseTo(0.5, 10);
  });

  it('ramps the tip boost smoothly across the tail zone, reaching tipGain-scaled at the very tip', () => {
    const seamU = 0.5;
    const tipGain = 3;
    const atTip = swimWaveEnvelope(1, seamU, tipGain);
    expect(atTip).toBeCloseTo(1 * tipGain, 10); // u=1, tipBoost=tipGain
    const midTail = swimWaveEnvelope(0.75, seamU, tipGain);
    expect(midTail).toBeGreaterThan(0.75); // boosted above plain u
    expect(midTail).toBeLessThan(atTip);
  });

  it('never discontinuously jumps at the seam', () => {
    const seamU = 0.5;
    const justBefore = swimWaveEnvelope(seamU - 0.001, seamU, 3);
    const justAfter = swimWaveEnvelope(seamU + 0.001, seamU, 3);
    expect(Math.abs(justAfter - justBefore)).toBeLessThan(0.01);
  });
});

describe('swimWaveAngle', () => {
  it('is zero at zero amplitude', () => {
    expect(swimWaveAngle(0.8, 0.5, 1.2, 0)).toBe(0);
  });

  it('scales linearly with amplitude and envelope', () => {
    const a = swimWaveAngle(0.5, 0.3, 1.0, 2);
    const b = swimWaveAngle(1.0, 0.3, 1.0, 2);
    expect(b).toBeCloseTo(a * 2, 10);
  });

  it('applies the phase lag so a further-along vertex (larger u) is out of phase with one closer to onset', () => {
    const phase = Math.PI / 2; // sin(phase) is at its peak with no lag
    const near = swimWaveAngle(1, 0, phase, 1); // u=0, no lag applied
    const far = swimWaveAngle(1, 1, phase, 1); // u=1, full lag applied
    expect(near).not.toBeCloseTo(far, 5);
  });
});

describe('buildWaveTables', () => {
  it('produces one u/env entry per vertex, matching swimWaveU/swimWaveEnvelope directly', () => {
    // Three vertices along x, at the onset, the seam, and the tip.
    const restPositions = new Float32Array([45, 0, 0, -60, 1, 0, -150, 2, 0]);
    const tables = buildWaveTables(restPositions, 0, -60, -150, 3);
    expect(tables.u[0]).toBeCloseTo(0, 5);
    expect(tables.u[2]).toBeCloseTo(1, 5);
    expect(tables.env[2]).toBeCloseTo(3, 5); // full tip boost at the tip
  });

  it('applies spaceOffsetX before evaluating u, for hinge-shifted tail geometry', () => {
    // A tail vertex at local x=0 (the hinge itself) should land exactly at
    // the seam once shifted back by TAIL_PIVOT.x=-60.
    const restPositions = new Float32Array([0, 0, 0]);
    const tables = buildWaveTables(restPositions, -60, -60, -150, 3);
    expect(tables.u[0]).toBeCloseTo(swimWaveU(-60, -150), 5);
  });
});

describe('applySwimWave', () => {
  it('leaves geometry at rest when amplitude is 0', () => {
    const restPositions = new Float32Array([10, 5, 2, 20, 5, 2, 15, 8, 2]);
    const geometry = triangleGeometry(Array.from(restPositions));
    const tables = buildWaveTables(restPositions, 0, -60, -150, 3);

    applySwimWave(geometry, restPositions, tables, 1.5, 0);

    const pos = geometry.attributes.position!;
    expect(pos.getX(0)).toBeCloseTo(10, 5);
    expect(pos.getY(0)).toBeCloseTo(5, 5);
    expect(pos.getZ(0)).toBeCloseTo(2, 5);
  });

  it('leaves y untouched and only rotates x/z', () => {
    // Deep in the tail zone, well past the onset — a triangle so
    // computeVertexNormals has real geometry to work with.
    const restPositions = new Float32Array([-140, 7, 0, -140, 7, 5, -135, 7, 2]);
    const geometry = triangleGeometry(Array.from(restPositions));
    const tables = buildWaveTables(restPositions, 0, -60, -150, 3);

    applySwimWave(geometry, restPositions, tables, 0.4, 1.0);

    const pos = geometry.attributes.position!;
    expect(pos.getY(0)).toBeCloseTo(7, 5); // y unchanged
    // Position actually moved (non-trivial angle at full tail-tip amplitude).
    expect(pos.getX(0)).not.toBeCloseTo(-140, 3);
  });

  it('recomputes normals from the deformed positions rather than leaving them at rest', () => {
    const restPositions = new Float32Array([-140, 0, -2, -140, 0, 2, -130, 4, 0]);
    const geometry = triangleGeometry(Array.from(restPositions));
    const restNormalZ = geometry.attributes.normal!.getZ(0);
    const tables = buildWaveTables(restPositions, 0, -60, -150, 3);

    applySwimWave(geometry, restPositions, tables, Math.PI / 2, 1.0);

    // A large in-plane rotation at this amplitude/phase changes which way
    // the triangle faces — the normal should have moved off its rest value,
    // proving it was actually recomputed, not left stale.
    expect(geometry.attributes.normal!.getZ(0)).not.toBeCloseTo(restNormalZ, 3);
  });

  it('rotates a hinge-shifted (tail-local) vertex about the same world pivot as an unshifted (body-space) one at the same physical seam point', () => {
    // The actual regression: the tail's rest positions are hinge-shifted by
    // `extrudeAtHinge` (local origin = the hinge, at world x = TAIL_PIVOT.x),
    // while body/dorsal positions already share the world/body-space
    // origin. A shared physical point — body-space x = -56, i.e. tail-local
    // x = -56 - TAIL_PIVOT.x = 4 when TAIL_PIVOT.x = -60 — must land at the
    // same *world* position after deformation from both representations,
    // once `rotationOffsetX` shifts the tail's rotation into that same
    // shared space.
    const tailPivotX = -60;
    const bodySpaceX = -56;
    const tailLocalX = bodySpaceX - tailPivotX; // 4

    const bodyRest = new Float32Array([bodySpaceX, 0, 3, bodySpaceX, 0, -3, bodySpaceX - 5, 4, 0]);
    const tailRest = new Float32Array([tailLocalX, 0, 3, tailLocalX, 0, -3, tailLocalX - 5, 4, 0]);

    const bodyGeometry = triangleGeometry(Array.from(bodyRest));
    const tailGeometry = triangleGeometry(Array.from(tailRest));

    // Same tip/seam parameterization for both, as `FishModel.tsx` builds
    // them (body: spaceOffsetX=0; tail: spaceOffsetX=TAIL_PIVOT.x).
    const bodyTables = buildWaveTables(bodyRest, 0, tailPivotX, -150, 3);
    const tailTables = buildWaveTables(tailRest, tailPivotX, tailPivotX, -150, 3);

    const phase = 1.1;
    const amplitude = 1.0; // large amplitude — the seam gap grows with it
    applySwimWave(bodyGeometry, bodyRest, bodyTables, phase, amplitude);
    // Tail mesh's own local origin is offset by TAIL_PIVOT.x in world space
    // (`FishModel.tsx` mounts it at `position={[TAIL_PIVOT.x, ...]}`) — so
    // the tail's *world* x is its rotated-local-x plus that same offset.
    applySwimWave(tailGeometry, tailRest, tailTables, phase, amplitude, tailPivotX);

    const bodyPos = bodyGeometry.attributes.position!;
    const tailPos = tailGeometry.attributes.position!;
    const bodyWorldX = bodyPos.getX(0);
    const bodyWorldZ = bodyPos.getZ(0);
    const tailWorldX = tailPos.getX(0) + tailPivotX;
    const tailWorldZ = tailPos.getZ(0);

    expect(tailWorldX).toBeCloseTo(bodyWorldX, 5);
    expect(tailWorldZ).toBeCloseTo(bodyWorldZ, 5);
  });
});
