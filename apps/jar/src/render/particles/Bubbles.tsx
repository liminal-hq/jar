// Bubbles (aquarium, `docs/architecture/3d-engine.md` §9.1): rise velocity
// plus per-particle noise perturbing the horizontal (and slightly
// vertical) component so bubbles wander as they rise, rather than
// travelling a straight line. Not physics bodies (§5.3/§9) — cheap,
// capped-count visual particles only, using a hand-rolled sine-sum noise
// rather than a real simplex/Perlin library, which is a reasonable
// placeholder but worth swapping for a real noise function later (a
// hand-rolled sum-of-sines has visible periodicity a real noise function
// wouldn't).
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

import { TANK_HEIGHT, TANK_WIDTH } from '../physics/coordinates';

const BUBBLE_COUNT = 30; // §9.1: ~20-40 concurrent bubbles
const RISE_SPEED = 0.35;
const DRIFT_STRENGTH = 0.12;
const AIRSTONE_X = TANK_WIDTH * (0.66 - 0.5); // §8.1: "~66% x, near the rock"
const AIRSTONE_Z = 0;

interface BubbleState {
  age: number;
  lifetime: number;
  seed: number;
}

export function Bubbles() {
  const pointsRef = useRef<THREE.Points>(null);

  const { geometry, states } = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(BUBBLE_COUNT * 3);
    const bubbleStates: BubbleState[] = [];

    for (let i = 0; i < BUBBLE_COUNT; i++) {
      const lifetime = 3 + Math.random() * 2;
      bubbleStates.push({ age: Math.random() * lifetime, lifetime, seed: Math.random() * 1000 });
      positions[i * 3] = AIRSTONE_X;
      positions[i * 3 + 1] = -TANK_HEIGHT / 2;
      positions[i * 3 + 2] = AIRSTONE_Z;
    }

    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return { geometry: geom, states: bubbleStates };
  }, []);

  useFrame((state, delta) => {
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const t = state.clock.elapsedTime;

    for (let i = 0; i < BUBBLE_COUNT; i++) {
      const bubble = states[i];
      if (!bubble) continue;
      bubble.age += delta;

      if (bubble.age >= bubble.lifetime) {
        bubble.age = 0;
        bubble.lifetime = 3 + Math.random() * 2;
        bubble.seed = Math.random() * 1000;
        positionAttr.setXYZ(i, AIRSTONE_X, -TANK_HEIGHT / 2, AIRSTONE_Z);
        continue;
      }

      const life = bubble.age / bubble.lifetime;
      const y = -TANK_HEIGHT / 2 + life * TANK_HEIGHT * RISE_SPEED * 3;

      // Cheap "wander as it rises" perturbation — see the file header on
      // swapping this for real simplex noise later.
      const driftX =
        Math.sin(t * 1.3 + bubble.seed) * DRIFT_STRENGTH +
        Math.sin(t * 0.6 + bubble.seed * 2.1) * DRIFT_STRENGTH * 0.4;
      const driftZ = Math.cos(t * 1.1 + bubble.seed * 1.7) * DRIFT_STRENGTH * 0.6;

      positionAttr.setXYZ(i, AIRSTONE_X + driftX, y, AIRSTONE_Z + driftZ);
    }

    positionAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      <pointsMaterial color="#cfeeff" size={0.04} transparent opacity={0.7} depthWrite={false} />
    </points>
  );
}
