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
import {
  BlendFunction,
  ChromaticAberrationEffect,
  LensDistortionEffect,
  VignetteEffect,
} from 'postprocessing';
import { useLayoutEffect, useMemo, useRef, type Ref } from 'react';
import { Vector2 } from 'three';

import { useFishEyeLensStrength } from '../../domain/devSettings';
import { computeFishEyeLensParams, type FishEyeLensParams } from './fishEyeLens';

const LensDistortion = wrapEffect(LensDistortionEffect);

/** The one place that combines the live Dev Settings strength with
 * `computeFishEyeLensParams` — used here and by `FishEyeScene.tsx`'s
 * `CameraRig`, so the two-step "read strength, then derive params" pattern
 * exists exactly once rather than being repeated at each call site. */
export function useFishEyeLensParams(): FishEyeLensParams {
  const strength = useFishEyeLensStrength();
  return computeFishEyeLensParams(strength);
}

// `LensDistortionEffect`'s own constructor defaults `principalPoint` to
// (0, 0) and `focalLength` to (1, 1) — `wrapEffect`'s generated prop type
// requires them explicitly even though the effect itself treats them as
// optional, so these just restate its defaults rather than tuning anything.
const LENS_PRINCIPAL_POINT = new Vector2(0, 0);
const LENS_FOCAL_LENGTH = new Vector2(1, 1);

export function FishEyeLensEffect() {
  const { distortion, vignetteDarkness, chromaticOffset } = useFishEyeLensParams();

  const lensRef = useRef<LensDistortionEffect>(null);
  const vignetteRef = useRef<VignetteEffect>(null);
  const chromaticRef = useRef<ChromaticAberrationEffect>(null);
  // `wrapEffect`'s own type (`util.d.ts`) declares each effect's `ref` prop
  // as `Ref<typeof EffectClass>` (a ref to the constructor) rather than
  // `Ref<InstanceType<typeof EffectClass>>` (a ref to what it actually
  // forwards: the constructed instance) — an upstream type inaccuracy, not
  // a runtime mismatch, so the casts below just restate each ref's real
  // instance type in the shape `wrapEffect`'s types expect.
  const lensRefProp = lensRef as unknown as Ref<typeof LensDistortionEffect>;
  const vignetteRefProp = vignetteRef as unknown as Ref<typeof VignetteEffect>;
  const chromaticRefProp = chromaticRef as unknown as Ref<typeof ChromaticAberrationEffect>;

  // Built exactly once (empty deps), then updated by mutating each effect's
  // own uniforms directly below — never by changing these elements' props.
  // `wrapEffect` (`util.js`) memoizes each effect's constructor `args` on
  // `JSON.stringify(props)`, and a changed `args` reference is what makes
  // `EffectComposer` tear down and rebuild its merged shader pass (a full
  // GPU recompile); reusing the same element tree for this window's whole
  // lifetime means dragging the Dev Settings strength slider only ever
  // updates uniforms, so it doesn't stutter.
  const composer = useMemo(
    () => (
      <EffectComposer multisampling={0} enableNormalPass={false}>
        <LensDistortion
          ref={lensRefProp}
          distortion={new Vector2(distortion, distortion)}
          principalPoint={LENS_PRINCIPAL_POINT}
          focalLength={LENS_FOCAL_LENGTH}
        />
        <Vignette ref={vignetteRefProp} eskil={false} darkness={vignetteDarkness} />
        {/* radialModulation true, unlike CrtEffect's false — fringing grows
         * toward the warped edges rather than applying flatly, so it reads
         * as a lens artifact rather than the CRT window's uniform colour
         * fringe. */}
        <ChromaticAberration
          ref={chromaticRefProp}
          offset={new Vector2(chromaticOffset, chromaticOffset)}
          radialModulation
          modulationOffset={0.3}
          blendFunction={BlendFunction.NORMAL}
        />
      </EffectComposer>
    ),
    // Only the initial mount's values seed construction — every later
    // change is applied by the effect below, so this must stay `[]`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useLayoutEffect(() => {
    lensRef.current?.distortion.set(distortion, distortion);
    if (vignetteRef.current) {
      vignetteRef.current.darkness = vignetteDarkness;
    }
    chromaticRef.current?.offset.set(chromaticOffset, chromaticOffset);
  }, [distortion, vignetteDarkness, chromaticOffset]);

  return composer;
}
