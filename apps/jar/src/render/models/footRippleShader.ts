// The snail foot's crawl ripple, GPU-displaced exactly the way the fish's
// swim wave is (`swimWaveShader.ts`, issue #94) — an `onBeforeCompile` hook
// on `MeshStandardMaterial` plus a matching `customDepthMaterial` twin,
// rather than a per-frame CPU vertex rewrite. `SnailModel.tsx` keeps its
// ordinary `<meshStandardMaterial>` look (the sole's vertex-colour gradient,
// roughness) untouched; only the position/normal computation changes.
//
// The formula is deliberately simpler than the swim wave's, and different
// in kind: a one-sided travelling bump (never a symmetric wave) that lifts
// the foot's surface upward from its rest pose, gated to zero exactly at the
// sole/contact line by a vertical envelope. Both properties together are
// what satisfy issue #98's hard constraint — "displacement must never go
// below the sole line, the one thing `crawlSurfaces.ts` gets to trust" —
// unconditionally, not just for a well-tuned amplitude: every displaced
// vertex only ever moves away from the sole, and a vertex sitting exactly on
// the sole never moves at all.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';

/** The two per-frame values a ripple-waving material needs — everything
 * else is a baked-in constant (`attachFootRippleVertexShader`). */
export interface FootRippleFrameUniforms {
  uRipplePhase: { value: number };
  uRippleAmplitude: { value: number };
}

export interface FootRippleShaderParams {
  /** The sole/contact line, in this mesh's local space (`snailGeometry.ts`'s
   * `SOLE_Y`) — the envelope is exactly zero here, pinning sole vertices in
   * place regardless of amplitude. */
  soleY: number;
  /** Height above `soleY` at which the envelope reaches its full value of 1
   * — `snailGeometry.ts`'s `FOOT_SOLE_GRADIENT_HEIGHT` by default, tying the
   * ripple's reach to the same visually-lighter sole band. */
  envelopeHeight: number;
  /** Local-x distance per ripple cycle — a policy constant, tune by eye. */
  wavelength: number;
}

/** GLSL requires a decimal point on a float literal — see
 * `swimWaveShader.ts`'s identical helper for why. Duplicated rather than
 * imported: the two shader modules are deliberately independent (a
 * fish-swim concept has no business being a dependency of a snail-foot
 * one), and the helper is a few lines. */
function glslFloat(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`foot ripple shader: non-finite constant (${n})`);
  }
  const s = n.toString();
  return /[.e]/i.test(s) ? s : `${s}.0`;
}

/** Inserts `injected` right after `marker` in `source` — throws instead of
 * silently no-op'ing, for the same reason `swimWaveShader.ts`'s identical
 * helper does: a fixed-up three.js chunk name should never leave a snail's
 * foot rendering at its rigid rest pose with no error. */
function injectAfter(source: string, marker: string, injected: string): string {
  if (!source.includes(marker)) {
    throw new Error(
      `foot ripple shader: expected shader chunk "${marker}" not found — three.js version mismatch?`,
    );
  }
  return source.replace(marker, `${marker}\n${injected}`);
}

function buildRippleConstantsGLSL(params: FootRippleShaderParams): string {
  const { soleY, envelopeHeight, wavelength } = params;
  const k = (2 * Math.PI) / wavelength;
  return `
const float RIPPLE_SOLE_Y = ${glslFloat(soleY)};
const float RIPPLE_ENVELOPE_HEIGHT = ${glslFloat(envelopeHeight)};
const float RIPPLE_K = ${glslFloat(k)};
uniform float uRipplePhase;
uniform float uRippleAmplitude;
`;
}

/** The shared displacement math: a height-field `y' = y + D(x,y)` where
 * `D = amplitude * env(y) * max(0, sin(k*x - phase))`.
 *
 * `rippleEnv` is a smoothstep-shaped ramp (matching `THREE.MathUtils
 * .smoothstep`'s own cubic ease, `3t²-2t³`) from 0 at the sole to 1 by
 * `envelopeHeight` above it — `rippleT`'s clamp to [0,1] is what pins it to
 * exactly 0 at and below the sole. `rippleWave`'s `max(0, sin(...))` makes
 * the bump one-sided: `rippleDisp` is never negative, so combined with the
 * envelope's zero at the sole, no vertex can ever end up *below* its own
 * rest position, let alone below the sole line itself — the one guarantee
 * issue #98 asks for. Shared verbatim between the visible material's vertex
 * shader (`attachFootRippleVertexShader`, which additionally derives the
 * position's local derivatives to correct the normal) and the depth
 * material's (`attachFootRippleDepthMaterial`, position-only), so a
 * crawling snail's shadow can never drift from what it actually looks
 * like. */
const RIPPLE_POSITION_GLSL = `
	float rippleT = clamp((position.y - RIPPLE_SOLE_Y) / RIPPLE_ENVELOPE_HEIGHT, 0.0, 1.0);
	float rippleEnv = rippleT * rippleT * (3.0 - 2.0 * rippleT);
	float ripplePhaseAtX = position.x * RIPPLE_K - uRipplePhase;
	float rippleSin = sin(ripplePhaseAtX);
	float rippleWave = max(0.0, rippleSin);
	float rippleDisp = uRippleAmplitude * rippleEnv * rippleWave;
`;

const POSITION_INJECTION = `
	transformed.y += rippleDisp;
`;

/**
 * Attaches the foot-ripple vertex displacement to a `MeshStandardMaterial`
 * via `onBeforeCompile`, and returns the frame uniforms to drive it with
 * (`setFootRippleUniforms`, called once per frame).
 *
 * Injects at three points in three's own `meshphysical` vertex shader, the
 * same three `swimWaveShader.ts` uses:
 * - after `#include <common>`: the baked-constant `const float`s plus the
 *   two real uniforms.
 * - after `#include <beginnormal_vertex>`: corrects `objectNormal` for the
 *   height-field deformation. Treating the displacement as
 *   `P'(x,y,z) = (x, y + D(x,y), z)`, its Jacobian is block lower-triangular
 *   (`∂x'/∂x=1`, `∂y'/∂x=Dx`, `∂y'/∂y=1+Dy`, `∂z'/∂z=1`, all cross terms with
 *   z zero since D never depends on z), so the inverse-transpose a normal
 *   needs to transform by works out to the closed form used below:
 *   `n' = (nx − Dx·ny/(1+Dy), ny/(1+Dy), nz)`, then normalized. `z` is
 *   untouched, same reasoning `swimWaveShader.ts` gives for its own
 *   decoupled axis.
 * - after `#include <begin_vertex>`: adds `rippleDisp` (computed in the
 *   normal-correction block above) onto `transformed.y`.
 */
export function attachFootRippleVertexShader(
  material: THREE.Material,
  params: FootRippleShaderParams,
): FootRippleFrameUniforms {
  const uniforms: FootRippleFrameUniforms = {
    uRipplePhase: { value: 0 },
    uRippleAmplitude: { value: 0 },
  };

  const constants = buildRippleConstantsGLSL(params);

  const normalInjection = `
	// --- foot ripple (footRippleShader.ts): displacement + Jacobian-corrected normal ---
${RIPPLE_POSITION_GLSL}
	float rippleDDt_dy = (rippleT > 0.0 && rippleT < 1.0) ? (1.0 / RIPPLE_ENVELOPE_HEIGHT) : 0.0;
	float rippleDEnv_dy = (6.0 * rippleT - 6.0 * rippleT * rippleT) * rippleDDt_dy;
	float rippleDWave_dx = (rippleSin > 0.0) ? cos(ripplePhaseAtX) * RIPPLE_K : 0.0;
	float rippleDx = uRippleAmplitude * rippleEnv * rippleDWave_dx;
	float rippleDy = uRippleAmplitude * rippleWave * rippleDEnv_dy;
	float rippleInvOnePlusDy = 1.0 / (1.0 + rippleDy);
	objectNormal = normalize(vec3(
		objectNormal.x - rippleDx * objectNormal.y * rippleInvOnePlusDy,
		objectNormal.y * rippleInvOnePlusDy,
		objectNormal.z
	));
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
  // Same reasoning as `swimWaveShader.ts`'s identical override: three's
  // default `customProgramCacheKey()` stringifies the closure's *source*,
  // which is identical across every foot regardless of baked constants —
  // folding the actual constants in is what makes each distinct
  // `soleY`/`envelopeHeight`/`wavelength` combination compile its own
  // program instead of silently sharing (and misusing) another's.
  material.customProgramCacheKey = () =>
    `footRipple:${params.soleY}:${params.envelopeHeight}:${params.wavelength}`;

  return uniforms;
}

/** Builds a `THREE.MeshDepthMaterial` that applies the *same* ripple
 * position displacement as `attachFootRippleVertexShader`'s material, for
 * use as that mesh's `customDepthMaterial` — the exact bug class the fish
 * shadow fix (#100) closed, applied here before it can recur: without this,
 * a crawling snail's shadow renders its raw rest-pose foot every frame,
 * permanently detached from the rippling shape actually casting it. See
 * `swimWaveShader.ts`'s `attachSwimWaveDepthMaterial` for the full
 * `WebGLShadowMap`-substitution rationale (identical here).
 *
 * Takes the *same* `FootRippleFrameUniforms` object
 * `attachFootRippleVertexShader` returned, so `SnailModel.tsx` only needs
 * one `setFootRippleUniforms` call per frame to keep both materials in
 * sync — see that function's own doc comment for why `Object.assign`
 * sharing the `{ value }` boxes (not their values) makes that work.
 *
 * Only the position injection is needed — a shadow depth pass never samples
 * normals, and `meshdepth`'s own `#include <beginnormal_vertex>` isn't even
 * compiled in without a displacement map. */
export function attachFootRippleDepthMaterial(
  params: FootRippleShaderParams,
  uniforms: FootRippleFrameUniforms,
): THREE.MeshDepthMaterial {
  const constants = buildRippleConstantsGLSL(params);

  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    // Same reasoning as `swimWaveShader.ts`'s depth material: `meshdepth`'s
    // vertex shader only compiles `#include <beginnormal_vertex>` in under
    // `USE_DISPLACEMENTMAP`, so both position injections land together,
    // in order, right after `#include <begin_vertex>` instead — the one
    // chunk inside `main()` guaranteed present here.
    shader.vertexShader = injectAfter(
      injectAfter(shader.vertexShader, '#include <common>', constants),
      '#include <begin_vertex>',
      `${RIPPLE_POSITION_GLSL}\n${POSITION_INJECTION}`,
    );
  };
  depthMaterial.customProgramCacheKey = () =>
    `footRippleDepth:${params.soleY}:${params.envelopeHeight}:${params.wavelength}`;

  return depthMaterial;
}

/** Writes this frame's phase/amplitude into one ripple-waving material's
 * uniforms — `SnailModel.tsx` calls this once per frame. */
export function setFootRippleUniforms(
  uniforms: FootRippleFrameUniforms,
  phase: number,
  amplitude: number,
): void {
  uniforms.uRipplePhase.value = phase;
  uniforms.uRippleAmplitude.value = amplitude;
}
