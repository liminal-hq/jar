// The unified per-vertex "swim wave" deformer — one continuous per-vertex
// bend spanning the body, dorsal fin, and all three tail types, so every
// deforming part shares the same travelling wave rather than each getting
// its own independent hinge or bend. See
// `docs/architecture/3d-engine.md` §6.2/§6.6.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';

/** How much extra amplitude the tail portion of the wave gets, ramping
 * smoothly from 1x at the body/tail seam to this value at the tail's own
 * tip — the body portion is always 1x regardless of fin type. Veil (the
 * flowing motion its shape calls for) highest; Fan/Forked moderate. Trimmed
 * a smidge from an earlier pass (Veil 4.2, Fan/Forked 2.4) that read as a
 * touch too whippy at the tail tip specifically, independent of the overall
 * body amplitude (`CALM_AMPLITUDE`/`EXCITED_AMPLITUDE`, `FishModel.tsx`),
 * which is unchanged. Tune by eye. */
export const FIN_SWIM_TIP_GAIN: Record<'Fan' | 'Forked' | 'Veil', number> = {
  Veil: 3.6,
  Fan: 2.0,
  Forked: 2.0,
};

/** Body-space x at/beyond which the wave is zero — protects the rigid head
 * (eye x=68, mouth hinge x=90, pectoral hinge x=52 all sit forward of
 * this). Tune by eye against the real silhouette. */
export const SWIM_WAVE_ONSET_X = 45;

/** Phase lag across the *entire* onset-to-tail-tip span. Too small and the
 * whole fish reads as flexing in lockstep rather than a wave travelling
 * from body to tail tip; too large and the tip visibly lags the beat
 * driving it. Tune by eye. */
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

/** Applies this frame's wave to a geometry's `position` attribute in place,
 * from a precomputed rest array and wave tables — shared by the body,
 * dorsal, and tail meshes (`FishModel.tsx`) so the same per-vertex loop
 * isn't tripled.
 *
 * `rotationOffsetX` matters for the tail specifically: its rest positions
 * are hinge-shifted (`extrudeAtHinge`, `fishGeometry.ts`) into a local
 * space whose origin is the hinge, not the shared body-space origin the
 * body/dorsal meshes already rotate about. A mesh's vertices have to
 * rotate about the *same* world-space pivot the body's do, or the same
 * physical seam point on each mesh ends up at different world positions
 * once amplitude is nonzero, visibly separating body from tail, even with
 * a shared, continuous `phase`/`amplitude`/envelope driving both.
 * Shifting into the shared space by `rotationOffsetX` before rotating,
 * then back out after, is what keeps that seam closed. `0` for body/dorsal
 * (already in that shared space); `TAIL_PIVOT.x` for the tail.
 *
 * Recomputes normals from the deformed positions rather than rotating the
 * rest normal by each vertex's own angle: the wave's angle varies
 * continuously with x, so this isn't a single rigid rotation, and
 * rotating by the local angle alone ignores that variation (most visible
 * as wrong-looking lighting toward high-`tipGain` tail tips, where the
 * angle changes fastest). */
export function applySwimWave(
  geometry: THREE.BufferGeometry,
  restPositions: Float32Array,
  tables: WaveTables,
  phase: number,
  amplitude: number,
  rotationOffsetX = 0,
): void {
  const position = geometry.attributes.position;
  if (!position) return;
  for (let v = 0; v < tables.u.length; v++) {
    const angle = swimWaveAngle(tables.env[v]!, tables.u[v]!, phase, amplitude);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const i = v * 3;
    const x = restPositions[i]! + rotationOffsetX;
    const y = restPositions[i + 1]!;
    const z = restPositions[i + 2]!;
    const rotatedX = x * cos - z * sin;
    const rotatedZ = x * sin + z * cos;
    position.setXYZ(v, rotatedX - rotationOffsetX, y, rotatedZ);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  // The bend can push vertices outside the bounding sphere three.js cached
  // from the rest pose — left stale, that sphere still gates both frustum
  // culling and `Raycaster`, so a swept tail could pop at a view boundary
  // or silently miss fish-selection clicks.
  geometry.computeBoundingSphere();
}
