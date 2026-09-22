// The unified per-vertex "swim wave" deformer — generalizes the tail's
// original per-vertex progressive bend (once Veil-only) into one continuous
// wave spanning the body, dorsal fin, and all three tail types, replacing
// the rigid tail-pivot swing entirely. See
// `docs/architecture/3d-engine.md` §6.2/§6.6.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

/** How much extra amplitude the tail portion of the wave gets, ramping
 * smoothly from 1x at the body/tail seam to this value at the tail's own
 * tip — the body portion is always 1x regardless of fin type. Veil (the
 * proven, already-flowing motion) highest; Fan/Forked moderate. Replaces
 * the old flat `VEIL_BEND_AMPLITUDE`/`RIGID_TAIL_AMPLITUDE_MULTIPLIER`
 * constants (`FishModel.tsx`). Tune by eye. */
export const FIN_SWIM_TIP_GAIN: Record<'Fan' | 'Forked' | 'Veil', number> = {
  Veil: 3.5,
  Fan: 1.8,
  Forked: 1.8,
};

/** Body-space x at/beyond which the wave is zero — protects the rigid head
 * (eye x=68, mouth hinge x=90, pectoral hinge x=52 all sit forward of
 * this). Tune by eye against the real silhouette. */
export const SWIM_WAVE_ONSET_X = 45;

/** Phase lag across the *entire* onset-to-tail-tip span — the old
 * veil-only bend's `1.1` covered just the tail; a full-body span needs
 * more so the wave still reads as traveling rather than instant. Tune by
 * eye. */
export const SWIM_WAVE_LAG = 2.2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Where a vertex sits along the shared onset→tail-tip span: 0 at onset, 1
 * at the tail tip. `commonX` must already be in the body's own local space
 * — body/dorsal vertices already are; tail vertices (hinge-shifted by
 * `extrudeAtHinge`, `fishGeometry.ts`) need `TAIL_PIVOT.x` added back in
 * first (`buildWaveTables`'s `spaceOffsetX` does this). */
export function swimWaveU(commonX: number, tipCommonX: number, onsetX = SWIM_WAVE_ONSET_X): number {
  return clamp((onsetX - commonX) / (onsetX - tipCommonX), 0, 1);
}

/** The per-vertex envelope: `u` itself through the body, then further
 * boosted by `tipGain` — ramped in smoothly across the tail's own span
 * alone (`seamU` to `1`), never a discontinuous jump at the body/tail
 * seam. The `u`-dependent half of the wave, precomputed once per geometry
 * (`buildWaveTables`) rather than recomputed every frame, since only
 * `phase`/`amplitude` actually change frame to frame. */
export function swimWaveEnvelope(u: number, seamU: number, tipGain: number): number {
  const tailU = seamU < 1 ? clamp((u - seamU) / (1 - seamU), 0, 1) : 0;
  const tipBoost = 1 + (tipGain - 1) * tailU;
  return u * tipBoost;
}

/** The full per-vertex rotation angle for this frame, about the mesh's own
 * local Y axis — `env`/`u` are the precomputed per-vertex values from
 * `swimWaveEnvelope`/`swimWaveU`. */
export function swimWaveAngle(
  env: number,
  u: number,
  phase: number,
  amplitude: number,
  lag = SWIM_WAVE_LAG,
): number {
  return amplitude * env * Math.sin(phase - lag * u);
}

export interface WaveTables {
  u: Float32Array;
  env: Float32Array;
}

/** Precomputes `u`/`env` for every vertex in a rest-position array
 * (x,y,z-interleaved, matching `BufferAttribute`'s own layout) — call once
 * per geometry clone, not per frame. `spaceOffsetX` converts this mesh's
 * own local x into the shared body-space x the wave is defined in: `0` for
 * body/dorsal (which already share that space), `TAIL_PIVOT.x` for tail
 * geometry (which `extrudeAtHinge` has shifted by that same amount, so
 * adding it back recovers the shared coordinate). */
export function buildWaveTables(
  restPositions: Float32Array,
  spaceOffsetX: number,
  seamCommonX: number,
  tipCommonX: number,
  tipGain: number,
): WaveTables {
  const vertexCount = restPositions.length / 3;
  const u = new Float32Array(vertexCount);
  const env = new Float32Array(vertexCount);
  const seamU = swimWaveU(seamCommonX, tipCommonX);
  for (let v = 0; v < vertexCount; v++) {
    const commonX = restPositions[v * 3]! + spaceOffsetX;
    const vertexU = swimWaveU(commonX, tipCommonX);
    u[v] = vertexU;
    env[v] = swimWaveEnvelope(vertexU, seamU, tipGain);
  }
  return { u, env };
}

/** Applies this frame's wave to a geometry's `position`/`normal`
 * attributes in place, from precomputed rest arrays and wave tables —
 * shared by the body, dorsal, and tail meshes (`FishModel.tsx`) so the
 * same per-vertex loop isn't tripled. Rotates the rest normal by the same
 * angle as the position rather than calling `computeVertexNormals()`
 * (correct for a per-vertex rigid rotation, and cheaper). */
export function applySwimWave(
  position: {
    setXYZ: (index: number, x: number, y: number, z: number) => void;
    needsUpdate: boolean;
  },
  normal: {
    setXYZ: (index: number, x: number, y: number, z: number) => void;
    needsUpdate: boolean;
  },
  restPositions: Float32Array,
  restNormals: Float32Array,
  tables: WaveTables,
  phase: number,
  amplitude: number,
): void {
  for (let v = 0; v < tables.u.length; v++) {
    const angle = swimWaveAngle(tables.env[v]!, tables.u[v]!, phase, amplitude);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const i = v * 3;
    const x = restPositions[i]!;
    const y = restPositions[i + 1]!;
    const z = restPositions[i + 2]!;
    position.setXYZ(v, x * cos - z * sin, y, x * sin + z * cos);
    const nx = restNormals[i]!;
    const ny = restNormals[i + 1]!;
    const nz = restNormals[i + 2]!;
    normal.setXYZ(v, nx * cos - nz * sin, ny, nx * sin + nz * cos);
  }
  position.needsUpdate = true;
  normal.needsUpdate = true;
}
