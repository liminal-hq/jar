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
  /** Negative = barrel distortion. */
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
