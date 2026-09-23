// Neon/CRT frame's 3D-side effect (docs/architecture/3d-engine.md §10.3):
// a scanline overlay plus mild chromatic aberration, matching the original
// prototype's `crt` flag. Mounted only by `TankScene.tsx` when
// `settings.frame === 'NeonCrt'` — every other frame is bezel-only CSS
// chrome around an otherwise-unmodified canvas.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { ChromaticAberration, EffectComposer, Scanline } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { Vector2 } from 'three';

const ABERRATION_OFFSET = new Vector2(0.0006, 0.0006);

export function CrtEffect() {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Scanline blendFunction={BlendFunction.OVERLAY} density={1.25} opacity={0.35} />
      <ChromaticAberration
        offset={ABERRATION_OFFSET}
        radialModulation={false}
        modulationOffset={0}
      />
    </EffectComposer>
  );
}
