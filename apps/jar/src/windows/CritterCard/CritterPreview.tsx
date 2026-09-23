// A small rotatable 3D preview of one critter for the critter card
// (SCREENS.md W2) — reuses `FishModel` as-is rather than a flattened
// sprite/image, so the card shows the exact same rig, hue and gene-driven
// shape the tank does. `FishModel` normally reads its swim animation from
// a Yuka vehicle a real `<Fish>` drives via `SteeringSystem`; there's no
// steering here; a vehicle at rest still drives FishModel's idle
// tail-wag/mouth-cycle/bank-bob animation (all `state.clock.elapsedTime`
// oscillations rather than a function of real velocity), which reads as
// "gently swimming in place" — exactly what a profile view wants.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useMemo } from 'react';
import * as YUKA from 'yuka';

import type { Critter } from '../../domain/protocol/generated/Critter';
import { FishModel } from '../../render/models/FishModel';
import { useRenderLoopPolicy } from '../../render/tank/useRenderLoopPolicy';

interface CritterPreviewProps {
  critter: Critter;
  /** Renders a still, badge-marked memorial portrait instead of a live idle
   * swim — `CritterCardWindow`'s passed-on branch (SCREENS.md W2: "kept as
   * a picture" once a critter passes). The `†` mirrors the family tree's
   * own passed-critter marker (`FamilyTreeWindow.tsx`) rather than
   * inventing a second visual language for the same fact. */
  passed?: boolean;
}

/** Gecko/terrarium rendering isn't built yet (`NEXT_STEPS.md`) — `FishModel`
 * is fish-only, so this panel only ever mounts for `critter.species ===
 * 'Fish'` (checked by the caller); nothing here needs a species branch. */
export function CritterPreview({ critter, passed = false }: CritterPreviewProps) {
  // A stationary vehicle, not a real steering actor — never registered
  // with `entityManager`/`SteeringSystem`, so it never moves and never
  // needs cleanup. `FishModel` only ever reads its speed/velocity.
  const idleVehicle = useMemo(() => new YUKA.Vehicle(), []);

  // §1.3's render-loop policy, reused here: this `Canvas` lives in its own
  // WebviewWindow (the critter card), independent of the tank's own, so it
  // needs its own visibility-driven frameloop rather than inheriting one.
  const frameloop = useRenderLoopPolicy();

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '1 / 1',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--jar-preview-bg, rgba(0, 0, 0, 0.06))',
        margin: '0 0 8px',
        touchAction: 'none', // OrbitControls drags with the pointer, not page scroll
      }}
    >
      <Canvas
        frameloop={frameloop}
        camera={{ fov: 32, position: [0, 0.05, 2.4] }}
        gl={{ alpha: true, antialias: true }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[2, 4, 3]} intensity={0.9} />
        {/* Keyed by critter id: `FishModel` memoizes gene-derived geometry
            (`finType`, etc.) once at mount and keeps animation state in
            refs, neither of which reacts to `critter` changing identity —
            correct for a real `<Fish>`, which never gets retargeted to a
            different critter, but this preview does (`CritterCardWindow`
            swapping which critter is selected). A fresh key forces a clean
            remount instead of carrying over the previous critter's tail
            geometry or a frozen mid-swim pose. */}
        <FishModel key={critter.id} critter={critter} vehicle={idleVehicle} still={passed} />
        <OrbitControls
          enablePan={false}
          enableZoom={false}
          minDistance={1.5}
          maxDistance={4}
          rotateSpeed={0.6}
        />
      </Canvas>
      {passed && (
        <div
          title="Passed on"
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 24,
            height: 24,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            background: 'rgba(0, 0, 0, 0.45)',
            color: '#fff',
            pointerEvents: 'none',
          }}
        >
          †
        </div>
      )}
    </div>
  );
}
