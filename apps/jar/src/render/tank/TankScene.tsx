// The 3D tank viewport. Transparency setup here is load-bearing, not
// cosmetic — see `docs/architecture/3d-engine.md` §1.1: without
// `alpha`/`premultipliedAlpha`/a zeroed clear color, the bezel frame (wood,
// glass, CRT, etc. — themed HTML/CSS around this canvas) would show a
// black box instead of the tank contents.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
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
import { setTankCanvasElement } from './canvasCapture';
import { clampClockDelta } from './clampClockDelta';
import { CrittersLayer } from './CrittersLayer';
import { useRenderLoopPolicy } from './useRenderLoopPolicy';

THREE.ColorManagement.enabled = false;

/** ~6 fixed Rapier substeps' worth of catch-up in one rendered frame after a
 * stall — fast, but no longer a one-frame snap. See `clampClockDelta.ts`. */
const MAX_FRAME_DELTA_SEC = 0.1;

export function TankScene() {
  // §1.3: the render loop pauses on window-hidden/minimized; the sim tick
  // itself is a separate, always-running timer this component never
  // touches (see `docs/architecture/rust-core.md` §5.1).
  const frameloop = useRenderLoopPolicy();
  const settings = useJarStore((s) => s.settings);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  // The Screenshot menu item (`TankContextMenu.tsx`) reads the canvas
  // element via `canvasCapture.ts` well outside this component's own
  // lifetime — clear the reference on unmount so a stale element never
  // outlives the scene that owned it.
  useEffect(() => () => setTankCanvasElement(null), []);
  if (!ready) return null;

  return (
    <Canvas
      frameloop={frameloop}
      camera={{ fov: 38, position: [0, 2, 9] }}
      shadows
      gl={{
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
        powerPreference: 'low-power',
        // Without this, `canvas.toBlob()` called on demand from the
        // Screenshot menu item — well after this frame's already been
        // presented, not synchronously inside the render loop — can read
        // a cleared buffer instead of the last drawn frame. Usually a
        // negligible cost at this canvas's size; not a default to reach
        // for lightly on a `gl` config this file's header already calls
        // load-bearing (docs/architecture/3d-engine.md §1.1).
        preserveDrawingBuffer: true,
      }}
      onCreated={({ gl, scene, clock }) => {
        gl.setClearColor(0x000000, 0);
        scene.background = null;
        scene.environment = null;
        clampClockDelta(clock, MAX_FRAME_DELTA_SEC);
        setTankCanvasElement(gl.domElement);
      }}
    >
      <ambientLight intensity={0.6} />
      {/* `shadow-camera-*` sized to the tank's own ~6×4×3 volume (default
          orthographic bounds are far more generous than this small a scene
          needs, which only wastes shadow-map resolution on empty space). */}
      <directionalLight
        position={[2, 4, 3]}
        intensity={0.8}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-3.5}
        shadow-camera-right={3.5}
        shadow-camera-top={2.5}
        shadow-camera-bottom={-2.5}
        shadow-camera-near={0.5}
        shadow-camera-far={10}
      />
      {/* Physics steps at Rapier's own fixed rate, independent of the
          render frame rate (§5.1/§11) — `Physics` handles that internally. */}
      <Physics gravity={[0, 0, 0]}>
        <SteeringSystem>
          {/* Terrarium/gecko mode isn't implemented yet — see `NEXT_STEPS.md`. */}
          <AquariumEnvironment />
          <CrittersLayer />
        </SteeringSystem>
      </Physics>
      {settings.ambient_particles_on && settings.mode === 'Fish' && (
        <Bubbles intensityPercent={settings.bubble_intensity} />
      )}
      {settings.frame === 'NeonCrt' && <CrtEffect />}
    </Canvas>
  );
}
