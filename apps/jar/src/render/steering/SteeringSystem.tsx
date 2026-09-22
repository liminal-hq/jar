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
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type * as YUKA from 'yuka';

import { publishFishPositions } from '../../domain/debugChannel';
import { useFishPositionOverlayEnabled } from '../../domain/devSettings';
import { entityManager } from './entityManager';
import { computeTargetHeading } from './heading';
import type { FishMotionMode } from './motionState';

export interface RegisteredFish {
  vehicle: YUKA.Vehicle;
  getBody: () => RapierRigidBody | null;
  maxSpeed: () => number;
  getMode: () => FishMotionMode;
  /** Slerped toward `targetHeading` each frame rather than snapped, so
   * turns visibly "swim through" instead of teleporting — seeded from the
   * body's actual rotation at registration time (`Fish.tsx`). */
  currentHeading: THREE.Quaternion;
  targetHeading: THREE.Quaternion;
}

type Registry = Map<number, RegisteredFish>;

const SteeringRegistryContext = createContext<Registry | null>(null);

export function useSteeringRegistry(): Registry {
  const registry = useContext(SteeringRegistryContext);
  if (!registry) throw new Error('useSteeringRegistry must be used inside <SteeringSystem>');
  return registry;
}

const scratchImpulse = new THREE.Vector3();
const scratchVelocity = new THREE.Vector3();
const scratchLinvel = new THREE.Vector3();

/** Converts a (desired − actual) velocity error into an impulse —
 * velocity-matching rather than the flat open-loop `desired * scale` this
 * replaced, which injected fresh momentum every frame regardless of what
 * the body was already doing, piling up against walls and releasing as a
 * burst. This is framerate-independent (the `* delta`), self-caps at
 * `vehicle.maxSpeed` (Yuka already clamps `desired`), and cooperates with
 * `linearDamping` instead of fighting it. */
const VELOCITY_GAIN = 0.6;
const MIN_VELOCITY_SQ = 0.0001;

/** The fish-position debug publish goes over a cross-window Tauri event
 * (`domain/debugChannel.ts` — the Dev settings window that displays it is a
 * separate JS realm), so it's worth throttling well below the render frame
 * rate: a 60Hz IPC cost for a dev-only readout nobody needs updated that
 * often isn't worth paying. */
const POSITION_PUBLISH_INTERVAL_MS = 200;

/** Framerate-independent slerp rate toward the target heading — a ~0.17s
 * time constant (a fish completes most of a turn in well under half a
 * second: responsive, but visibly curving through the turn rather than
 * teleporting its orientation). */
const HEADING_SLERP_RATE = 6;

/** Yuka never damps a vehicle's own velocity on its own — deactivating a
 * fish's steering behaviors (`useFishSteering.ts`'s `setMode`) leaves
 * `vehicle.velocity` frozen at whatever it last was, forever, unless
 * something actively decays it. This is that decay for any fish not in
 * `active` mode; the velocity-matching impulse above then brakes the body
 * to match as the decayed target chases toward zero, cooperating with
 * `linearDamping` rather than leaving the body's own momentum to bleed off
 * unassisted. */
const NON_ACTIVE_VELOCITY_DECAY_RATE = 4;

interface SteeringSystemProps {
  children: ReactNode;
}

export function SteeringSystem({ children }: SteeringSystemProps) {
  const registryRef = useRef<Registry>(new Map());

  // A ref, not read directly in `useFrame` — the toggle can flip mid-session
  // (Dev settings window, any window) and this component doesn't otherwise
  // re-render on its own frame loop, so `useFrame`'s closure needs a live
  // value to check rather than one captured at mount.
  const positionOverlayEnabled = useFishPositionOverlayEnabled();
  const positionOverlayEnabledRef = useRef(positionOverlayEnabled);
  useEffect(() => {
    positionOverlayEnabledRef.current = positionOverlayEnabled;
  }, [positionOverlayEnabled]);
  const lastPublishRef = useRef(0);

  useFrame((state, delta) => {
    const registry = registryRef.current;

    const publishPositions =
      positionOverlayEnabledRef.current &&
      state.clock.elapsedTime - lastPublishRef.current >= POSITION_PUBLISH_INTERVAL_MS / 1000;
    const debugPositions: Record<number, { x: number; y: number; z: number }> | null =
      publishPositions ? {} : null;

    for (const [id, fish] of registry.entries()) {
      const body = fish.getBody();
      if (!body) continue;
      const t = body.translation();
      fish.vehicle.position.set(t.x, t.y, t.z);
      fish.vehicle.maxSpeed = fish.maxSpeed();
      if (debugPositions) debugPositions[id] = { x: t.x, y: t.y, z: t.z };
    }
    if (debugPositions) {
      lastPublishRef.current = state.clock.elapsedTime;
      publishFishPositions(debugPositions);
    }

    entityManager.update(delta);

    for (const fish of registry.values()) {
      const body = fish.getBody();
      if (!body) continue;

      if (fish.getMode() !== 'active') {
        fish.vehicle.velocity.multiplyScalar(Math.exp(-NON_ACTIVE_VELOCITY_DECAY_RATE * delta));
      }

      scratchVelocity.set(
        fish.vehicle.velocity.x,
        fish.vehicle.velocity.y,
        fish.vehicle.velocity.z,
      );

      if (scratchVelocity.lengthSq() >= MIN_VELOCITY_SQ) {
        const lv = body.linvel();
        scratchLinvel.set(lv.x, lv.y, lv.z);
        scratchImpulse
          .copy(scratchVelocity)
          .sub(scratchLinvel)
          .multiplyScalar(VELOCITY_GAIN * delta);
        body.applyImpulse(scratchImpulse, true);

        const target = computeTargetHeading(scratchVelocity);
        if (target) fish.targetHeading.copy(target);
      }

      const slerpFactor = 1 - Math.exp(-HEADING_SLERP_RATE * delta);
      fish.currentHeading.slerp(fish.targetHeading, slerpFactor);
      body.setRotation(fish.currentHeading, true);
    }
  });

  return (
    <SteeringRegistryContext.Provider value={registryRef.current}>
      {children}
    </SteeringRegistryContext.Provider>
  );
}
