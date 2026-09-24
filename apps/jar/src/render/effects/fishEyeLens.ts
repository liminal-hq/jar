// Pure tuning math for the Fish eye window's lens effect
// (`FishEyeLensEffect.tsx`) — a single 0-1 "strength" knob drives every
// correlated parameter (FOV, barrel distortion, vignette, chromatic
// fringing) together, rather than exposing four independent sliders. See
// `docs/architecture/3d-engine.md` §10.3.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';

export const FISH_EYE_BASE_FOV = 62;
export const FISH_EYE_MAX_FOV = 108;
export const FISH_EYE_MAX_DISTORTION = 0.55;
export const FISH_EYE_MAX_VIGNETTE_DARKNESS = 0.9;
export const FISH_EYE_MAX_CHROMATIC_OFFSET = 0.004;

export interface FishEyeLensParams {
  fov: number;
  /** Negative = barrel distortion, fed straight into
   * `LensDistortionEffect`'s `mainUv` hook, which computes the *source*
   * sample UV for a given *output* pixel as `(1 + distortion * r²) * xn`
   * (r = radial distance from centre). A negative coefficient makes that
   * mapping compressive — an output pixel near the edge samples source
   * content from *closer to the centre* than its own position — which
   * stretches the centre of the frame to fill the screen and crops the
   * source image's own edges. That "zoom the centre, lose the edges" effect
   * is exactly why `FISH_EYE_MAX_FOV` widens the camera: the extra FOV
   * supplies the source content this distortion crops away, which wouldn't
   * make sense to add if the sign here produced pincushion distortion
   * (stretched edges) instead. Derived from the shader math, not visually
   * confirmed live — this environment's WebGL canvas doesn't render actual
   * pixels (see the PR description), so treat this as informed, not proven,
   * until checked on a real display. */
  distortion: number;
  vignetteDarkness: number;
  chromaticOffset: number;
}

export function computeFishEyeLensParams(strength: number): FishEyeLensParams {
  const s = THREE.MathUtils.clamp(strength, 0, 1);
  return {
    fov: THREE.MathUtils.lerp(FISH_EYE_BASE_FOV, FISH_EYE_MAX_FOV, s),
    distortion: THREE.MathUtils.lerp(0, -FISH_EYE_MAX_DISTORTION, s),
    vignetteDarkness: THREE.MathUtils.lerp(0, FISH_EYE_MAX_VIGNETTE_DARKNESS, s),
    chromaticOffset: THREE.MathUtils.lerp(0, FISH_EYE_MAX_CHROMATIC_OFFSET, s),
  };
}
