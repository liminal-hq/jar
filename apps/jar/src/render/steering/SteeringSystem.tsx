// Runs the three-phase steering/physics sync once per frame for every
// registered fish, per `docs/architecture/3d-engine.md` §3's per-frame
// order: read the RigidBody's actual position into the Yuka vehicle (so
// steering always reasons from ground truth) -> advance the shared
// `entityManager` (computes neighbors for separation, then each vehicle's
// steering behaviors) -> apply the resulting desired velocity to the
// RigidBody as an impulse, with heading set from the same vector.
//
// Deliberately *one* `useFrame` call for all fish, with no render-priority
// argument: `@react-three/fiber` v8 hands rendering control to userland the
// moment any `useFrame` callback passes a priority, which this scaffold
// has no reason to opt into — a per-fish `useFrame` for this phase ordering
// would require exactly that, which is why fish register into this
// system's registry instead of driving their own frame loop for it.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useFrame } from '@react-three/fiber';
import type { RapierRigidBody } from '@react-three/rapier';
import { createContext, useContext, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type * as YUKA from 'yuka';

import { entityManager } from './entityManager';

export interface RegisteredFish {
  vehicle: YUKA.Vehicle;
  getBody: () => RapierRigidBody | null;
  maxSpeed: () => number;
}

type Registry = Map<number, RegisteredFish>;

const SteeringRegistryContext = createContext<Registry | null>(null);

export function useSteeringRegistry(): Registry {
  const registry = useContext(SteeringRegistryContext);
  if (!registry) throw new Error('useSteeringRegistry must be used inside <SteeringSystem>');
  return registry;
}

const scratchImpulse = new THREE.Vector3();
const scratchHeading = new THREE.Quaternion();
const scratchForward = new THREE.Vector3(0, 0, 1);
const scratchVelocity = new THREE.Vector3();

/** Tuning constant translating a Yuka desired-velocity magnitude into an
 * impulse strength — a starting point to tune by eye once real models are
 * on screen (`docs/architecture/3d-engine.md` §5.2), not a derived value. */
const IMPULSE_SCALE = 0.03;
const MIN_VELOCITY_SQ = 0.0001;

interface SteeringSystemProps {
  children: ReactNode;
}

export function SteeringSystem({ children }: SteeringSystemProps) {
  const registryRef = useRef<Registry>(new Map());

  useFrame((_, delta) => {
    const registry = registryRef.current;

    for (const fish of registry.values()) {
      const body = fish.getBody();
      if (!body) continue;
      const t = body.translation();
      fish.vehicle.position.set(t.x, t.y, t.z);
      fish.vehicle.maxSpeed = fish.maxSpeed();
    }

    entityManager.update(delta);

    for (const fish of registry.values()) {
      const body = fish.getBody();
      if (!body) continue;

      scratchVelocity.set(
        fish.vehicle.velocity.x,
        fish.vehicle.velocity.y,
        fish.vehicle.velocity.z,
      );
      if (scratchVelocity.lengthSq() < MIN_VELOCITY_SQ) continue;

      scratchImpulse.copy(scratchVelocity).multiplyScalar(IMPULSE_SCALE);
      body.applyImpulse(scratchImpulse, true);

      scratchHeading.setFromUnitVectors(scratchForward, scratchVelocity.clone().normalize());
      body.setRotation(scratchHeading, true);
    }
  });

  return (
    <SteeringRegistryContext.Provider value={registryRef.current}>
      {children}
    </SteeringRegistryContext.Provider>
  );
}
