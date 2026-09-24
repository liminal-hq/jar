// The fish-eye window's own small 3D scene — a second, independent R3F
// canvas (same pattern `CritterCard/CritterPreview.tsx` already
// establishes for a satellite window), driven entirely by the tank
// window's ~30Hz pose broadcast (`domain/fishPose.ts`) rather than running
// its own physics/steering: this window only ever *watches*, it never
// simulates. `AquariumEnvironment` is reused as-is (it only reads
// `useJarStore` for lighting and needs a Rapier `<Physics>` context to
// mount its wall/castle colliders) wrapped in a `paused` physics world —
// satisfies that context cheaply without ever actually stepping a second
// simulation.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { Canvas, useFrame } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import * as YUKA from 'yuka';

import { getFishEyeLensStrength, useFishEyeLensStrength } from '../../domain/devSettings';
import { useJarStore } from '../../domain/jarClient';
import type { FishPoseEntry, FishPoseSnapshot } from '../../domain/fishPose';
import { computeFishEyeLensParams } from '../../render/effects/fishEyeLens';
import { FishEyeLensEffect } from '../../render/effects/FishEyeLensEffect';
import { AquariumEnvironment } from '../../render/environment/AquariumEnvironment';
import { FishModel } from '../../render/models/FishModel';
import {
  EmptySteeringRegistry,
  POSE_PUBLISH_INTERVAL_SEC,
} from '../../render/steering/SteeringSystem';
import { useRenderLoopPolicy } from '../../render/tank/useRenderLoopPolicy';

/** The two most recent pose snapshots plus when `curr` was actually
 * received (`performance.now()`, a monotonic clock shared across every
 * window's JS realm) — interpolation timing is deliberately anchored to
 * that receipt time, not to either snapshot's own `t` (the *tank* window's
 * own R3F clock, a different clock instance from this window's, with no
 * meaningful shared origin to compare against). */
export interface PoseBuffer {
  prev: FishPoseSnapshot | null;
  curr: FishPoseSnapshot | null;
  receivedAtMs: number;
}

/** `SteeringSystem.tsx`'s own publish cadence, in milliseconds — the
 * interpolation window a fresh `curr` snapshot blends in over. Derived from
 * the shared `POSE_PUBLISH_INTERVAL_SEC` rather than a second hardcoded
 * `1 / 30`, so the two can't drift apart. */
const POSE_PUBLISH_INTERVAL_MS = POSE_PUBLISH_INTERVAL_SEC * 1000;

/** A small forward-and-up offset from the fish's own centre, in its local
 * space — just far enough past a typical adult collider radius that the
 * camera sits ahead of the fish's own body instead of inside it. */
const CAMERA_FORWARD_MARGIN = 0.05;
const CAMERA_UP_OFFSET = 0.03;

const ROTATE_180_Y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

function findPose(snapshot: FishPoseSnapshot | null, id: number): FishPoseEntry | null {
  return snapshot?.poses.find((p) => p.id === id) ?? null;
}

/** Blends two pose entries by `alpha` (0 = `a`, 1 = `b`) into `outPos`/
 * `outQuat` — falls back to whichever single entry exists when the other
 * is missing (a fish that just spawned, or one only present in the older
 * snapshot), rather than requiring both. */
function interpolatePose(
  a: FishPoseEntry | null,
  b: FishPoseEntry | null,
  alpha: number,
  outPos: THREE.Vector3,
  outQuat: THREE.Quaternion,
): boolean {
  const from = a ?? b;
  const to = b ?? a;
  if (!from || !to) return false;
  outPos.set(from.pos[0], from.pos[1], from.pos[2]);
  outQuat.set(from.quat[0], from.quat[1], from.quat[2], from.quat[3]);
  if (a && b) {
    outPos.lerp(new THREE.Vector3(to.pos[0], to.pos[1], to.pos[2]), alpha);
    outQuat.slerp(new THREE.Quaternion(to.quat[0], to.quat[1], to.quat[2], to.quat[3]), alpha);
  }
  return true;
}

interface CameraRigProps {
  posesRef: MutableRefObject<PoseBuffer>;
  cameraFishId: number | null;
}

function CameraRig({ posesRef, cameraFishId }: CameraRigProps) {
  const scratchPos = useMemo(() => new THREE.Vector3(), []);
  const scratchQuat = useMemo(() => new THREE.Quaternion(), []);
  const scratchOffset = useMemo(() => new THREE.Vector3(), []);
  const lensStrength = useFishEyeLensStrength();
  const { fov } = computeFishEyeLensParams(lensStrength);

  useFrame(({ camera }) => {
    // Kept in sync here, alongside the position/orientation update below,
    // rather than in a separate `useEffect` — reactive to live Dev Settings
    // tuning (`domain/devSettings.ts`) at no extra per-frame cost once
    // `fov` stops changing, since the `!==` check skips
    // `updateProjectionMatrix()` on ordinary frames.
    const pCamera = camera as THREE.PerspectiveCamera;
    if (pCamera.fov !== fov) {
      pCamera.fov = fov;
      pCamera.updateProjectionMatrix();
    }
    if (cameraFishId === null) return;
    const { prev, curr, receivedAtMs } = posesRef.current;
    if (!curr) return;
    const alpha = THREE.MathUtils.clamp(
      (performance.now() - receivedAtMs) / POSE_PUBLISH_INTERVAL_MS,
      0,
      1,
    );
    const a = findPose(prev, cameraFishId);
    const b = findPose(curr, cameraFishId);
    if (!interpolatePose(a, b, alpha, scratchPos, scratchQuat)) return;

    const radius = (b ?? a)?.colliderRadius ?? 0.3;
    scratchOffset.set(0, CAMERA_UP_OFFSET, radius + CAMERA_FORWARD_MARGIN);
    scratchOffset.applyQuaternion(scratchQuat);
    camera.position.copy(scratchPos).add(scratchOffset);
    camera.quaternion.copy(scratchQuat).multiply(ROTATE_180_Y);
  });

  return null;
}

interface TankmateProps {
  id: number;
  posesRef: MutableRefObject<PoseBuffer>;
}

function Tankmate({ id, posesRef }: TankmateProps) {
  const critter = useJarStore((s) => s.critters[id]);
  const groupRef = useRef<THREE.Group>(null);
  // A stationary vehicle, not a real steering actor — same rationale as
  // `CritterPreview.tsx`'s own idle vehicle: `FishModel` only ever reads
  // its speed (zero, here) to drive its own idle tail-wag/mouth-cycle
  // animation, which reads as "gently swimming in place." Real position/
  // orientation come from the interpolated pose below instead, applied to
  // the wrapping `<group>`, not the vehicle.
  const idleVehicle = useMemo(() => new YUKA.Vehicle(), []);
  const scratchPos = useMemo(() => new THREE.Vector3(), []);
  const scratchQuat = useMemo(() => new THREE.Quaternion(), []);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const { prev, curr, receivedAtMs } = posesRef.current;
    const alpha = THREE.MathUtils.clamp(
      (performance.now() - receivedAtMs) / POSE_PUBLISH_INTERVAL_MS,
      0,
      1,
    );
    const a = findPose(prev, id);
    const b = findPose(curr, id);
    if (!interpolatePose(a, b, alpha, scratchPos, scratchQuat)) return;
    group.position.copy(scratchPos);
    group.quaternion.copy(scratchQuat);
  });

  if (!critter) return null;
  return (
    <group ref={groupRef}>
      <FishModel key={id} critter={critter} vehicle={idleVehicle} />
    </group>
  );
}

interface FishEyeSceneProps {
  posesRef: MutableRefObject<PoseBuffer>;
  cameraFishId: number | null;
  tankmateIds: number[];
}

export function FishEyeScene({ posesRef, cameraFishId, tankmateIds }: FishEyeSceneProps) {
  const frameloop = useRenderLoopPolicy();

  return (
    <Canvas
      frameloop={frameloop}
      camera={{ fov: computeFishEyeLensParams(getFishEyeLensStrength()).fov, position: [0, 0, 0] }}
      gl={{ alpha: true, antialias: true, premultipliedAlpha: false }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor(0x000000, 0);
        scene.background = null;
        scene.environment = null;
      }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 4, 3]} intensity={0.8} />
      <Physics paused gravity={[0, 0, 0]}>
        <EmptySteeringRegistry>
          <AquariumEnvironment />
        </EmptySteeringRegistry>
      </Physics>
      {tankmateIds
        .filter((id) => id !== cameraFishId)
        .map((id) => (
          <Tankmate key={id} id={id} posesRef={posesRef} />
        ))}
      <CameraRig posesRef={posesRef} cameraFishId={cameraFishId} />
      <FishEyeLensEffect />
    </Canvas>
  );
}
