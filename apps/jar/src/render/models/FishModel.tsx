// Procedural fish model — primitives standing in for the real rigged
// GLTF pipeline (`docs/architecture/3d-engine.md` §6, §12). Implements the
// parts of that spec that don't need an actual mesh/rig asset: hue-via-
// material-color (§6.4), a simplified one-segment stand-in for the
// spine-wave animation (§6.6 — the real thing is 3 spine bones; this is a
// single tail pivot until a rigged model exists), life-stage scale (§6.3),
// spot toggles (§6.4), and sex dimorphism (§6.7).
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type * as YUKA from 'yuka';

import type { Critter } from '../../domain/protocol/generated/Critter';
import { lifeStageScale } from '../../domain/simConstants';

interface FishModelProps {
  critter: Critter;
  vehicle: YUKA.Vehicle;
}

const SPOT_OFFSETS: Array<[number, number, number]> = [
  [0.1, 0.05, 0.08],
  [0.05, -0.03, -0.08],
  [-0.05, 0.02, 0.08],
];

export function FishModel({ critter, vehicle }: FishModelProps) {
  const tailPivot = useRef<THREE.Group>(null);
  const bodyMaterialRef = useRef<THREE.MeshStandardMaterial>(null);

  // One random phase per fish, fixed at spawn — without it every fish beats
  // in perfect unison whenever they share a speed (§6.6).
  const phaseSeed = useMemo(() => Math.random() * Math.PI * 2, []);
  const prevDirection = useRef(new THREE.Vector3(0, 0, 1));

  const isMale = critter.sex === 'Male';
  const scale = lifeStageScale(critter.age_sec) * (isMale ? 1.0 : 1.0);
  const tailScale = isMale ? 1.2 : 1.0; // §6.7 — modest fin scale-up, males only
  const saturation = isMale ? 0.75 : 0.62; // §6.7 — a few points apart, not a strong split

  const bodyColor = useMemo(
    () => new THREE.Color().setHSL(critter.hue / 360, saturation, 0.55),
    [critter.hue, saturation],
  );

  useFrame((state, delta) => {
    const speed = vehicle.getSpeed();
    const direction =
      vehicle.velocity.squaredLength() > 0.0001
        ? new THREE.Vector3(vehicle.velocity.x, vehicle.velocity.y, vehicle.velocity.z).normalize()
        : prevDirection.current;

    // turnRate approximated from how fast the heading direction is
    // rotating, rather than tracked as a first-class steering output —
    // good enough to drive "sharper turn -> bigger S-curve" (§6.6).
    const angleDelta = prevDirection.current.angleTo(direction);
    const turnRate = delta > 0 ? angleDelta / delta : 0;
    prevDirection.current.copy(direction);

    const t = state.clock.elapsedTime;
    const frequency = 4 + speed * 2;
    const amplitude = speed < 0.05 ? 0.08 : 0.15 + Math.min(turnRate, 3) * 0.3;

    if (tailPivot.current) {
      const phase = t * frequency + phaseSeed;
      tailPivot.current.rotation.y = Math.sin(phase) * amplitude;
    }
  });

  return (
    <group scale={scale}>
      <mesh>
        <sphereGeometry args={[0.18, 12, 10]} />
        <meshStandardMaterial ref={bodyMaterialRef} color={bodyColor} roughness={0.6} />
      </mesh>

      <group ref={tailPivot} position={[-0.16, 0, 0]}>
        <mesh position={[-0.08, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <coneGeometry args={[0.1 * tailScale, 0.16 * tailScale, 8]} />
          <meshStandardMaterial color={bodyColor} roughness={0.6} />
        </mesh>
      </group>

      {critter.spots &&
        SPOT_OFFSETS.map((offset, i) => (
          <mesh key={i} position={offset}>
            <sphereGeometry args={[0.02, 6, 6]} />
            <meshStandardMaterial color="#2b2a33" roughness={0.8} />
          </mesh>
        ))}

      <mesh position={[0.14, 0.05, 0.08]}>
        <sphereGeometry args={[0.02, 6, 6]} />
        <meshStandardMaterial color="#101010" />
      </mesh>
      <mesh position={[0.14, 0.05, -0.08]}>
        <sphereGeometry args={[0.02, 6, 6]} />
        <meshStandardMaterial color="#101010" />
      </mesh>
    </group>
  );
}
