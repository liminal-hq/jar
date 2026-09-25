// The GPU port of `swimWave.ts`'s per-vertex bend (issue #94: the CPU-side
// `applySwimWave` loop — run 3x per fish per frame, then flagging the whole
// `BufferGeometry` for a full GPU re-upload — was one of a handful of
// concrete, cheap wins identified as worth trying before reaching for a
// native renderer). Rather than a `RawShaderMaterial` rewrite (which would
// mean re-deriving `MeshStandardMaterial`'s entire PBR lighting model by
// hand), this hooks `onBeforeCompile` on the existing `MeshStandardMaterial`
// instances and injects the displacement directly into three's own
// `meshphysical` vertex shader — `FishModel.tsx` keeps its ordinary
// `<meshStandardMaterial>` look (belly-gradient vertex colours, fin colour,
// roughness, lighting) untouched, only the position/normal computation
// changes.
//
// The formula reproduced here is *exactly* `swimWave.ts`'s
// `swimWaveU`/`swimWaveEnvelope`/`swimWaveVertexAngle`/`applySwimWave` —
// see that file's doc comments for what each term means and why (onset,
// per-fin tip gain, phase lag, turn-bend). Nothing about the tuned
// animation *behaviour* changes; only where the per-vertex rotation is
// computed. Concretely, `onsetX`/`tipCommonX`/`seamU`/`tipGain`/`lag`/
// `spaceOffsetX` are per-fish-part constants (fixed at spawn — fin/sex
// never change afterward), baked directly into each material's shader
// source as GLSL `const float`s; `phase`/`amplitude`/`bend` are the only
// values that change frame to frame, so those alone are real uniforms,
// updated once per frame per material via `setSwimWaveUniforms` rather than
// touching geometry at all.
//
// One behavioural difference from the CPU version, accepted deliberately:
// since `geometry.attributes.position` is no longer rewritten, it stays at
// the fish's *rest* pose forever — R3F's pointer-event raycasting (used by
// `Fish.tsx`'s click-to-select) and frustum culling now see that rest pose,
// not the currently-bent one. For a small fish silhouette bending a modest
// amount, this is a minor, hard-to-notice hit-testing inaccuracy, not a
// functional loss — and it comes with a real simplification: no more
// per-frame `computeBoundingSphere()` (`applySwimWave`'s own doc comment
// explains why that used to be needed) or the CPU-side rest-position
// snapshots the old code cloned per fish.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';

import { SWIM_WAVE_LAG } from './swimWave';

/** The three per-frame values a swim-waving material needs from `FishModel`
 * — everything else the shader needs is a per-fish-part constant already
 * baked into its shader source (`attachSwimWaveVertexShader`). */
export interface SwimWaveFrameUniforms {
  uSwimPhase: { value: number };
  uSwimAmplitude: { value: number };
  uSwimBend: { value: number };
}

export interface SwimWaveShaderParams {
  /** Body-space x the wave is zero at/forward of (`SWIM_WAVE_ONSET_X`). */
  onsetX: number;
  /** This fish's own tail tip, in the shared body-space x (`FishModel.tsx`'s
   * `tailTipCommonX`, found empirically from the actual tail geometry). */
  tipCommonX: number;
  /** `swimWaveU(TAIL_PIVOT.x, tipCommonX)` — the body/tail seam's own `u`. */
  seamU: number;
  /** This fish's fin-type tip-amplitude multiplier (`FIN_SWIM_TIP_GAIN`). */
  tipGain: number;
  /** Phase lag across the onset-to-tip span (`SWIM_WAVE_LAG` by default). */
  lag?: number;
  /** `0` for body/dorsal, `TAIL_PIVOT.x` for the tail — see `applySwimWave`'s
   * own `rotationOffsetX` doc comment for why the tail needs this. */
  spaceOffsetX?: number;
}

/** GLSL requires a decimal point on a float literal — `45` alone parses as
 * an int in some contexts. JS's default `Number#toString()` already omits
 * one for whole numbers, so this only needs to patch that case up. */
function glslFloat(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`swim wave shader: non-finite constant (${n})`);
  }
  const s = n.toString();
  return /[.e]/i.test(s) ? s : `${s}.0`;
}

/** Inserts `injected` right after `marker` in `source` — throws instead of
 * silently no-op'ing if `marker` isn't found, since a plain `.replace()`
 * would otherwise leave a fish rendering at its rigid rest pose with no
 * error if a future three.js version renames/reorders one of the
 * `meshphysical` shader chunk includes this hooks into. */
function injectAfter(source: string, marker: string, injected: string): string {
  if (!source.includes(marker)) {
    throw new Error(
      `swim wave shader: expected shader chunk "${marker}" not found — three.js version mismatch?`,
    );
  }
  return source.replace(marker, `${marker}\n${injected}`);
}

/** The baked-constant `const float`s plus the three real per-frame uniforms
 * — identical between a fish part's visible material and its
 * `customDepthMaterial` (`attachSwimWaveVertexShader`/
 * `attachSwimWaveDepthMaterial`), since both need to reproduce the exact
 * same displacement. */
function buildSwimConstantsGLSL(params: SwimWaveShaderParams): string {
  const { onsetX, tipCommonX, seamU, tipGain, lag = SWIM_WAVE_LAG, spaceOffsetX = 0 } = params;
  return `
const float SWIM_ONSET_X = ${glslFloat(onsetX)};
const float SWIM_TIP_X = ${glslFloat(tipCommonX)};
const float SWIM_SEAM_U = ${glslFloat(seamU)};
const float SWIM_TIP_GAIN = ${glslFloat(tipGain)};
const float SWIM_LAG = ${glslFloat(lag)};
const float SWIM_SPACE_OFFSET_X = ${glslFloat(spaceOffsetX)};
uniform float uSwimPhase;
uniform float uSwimAmplitude;
uniform float uSwimBend;
`;
}

/** `swimWaveU`/`swimWaveEnvelope`/`swimWaveVertexAngle` (swimWave.ts)'s
 * position half, evaluated per vertex on the GPU instead of precomputed per
 * vertex on the CPU (`buildWaveTables`) — computes this vertex's wave angle
 * and rotates (x,z) about the shared pivot into `swimXp`/`swimZp`. Shared
 * verbatim between the visible material's vertex shader
 * (`attachSwimWaveVertexShader`, which additionally derives each term's own
 * x-derivative from these same intermediates to correct the normal) and the
 * depth material's (`attachSwimWaveDepthMaterial`, position-only — a shadow
 * depth pass never samples normals), so a fish's shadow can never drift from
 * what it actually looks like: both read this identical formula. */
const SWIM_POSITION_GLSL = `
	float swimSpan = SWIM_ONSET_X - SWIM_TIP_X;
	float swimCommonX = position.x + SWIM_SPACE_OFFSET_X;
	float swimURaw = (SWIM_ONSET_X - swimCommonX) / swimSpan;
	float swimU = clamp(swimURaw, 0.0, 1.0);
	float swimTailSpan = 1.0 - SWIM_SEAM_U;
	float swimTailURaw = SWIM_SEAM_U < 1.0 ? (swimU - SWIM_SEAM_U) / swimTailSpan : 0.0;
	float swimTailU = SWIM_SEAM_U < 1.0 ? clamp(swimTailURaw, 0.0, 1.0) : 0.0;
	float swimTipBoost = 1.0 + (SWIM_TIP_GAIN - 1.0) * swimTailU;
	float swimEnv = swimU * swimTipBoost;
	float swimOscPhase = uSwimPhase - SWIM_LAG * swimU;
	float swimOsc = sin(swimOscPhase);
	float swimAngle = uSwimAmplitude * swimEnv * swimOsc + uSwimBend * swimU;
	float swimCosA = cos(swimAngle);
	float swimSinA = sin(swimAngle);
	// Same rotation applySwimWave performs on the CPU: rotate
	// (swimCommonX, position.z) by swimAngle about the shared pivot.
	float swimXp = swimCommonX * swimCosA - position.z * swimSinA;
	float swimZp = swimCommonX * swimSinA + position.z * swimCosA;
`;

/** Writes the displaced `x`/`z` `SWIM_POSITION_GLSL` computed into
 * `transformed` — injected after `#include <begin_vertex>` (which sets
 * `transformed` from the rest `position` attribute) in both the visible
 * and depth materials' vertex shaders; both land in the same `main()` as
 * `SWIM_POSITION_GLSL`, so its plain (unbraced) local variables are still
 * in scope here. */
const POSITION_INJECTION = `
	transformed.x = swimXp - SWIM_SPACE_OFFSET_X;
	transformed.z = swimZp;
`;

/**
 * Attaches the swim-wave vertex displacement to a `MeshStandardMaterial`
 * via `onBeforeCompile`, and returns the frame uniforms to drive it with
 * (`setSwimWaveUniforms`, called once per frame per material).
 *
 * Injects at three points in three's own `meshphysical` vertex shader:
 * - after `#include <common>`: the baked-constant `const float`s plus the
 *   three real uniforms.
 * - after `#include <beginnormal_vertex>` (which sets `objectNormal` from
 *   the rest-pose `normal` attribute, before it's consumed by
 *   `defaultnormal_vertex`): computes this vertex's wave angle *and* its
 *   local derivative `dAngle/dx`, then corrects `objectNormal` for the
 *   deformation via the inverse-transpose of the local (x,z) Jacobian —
 *   the analytically-correct generalization of `applySwimWave`'s own
 *   "rotate the normal by the vertex's own angle" idea that its doc comment
 *   flags as wrong (`swimWave.ts`: "most visible as wrong-looking lighting
 *   toward high-tipGain tail tips"). `y` is left untouched: the wave only
 *   ever rotates about local Y, so the Jacobian is block-diagonal and the
 *   inverse-transpose of its `y` block is trivially the identity.
 * - after `#include <begin_vertex>` (which sets `transformed` from the rest
 *   `position` attribute): writes the displaced `x`/`z` computed above into
 *   `transformed`, reusing the normal block's work rather than recomputing
 *   it — both injections land in the same `main()`, so plain (unbraced)
 *   local variables declared in the first are still in scope in the second.
 */
export function attachSwimWaveVertexShader(
  material: THREE.Material,
  params: SwimWaveShaderParams,
): SwimWaveFrameUniforms {
  const { onsetX, tipCommonX, seamU, tipGain, lag = SWIM_WAVE_LAG, spaceOffsetX = 0 } = params;

  const uniforms: SwimWaveFrameUniforms = {
    uSwimPhase: { value: 0 },
    uSwimAmplitude: { value: 0 },
    uSwimBend: { value: 0 },
  };

  const constants = buildSwimConstantsGLSL(params);

  // `swimWaveU`/`swimWaveEnvelope`/`swimWaveVertexAngle` (swimWave.ts),
  // evaluated per vertex on the GPU instead of precomputed per vertex on
  // the CPU (`buildWaveTables`) — plus each term's own x-derivative, needed
  // to correct the normal below. `swimXp`/`swimZp` (the rotated x/z, still
  // in the shared pivot-shifted space) are computed by `SWIM_POSITION_GLSL`
  // and consumed again, unmodified, by `positionInjection`.
  const normalInjection = `
	// --- swim wave (swimWave.ts port): displacement + Jacobian-corrected normal ---
${SWIM_POSITION_GLSL}
	// Re-derives each position term's own x-derivative — needed only for the
	// normal correction below, so kept out of the shared position block above
	// (SWIM_POSITION_GLSL, also used by the depth material's position-only
	// injection, which never touches normals — see attachSwimWaveDepthMaterial
	// in this file). Declaration order doesn't need to mirror the position
	// block above line for line: GLSL only requires each variable be declared
	// before use, and every input these derivatives read (swimURaw, swimSpan,
	// swimTailURaw, swimTailSpan, swimTipBoost, swimU, swimOsc, swimOscPhase)
	// already is.
	float swimDuDx = (swimURaw > 0.0 && swimURaw < 1.0) ? (-1.0 / swimSpan) : 0.0;
	float swimDTailUDx = (SWIM_SEAM_U < 1.0 && swimTailURaw > 0.0 && swimTailURaw < 1.0)
		? (swimDuDx / swimTailSpan)
		: 0.0;
	float swimDTipBoostDx = (SWIM_TIP_GAIN - 1.0) * swimDTailUDx;
	float swimDEnvDx = swimDuDx * swimTipBoost + swimU * swimDTipBoostDx;
	float swimDAngleDx = uSwimAmplitude
			* (swimDEnvDx * swimOsc + swimEnv * cos(swimOscPhase) * (-SWIM_LAG * swimDuDx))
		+ uSwimBend * swimDuDx;
	// d(x',z')/d(x,z) for this per-vertex-angle rotation — y is decoupled
	// (the wave only ever rotates about local Y), so only this 2x2 block
	// needs correcting; transforming the normal by its inverse-transpose is
	// what keeps lighting correct where the angle changes fastest (high
	// tipGain tail tips), instead of the CPU's per-frame
	// computeVertexNormals() (a discrete, face-averaged approximation to
	// this same continuous quantity).
	mat2 swimJacobian = mat2(
		swimCosA - swimDAngleDx * swimZp, swimSinA + swimDAngleDx * swimXp,
		-swimSinA, swimCosA
	);
	vec2 swimNormalXZ = transpose(inverse(swimJacobian)) * vec2(objectNormal.x, objectNormal.z);
	objectNormal = normalize(vec3(swimNormalXZ.x, objectNormal.y, swimNormalXZ.y));
`;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = injectAfter(
      injectAfter(
        injectAfter(shader.vertexShader, '#include <common>', constants),
        '#include <beginnormal_vertex>',
        normalInjection,
      ),
      '#include <begin_vertex>',
      POSITION_INJECTION,
    );
  };
  // Different fish-parts bake different literal constants into otherwise
  // textually-identical `onBeforeCompile` closures — three's own default
  // `customProgramCacheKey()` just stringifies the *closure's source code*
  // (`Material.js`'s own default: `this.onBeforeCompile.toString()`), which
  // is the same for every one of these closures regardless of which
  // constants it captured. Left alone, two materials three considers
  // "the same program" (e.g. two fish sharing a fin type/sex) could
  // silently reuse one compiled program — and one of the two fish's baked
  // constants — for both. Folding the actual constants into the cache key
  // is what makes each distinct combination compile its own program.
  material.customProgramCacheKey = () =>
    `swimWave:${onsetX}:${tipCommonX}:${seamU}:${tipGain}:${lag}:${spaceOffsetX}`;

  return uniforms;
}

/** Builds a `THREE.MeshDepthMaterial` that applies the *same* swim-wave
 * position displacement as `attachSwimWaveVertexShader`'s material, for use
 * as that mesh's `customDepthMaterial` (`FishModel.tsx`).
 *
 * Without this, a swimming fish's shadow is wrong, not just missing:
 * three.js's shadow-map pass substitutes a shared, generic
 * `MeshDepthMaterial` for every shadow-casting object unless
 * `object.customDepthMaterial` is set (`WebGLShadowMap.js`'s own
 * `getDepthMaterial`), and that generic material only forwards a handful of
 * texture/clipping properties — never `onBeforeCompile`. Left unset, a
 * swim-waving body/dorsal/tail mesh's shadow would render its raw rest-pose
 * geometry every frame: the visible mesh bends through its full swim-wave
 * arc while its shadow stays a static, undeformed silhouette, permanently
 * detached from the shape actually casting it.
 *
 * Takes the *same* `SwimWaveFrameUniforms` object `attachSwimWaveVertexShader`
 * returned for this fish part, rather than creating its own — `FishModel.tsx`
 * then only needs one `setSwimWaveUniforms` call per part per frame to keep
 * both the visible material and this depth material in sync automatically:
 * `Object.assign` below copies the *references* to each `{ value }` box, not
 * their values, so a later `.value` write through the shared `uniforms`
 * object is visible to both materials' own `shader.uniforms` alike.
 *
 * Only the position injection is needed — a shadow depth pass never samples
 * normals, and (unlike `meshphysical`'s vertex shader) `meshdepth`'s own
 * `#include <beginnormal_vertex>` isn't even compiled in without a
 * displacement map, so there'd be no `objectNormal` here to correct in the
 * first place. */
export function attachSwimWaveDepthMaterial(
  params: SwimWaveShaderParams,
  uniforms: SwimWaveFrameUniforms,
): THREE.MeshDepthMaterial {
  const { onsetX, tipCommonX, seamU, tipGain, lag = SWIM_WAVE_LAG, spaceOffsetX = 0 } = params;
  const constants = buildSwimConstantsGLSL(params);

  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    // `#include <common>` sits *outside* `void main()` in three's own
    // `depth.glsl.js` (identically to `meshphysical.glsl.js` — declarations
    // only there, same as `attachSwimWaveVertexShader`'s `constants`
    // injection), so `SWIM_POSITION_GLSL`'s executable statements can't go
    // there too: unlike the visible material (which has a real
    // `#include <beginnormal_vertex>` inside `main()` to inject them after),
    // `meshdepth`'s vertex shader only compiles that chunk in under
    // `USE_DISPLACEMENTMAP`, so both position injections land together,
    // in order, right after `#include <begin_vertex>` instead — the one
    // chunk inside `main()` guaranteed present here.
    shader.vertexShader = injectAfter(
      injectAfter(shader.vertexShader, '#include <common>', constants),
      '#include <begin_vertex>',
      `${SWIM_POSITION_GLSL}\n${POSITION_INJECTION}`,
    );
  };
  // Same reasoning as `attachSwimWaveVertexShader`'s own `customProgramCacheKey`
  // — a distinct prefix (`swimWaveDepth` vs `swimWave`) so a depth material and
  // its corresponding visible material, which bake the same constants, are
  // never mistaken for the same program (they're compiled from different
  // `onBeforeCompile` closures against a different base shader entirely).
  depthMaterial.customProgramCacheKey = () =>
    `swimWaveDepth:${onsetX}:${tipCommonX}:${seamU}:${tipGain}:${lag}:${spaceOffsetX}`;

  return depthMaterial;
}

/** Writes this frame's shared phase/amplitude/bend into one swim-waving
 * material's uniforms — `FishModel.tsx` calls this once per body/dorsal/tail
 * material per frame (replacing the old three `applySwimWave` calls). */
export function setSwimWaveUniforms(
  uniforms: SwimWaveFrameUniforms,
  phase: number,
  amplitude: number,
  bend: number,
): void {
  uniforms.uSwimPhase.value = phase;
  uniforms.uSwimAmplitude.value = amplitude;
  uniforms.uSwimBend.value = bend;
}
