// The 3D tank viewport. Transparency setup here is load-bearing, not
// cosmetic — see `docs/architecture/3d-engine.md` §1.1: without
// `alpha`/`premultipliedAlpha`/a zeroed clear color, the bezel frame (wood,
// glass, CRT, etc. — themed HTML/CSS around this canvas) would show a
// black box instead of the tank contents.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { useEffect, useState } from 'react';
import * as THREE from 'three';

import { useJarStore } from '../../domain/jarClient';
import { AquariumEnvironment } from '../environment/AquariumEnvironment';
import { CrtEffect } from '../effects/CrtEffect';
import { Bubbles } from '../particles/Bubbles';
import { SteeringSystem } from '../steering/SteeringSystem';
import { CrittersLayer } from './CrittersLayer';
import { useRenderLoopPolicy } from './useRenderLoopPolicy';

THREE.ColorManagement.enabled = false;

export function TankScene() {
  // §1.3: the render loop pauses on window-hidden/minimized; the sim tick
  // itself is a separate, always-running timer this component never
  // touches (see `docs/architecture/rust-core.md` §5.1).
  const frameloop = useRenderLoopPolicy();
  const settings = useJarStore((s) => s.settings);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;

  return (
    <Canvas
      frameloop={frameloop}
      camera={{ fov: 38, position: [0, 2, 9] }}
      gl={{
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
        powerPreference: 'low-power',
      }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor(0x000000, 0);
        scene.background = null;
        scene.environment = null;
      }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 4, 3]} intensity={0.8} />
      {/* Physics steps at Rapier's own fixed rate, independent of the
          render frame rate (§5.1/§11) — `Physics` handles that internally. */}
      <Physics gravity={[0, 0, 0]}>
        <SteeringSystem>
          {/* Terrarium/gecko mode isn't implemented yet — see `NEXT_STEPS.md`. */}
          <AquariumEnvironment />
          <CrittersLayer />
        </SteeringSystem>
      </Physics>
      {settings.ambient_particles_on && settings.mode === 'Fish' && <Bubbles />}
      {settings.frame === 'NeonCrt' && <CrtEffect />}
    </Canvas>
  );
}
