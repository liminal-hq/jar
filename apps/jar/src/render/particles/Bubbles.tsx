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
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { TANK_HEIGHT, TANK_WIDTH } from '../physics/coordinates';

// Allocated once at the top of the 0-200% intensity range (Setup's own
// "Bubble intensity" slider) — 100% lands on §9.1's original ~20-40
// concurrent-bubble figure via MAX_BUBBLE_COUNT/2, 200% reaches the full
// allocated buffer. `geometry.setDrawRange` (not a resize) is what
// actually varies the visible count per frame, so the setting can change
// live without reallocating or remounting this component.
const MAX_BUBBLE_COUNT = 60;
const RISE_SPEED = 0.35;
const DRIFT_STRENGTH = 0.12;
const AIRSTONE_X = TANK_WIDTH * (0.66 - 0.5); // §8.1: "~66% x, near the rock"
const AIRSTONE_Z = 0;

interface BubbleState {
  age: number;
  lifetime: number;
  seed: number;
}

export function Bubbles({ intensityPercent }: { intensityPercent: number }) {
  const pointsRef = useRef<THREE.Points>(null);

  const { geometry, states } = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_BUBBLE_COUNT * 3);
    const bubbleStates: BubbleState[] = [];

    for (let i = 0; i < MAX_BUBBLE_COUNT; i++) {
      const lifetime = 3 + Math.random() * 2;
      bubbleStates.push({ age: Math.random() * lifetime, lifetime, seed: Math.random() * 1000 });
      positions[i * 3] = AIRSTONE_X;
      positions[i * 3 + 1] = -TANK_HEIGHT / 2;
      positions[i * 3 + 2] = AIRSTONE_Z;
    }

    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return { geometry: geom, states: bubbleStates };
  }, []);

  // §9.1's original ~20-40 concurrent bubbles sits at 100% (half of
  // MAX_BUBBLE_COUNT); `setDrawRange` alone hides the inactive tail of the
  // buffer — no reallocation, so this can change live off the slider
  // without remounting the whole particle system.
  const activeCount = Math.round(
    THREE.MathUtils.clamp((MAX_BUBBLE_COUNT * intensityPercent) / 200, 0, MAX_BUBBLE_COUNT),
  );
  useEffect(() => {
    geometry.setDrawRange(0, activeCount);
  }, [geometry, activeCount]);

  useFrame((state, delta) => {
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const t = state.clock.elapsedTime;

    for (let i = 0; i < activeCount; i++) {
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
