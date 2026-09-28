// The snail foot's whole-body deformation — the sleep/startle tuck's
// withdrawal and the gait's squash-and-stretch — as a pair of scalar factors
// plus the per-vertex map they drive, in the foot's own bind-pose space.
//
// This is the CPU source of truth `footRippleShader.ts` ports into GLSL, the
// same split `swimWave.ts`/`swimWaveShader.ts` already use for the fish's own
// deformation.
//
// It has to be a *vertex* deformation, inside the shader and ahead of
// `#include <skinning_vertex>`. It cannot be a transform on any ancestor of
// the foot mesh, however convenient that looks: a `THREE.SkinnedMesh` left in
// three's default `AttachedBindMode` recomputes `bindMatrixInverse` as
// `inverse(mesh.matrixWorld)` inside every `updateMatrixWorld()`, and the
// skinning chunk applies exactly that inverse to the skinned vertex before
// `project_vertex` multiplies the same `matrixWorld` back in. The two cancel
// identically, every frame, so a scale on any node between the foot mesh and
// the scene root has no effect on a single rendered pixel — not a subtle
// effect, none. `footDeformation.test.ts` asserts that cancellation directly,
// so the trap stays recorded rather than being rediscovered.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';

/** How much of the foot's girth the sleep/startle tuck takes away at full
 * withdrawal — the foot doesn't vanish, it flattens and narrows into the sole
 * beneath the shell, which is what actually hides it as the shell settles
 * over the same window (`snailGeometry.ts`'s `tuckPose`). Girth only, never
 * length: the toe is where the eyestalks are mounted (`headMountTransform`)
 * and where the crawl spine's own head is, so shortening the body on
 * withdrawal would slide the foot out from under both. */
export const FOOT_WITHDRAW_GIRTH = 0.85;

/** Keeps both factors strictly positive. The shader divides a normal by each
 * one (a diagonal scale's inverse-transpose is the reciprocal scale), and a
 * zero factor is a singular map with no normal to speak of — far below the
 * smallest factor the tuck and gait windows can actually produce, so this
 * only ever guards a future retune of `FOOT_WITHDRAW_GIRTH` or the gait's own
 * stretch clamp. */
const MIN_FACTOR = 1e-3;

/** The two axes of the foot's deformation, each a plain multiplier. Girth and
 * length move in opposite directions under squash-and-stretch (volume read
 * as constant), and only girth responds to withdrawal. */
export interface FootDeformation {
  /** Multiplies a vertex's height above the sole line and its distance from
   * the body's own centre plane. Anchored at the sole precisely so a sole
   * vertex never moves: the sole line is the crawl-surface contact line
   * `crawlSurfaces.ts` gets to trust, and a girth change that lifted it
   * would float a withdrawing snail off its own surface. */
  girth: number;
  /** Multiplies a vertex's distance *behind the toe* along the body's
   * authored axis. Anchored at the toe rather than at the body's centre or
   * the shell's seat for two reasons: the toe is the spine's own head, so the
   * body only ever elongates back over ground it has already crawled (never
   * extrapolated forward past what the spine has recorded), and it's where
   * the eyestalks mount, so they stay attached to the head with no matching
   * correction of their own. A crawler leading with its head and drawing its
   * tail up behind it is also simply what a gastropod does. */
  length: number;
}

function clampFactor(factor: number): number {
  return Math.max(factor, MIN_FACTOR);
}

/** The foot's current deformation, from the tuck timeline's own
 * `footWithdraw` (0 emerged, 1 fully withdrawn — `snailGeometry.ts`'s
 * `TuckPose`) and the gait's signed `stretch` fraction (`SnailGait`, 0
 * neutral, positive stretched along the direction of travel).
 *
 * Girth takes the *full* inverse of the stretch factor rather than the
 * physically-correct square root — an exaggerated plump, matching this
 * project's stated preference for visual exaggeration over physical accuracy,
 * and the same choice the original (inert) implementation made. */
export function footDeformation(footWithdraw: number, stretch: number): FootDeformation {
  const withdrawn = 1 - THREE.MathUtils.clamp(footWithdraw, 0, 1) * FOOT_WITHDRAW_GIRTH;
  const length = clampFactor(1 + stretch);
  return { girth: clampFactor(withdrawn / length), length };
}

/** Applies a deformation to one vertex in place, in the foot's bind-pose
 * space — the reference implementation `footRippleShader.ts`'s
 * `DEFORM_POSITION_GLSL` mirrors statement for statement. `soleY` is
 * `snailGeometry.ts`'s `SOLE_Y` and `anchorX` its `FOOT_TOE_X`; both are
 * passed rather than imported so this stays a plain geometric map with no
 * snail-specific constants baked in (the same reason the shader bakes them as
 * compile-time constants from its own params). */
export function deformFootVertex(
  vertex: THREE.Vector3,
  deformation: FootDeformation,
  soleY: number,
  anchorX: number,
): THREE.Vector3 {
  vertex.x = anchorX + (vertex.x - anchorX) * deformation.length;
  vertex.y = soleY + (vertex.y - soleY) * deformation.girth;
  vertex.z *= deformation.girth;
  return vertex;
}
