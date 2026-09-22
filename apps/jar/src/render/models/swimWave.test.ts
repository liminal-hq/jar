// Tests for the swim-wave math: u parameterization, envelope shaping, the
// per-vertex angle, table building, and applying a frame's deformation.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import {
  applySwimWave,
  buildWaveTables,
  swimWaveAngle,
  swimWaveEnvelope,
  swimWaveU,
} from './swimWave';

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
    const restPositions = new Float32Array([10, 5, 2]);
    const restNormals = new Float32Array([0, 1, 0]);
    const tables = buildWaveTables(restPositions, 0, -60, -150, 3);
    const written: number[][] = [];
    const position = {
      setXYZ: (i: number, x: number, y: number, z: number) => {
        written[i] = [x, y, z];
      },
      needsUpdate: false,
    };
    const normal = {
      setXYZ: () => {},
      needsUpdate: false,
    };

    applySwimWave(position, normal, restPositions, restNormals, tables, 1.5, 0);

    expect(written[0]![0]).toBeCloseTo(10, 5);
    expect(written[0]![1]).toBeCloseTo(5, 5);
    expect(written[0]![2]).toBeCloseTo(2, 5);
    expect(position.needsUpdate).toBe(true);
  });

  it('leaves y untouched and only rotates x/z, for both position and normal', () => {
    const restPositions = new Float32Array([-140, 7, 0]); // deep in the tail zone
    const restNormals = new Float32Array([1, 0, 0]);
    const tables = buildWaveTables(restPositions, 0, -60, -150, 3);
    let writtenPos: number[] = [];
    let writtenNormal: number[] = [];
    const position = {
      setXYZ: (_i: number, x: number, y: number, z: number) => {
        writtenPos = [x, y, z];
      },
      needsUpdate: false,
    };
    const normal = {
      setXYZ: (_i: number, x: number, y: number, z: number) => {
        writtenNormal = [x, y, z];
      },
      needsUpdate: false,
    };

    applySwimWave(position, normal, restPositions, restNormals, tables, 0.4, 1.0);

    expect(writtenPos[1]).toBeCloseTo(7, 5); // y unchanged
    expect(writtenNormal[1]).toBeCloseTo(0, 5); // normal's y unchanged
    // Position actually moved (non-trivial angle at full tail-tip amplitude).
    expect(writtenPos[0]).not.toBeCloseTo(-140, 3);
  });
});
