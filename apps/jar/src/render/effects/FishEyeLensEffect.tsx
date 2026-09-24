// The Fish eye window's always-on lens-distortion pass — delivers on the
// window's own name with an actual barrel-distorted, vignetted, fringed
// "fisheye" look, built entirely from stock `postprocessing` effects (no
// hand-written GLSL). Mirrors `CrtEffect.tsx`'s composition shape, but reads
// its own strength directly (`domain/devSettings.ts`) rather than taking
// props, since it only ever has one mount site. See
// `docs/architecture/3d-engine.md` §10.3.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import {
  ChromaticAberration,
  EffectComposer,
  Vignette,
  wrapEffect,
} from '@react-three/postprocessing';
import { BlendFunction, LensDistortionEffect } from 'postprocessing';
import { Vector2 } from 'three';

import { useFishEyeLensStrength } from '../../domain/devSettings';
import { computeFishEyeLensParams } from './fishEyeLens';

const LensDistortion = wrapEffect(LensDistortionEffect);

// `LensDistortionEffect`'s own constructor defaults `principalPoint` to
// (0, 0) and `focalLength` to (1, 1) — `wrapEffect`'s generated prop type
// requires them explicitly even though the effect itself treats them as
// optional, so these just restate its defaults rather than tuning anything.
const LENS_PRINCIPAL_POINT = new Vector2(0, 0);
const LENS_FOCAL_LENGTH = new Vector2(1, 1);

export function FishEyeLensEffect() {
  const strength = useFishEyeLensStrength();
  const { distortion, vignetteDarkness, chromaticOffset } = computeFishEyeLensParams(strength);

  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <LensDistortion
        distortion={new Vector2(distortion, distortion)}
        principalPoint={LENS_PRINCIPAL_POINT}
        focalLength={LENS_FOCAL_LENGTH}
      />
      <Vignette eskil={false} darkness={vignetteDarkness} />
      {/* radialModulation true, unlike CrtEffect's false — fringing grows
       * toward the warped edges rather than applying flatly, so it reads as
       * a lens artifact rather than the CRT window's uniform colour fringe. */}
      <ChromaticAberration
        offset={new Vector2(chromaticOffset, chromaticOffset)}
        radialModulation
        modulationOffset={0.3}
        blendFunction={BlendFunction.NORMAL}
      />
    </EffectComposer>
  );
}
