// Tests for computeFishEyeLensParams's clamping and interpolation.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import {
  computeFishEyeLensParams,
  FISH_EYE_BASE_FOV,
  FISH_EYE_MAX_CHROMATIC_OFFSET,
  FISH_EYE_MAX_DISTORTION,
  FISH_EYE_MAX_FOV,
  FISH_EYE_MAX_VIGNETTE_DARKNESS,
} from './fishEyeLens';

describe('computeFishEyeLensParams', () => {
  it('at strength 0, returns the base FOV and no distortion/vignette/fringing', () => {
    const params = computeFishEyeLensParams(0);
    expect(params.fov).toBe(FISH_EYE_BASE_FOV);
    expect(params.distortion).toBe(0);
    expect(params.vignetteDarkness).toBe(0);
    expect(params.chromaticOffset).toBe(0);
  });

  it('at strength 1, returns the max FOV, distortion, vignette, and fringing', () => {
    const params = computeFishEyeLensParams(1);
    expect(params.fov).toBe(FISH_EYE_MAX_FOV);
    expect(params.distortion).toBe(-FISH_EYE_MAX_DISTORTION);
    expect(params.vignetteDarkness).toBe(FISH_EYE_MAX_VIGNETTE_DARKNESS);
    expect(params.chromaticOffset).toBe(FISH_EYE_MAX_CHROMATIC_OFFSET);
  });

  it('clamps strengths outside [0, 1]', () => {
    expect(computeFishEyeLensParams(-1)).toEqual(computeFishEyeLensParams(0));
    expect(computeFishEyeLensParams(2)).toEqual(computeFishEyeLensParams(1));
  });

  it('interpolates monotonically between the base and max values', () => {
    const low = computeFishEyeLensParams(0.25);
    const mid = computeFishEyeLensParams(0.5);
    const high = computeFishEyeLensParams(0.75);
    expect(low.fov).toBeLessThan(mid.fov);
    expect(mid.fov).toBeLessThan(high.fov);
    expect(low.distortion).toBeGreaterThan(mid.distortion);
    expect(mid.distortion).toBeGreaterThan(high.distortion);
    expect(low.vignetteDarkness).toBeLessThan(mid.vignetteDarkness);
    expect(mid.vignetteDarkness).toBeLessThan(high.vignetteDarkness);
    expect(low.chromaticOffset).toBeLessThan(mid.chromaticOffset);
    expect(mid.chromaticOffset).toBeLessThan(high.chromaticOffset);
  });
});
