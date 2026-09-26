// One snail: a self-contained controller, not a generalized `SteeringSystem`
// participant — no Yuka vehicle, no steering-registry entry
// (`docs/architecture/3d-engine.md` §4.4's settled architecture: the
// accepted cost is that fish won't separation-steer around a snail, but the
// kinematic collider below still keeps them from overlapping one). It owns
// a `CrawlPose` (`crawlSurfaces.ts`) directly, advances it in `useFrame`, and
// converts it to a script-authored position/rotation on a **kinematic**
// Rapier `RigidBody` — the same "no gravity fight" discipline as `Fish.tsx`'s
// dynamic one, just without physics ever moving it. Presents `SnailModel`,
// driving its `tuckProgress`/`tuckMode` from `snailBehaviour.ts`'s state
// machine. Also publishes its own telemetry into `domain/critterDebug.ts`
// (the Tank monitor window's bridge), gated by the same dev toggle as the
// fish's own publisher in `SteeringSystem.tsx`.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useFrame } from '@react-three/fiber';
import {
  CuboidCollider,
  RigidBody,
  type CollisionEnterPayload,
  type RapierRigidBody,
} from '@react-three/rapier';
import { useRef, useState } from 'react';
import * as THREE from 'three';

import {
  DEBUG_PUBLISH_INTERVAL_SEC,
  emitCritterDebug,
  type CritterDebugEntry,
} from '../../domain/critterDebug';
import { isAsleep, isNightPresentation } from '../../domain/dayNight';
import { useDayNightOverride, useTankMonitorEnabled } from '../../domain/devSettings';
import { useJarStore } from '../../domain/jarClient';
import type { Critter } from '../../domain/protocol/generated/Critter';
import { selectCritter } from '../../domain/selection';
import { lifeStageScale } from '../../domain/simConstants';
import {
  advance,
  dropToFloor,
  poseToWorld,
  randomFloorPose,
  turn,
  type CrawlFrame,
  type CrawlPose,
  type Vec3,
} from '../environment/crawlSurfaces';
import { SnailModel } from '../models/SnailModel';
import { SNAIL_BODY_SCALE, SOLE_Y, SVG_SCALE } from '../models/snailGeometry';
import {
  createInitialSnailBehaviour,
  DETACH_SINK_DURATION_SEC,
  isMoving,
  stepSnailBehaviour,
  type SnailBehaviourState,
} from './snailBehaviour';
import { snailColliderHalfExtentsFor } from './snailCollider';

interface SnailProps {
  critter: Critter;
}

/** World units/sec — slow and exaggerated for legibility (project
 * convention: bias toward visual exaggeration over physical accuracy, not
 * a literal snail's real crawl speed), tuned by eye the same way `Fish.tsx`
 * tunes its own speed/roll constants. */
const CRAWL_SPEED = 0.12;

/** A slow random-walk on heading (rather than fixed straight lines between
 * bounces) so a crawling snail reads as wandering, not marching — the
 * Yuka-free stand-in for a fish's wander-circle behaviour. Tune by eye. */
const HEADING_BIAS_JITTER = 0.6;
const MAX_HEADING_BIAS = 0.8;

/** Framerate-independent slerp rate toward the crawl pose's own
 * orientation — `SteeringSystem.tsx`'s fish-heading pattern
 * (`1 - Math.exp(-rate * delta)`) at a snail's pace. A ~0.4s time constant,
 * so crossing a fold in `crawlSurfaces.ts` (floor onto a wall, wall onto a
 * castle face) bends over about a second instead of flipping in one frame.
 * Deliberately far below the fish's `6`: pitching a whole body onto a new
 * surface is a much larger event than a fish trimming its heading
 * mid-swim, and the project's exaggeration bias wants that visibly gooey.
 * The lower bound on the rate is ordinary wandering, where the smoothing
 * lags a sustained heading drift by roughly `MAX_HEADING_BIAS / rate`
 * radians — much slower than this and a wandering snail stops reading as
 * bending into its turns and starts reading as crabbing sideways. */
const ORIENTATION_SLERP_RATE = 2.5;

/** The dawn-on-a-wall / fish-knock-loose float-down: gentle, not ballistic
 * (issue #98's settled spec) — a small decaying horizontal sway layered on
 * top of a smoothstep-eased straight-line descent to the landing spot. */
const DETACH_SWAY_AMPLITUDE = 0.03;
const DETACH_SWAY_CYCLES = 2.5;

interface DetachAnchor {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  landed: CrawlPose;
  /** Derived from `landed` once, here, rather than every frame of the
   * ~1.4s detach animation — `landed` (and so these) never change once
   * the anchor is set, only the lerp/slerp ratio toward them does. */
  targetPosition: THREE.Vector3;
  targetQuaternion: THREE.Quaternion;
}

// Only the debug-telemetry publisher below needs a raw Euler decomposition
// — mirrors `SteeringSystem.tsx`'s own scratch object and yaw/pitch
// extraction, so the Tank monitor's map projections read the same way for
// a snail row as a fish one.
const scratchYawEuler = new THREE.Euler();

/** `frame.forward`→local `+Z`, `frame.up`→local `+Y` — the same axis
 * convention `fishCollider.ts` and `Fish.tsx` use, so this component's inner
 * model group needs the identical `-90°` yaw correction `Fish.tsx` applies
 * (both models are authored facing `+X`). `xAxis` (local `+X`) is derived
 * as `up × forward` rather than reusing `frame.right` directly, since that's
 * the assignment that keeps (`forward`, `up`, `xAxis`) a proper
 * right-handed basis under this module's `(x, y, z)` axis order. */
function quaternionFromFrame(frame: CrawlFrame): THREE.Quaternion {
  const forward = new THREE.Vector3(frame.forward.x, frame.forward.y, frame.forward.z);
  const up = new THREE.Vector3(frame.up.x, frame.up.y, frame.up.z);
  const xAxis = new THREE.Vector3().crossVectors(up, forward).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(xAxis, up, forward),
  );
}

/** The RigidBody's own root sits above the sole by `-SOLE_Y * scale` along
 * `up` (`SOLE_Y` is negative, in `snailGeometry.ts`'s raw-SVG-derived
 * convention) — the model's local origin isn't the contact point;
 * `snailCollider.ts`'s own `centreOffsetY` is the collider's equivalent
 * correction. */
function rootPositionFromContact(contact: Vec3, up: THREE.Vector3, scale: number): THREE.Vector3 {
  return new THREE.Vector3(contact.x, contact.y, contact.z).addScaledVector(up, -SOLE_Y * scale);
}

function rootPositionFromFrame(frame: CrawlFrame, scale: number): THREE.Vector3 {
  return rootPositionFromContact(
    frame.position,
    new THREE.Vector3(frame.up.x, frame.up.y, frame.up.z),
    scale,
  );
}

function isFishRigidBody(userData: unknown): boolean {
  return (
    typeof userData === 'object' &&
    userData !== null &&
    (userData as { kind?: unknown }).kind === 'fish'
  );
}

export function Snail({ critter }: SnailProps) {
  const rigidBodyRef = useRef<RapierRigidBody>(null);

  const scale = lifeStageScale(critter.life_stage) * SVG_SCALE * SNAIL_BODY_SCALE;
  const he = snailColliderHalfExtentsFor(critter);

  // Spawn once at mount, mutated in place every frame thereafter — this
  // pose drives an imperative kinematic body transform, not a render, so it
  // lives in a ref rather than React state (same rationale as `Fish.tsx`'s
  // `currentHeadingRef`).
  const poseRef = useRef<CrawlPose>(randomFloorPose(Math.random));
  const initialFrame = poseToWorld(poseRef.current);
  const positionRef = useRef<THREE.Vector3>(rootPositionFromFrame(initialFrame, scale));
  const quaternionRef = useRef<THREE.Quaternion>(quaternionFromFrame(initialFrame));

  const behaviourRef = useRef<SnailBehaviourState>(createInitialSnailBehaviour());
  const headingBiasRef = useRef(0);
  const startleRequestRef = useRef(false);
  const fishContactRequestRef = useRef(false);
  const detachAnchorRef = useRef<DetachAnchor | null>(null);

  const [tuckProgress, setTuckProgress] = useState(0);
  const [tuckMode, setTuckMode] = useState<'sleep' | 'startle'>('sleep');

  const simNight = useJarStore((s) => s.isNight);
  const simSeconds = useJarStore((s) => s.simSeconds);
  const dayNightOverride = useDayNightOverride();
  const monitorEnabled = useTankMonitorEnabled();
  const publishElapsedRef = useRef(0);

  useFrame((_, delta) => {
    const body = rigidBodyRef.current;
    if (!body) return;

    const asleep = isAsleep('Snail', dayNightOverride, simNight);
    const onFloor = poseRef.current.faceId === 'floor';
    const prevMode = behaviourRef.current.mode;

    behaviourRef.current = stepSnailBehaviour(
      behaviourRef.current,
      {
        asleep,
        onFloor,
        startle: startleRequestRef.current,
        fishContact: fishContactRequestRef.current,
        random: Math.random,
      },
      delta,
    );
    startleRequestRef.current = false;
    fishContactRequestRef.current = false;

    const mode = behaviourRef.current.mode;

    if (mode === 'detached') {
      if (prevMode !== 'detached' || !detachAnchorRef.current) {
        const landed = dropToFloor(positionRef.current);
        const targetFrame = poseToWorld(landed);
        detachAnchorRef.current = {
          position: positionRef.current.clone(),
          quaternion: quaternionRef.current.clone(),
          landed,
          targetPosition: rootPositionFromFrame(targetFrame, scale),
          targetQuaternion: quaternionFromFrame(targetFrame),
        };
      }
      const anchor = detachAnchorRef.current;

      const ratio = THREE.MathUtils.clamp(
        behaviourRef.current.elapsed / DETACH_SINK_DURATION_SEC,
        0,
        1,
      );
      const eased = THREE.MathUtils.smoothstep(ratio, 0, 1);

      positionRef.current.copy(anchor.position).lerp(anchor.targetPosition, eased);
      positionRef.current.x +=
        DETACH_SWAY_AMPLITUDE * Math.sin(ratio * Math.PI * DETACH_SWAY_CYCLES) * (1 - ratio);
      quaternionRef.current.copy(anchor.quaternion).slerp(anchor.targetQuaternion, eased);
    } else {
      if (prevMode === 'detached' && detachAnchorRef.current) {
        poseRef.current = detachAnchorRef.current.landed;
        detachAnchorRef.current = null;
      }

      if (isMoving(mode)) {
        headingBiasRef.current = THREE.MathUtils.clamp(
          headingBiasRef.current + (Math.random() - 0.5) * HEADING_BIAS_JITTER * delta,
          -MAX_HEADING_BIAS,
          MAX_HEADING_BIAS,
        );
        poseRef.current = advance(
          turn(poseRef.current, headingBiasRef.current * delta),
          CRAWL_SPEED * delta,
        );
      }

      // Orientation eases toward the pose rather than snapping onto it, so
      // a fold crossing bends instead of blipping. Position deliberately
      // does not: it's always lifted along the *current face's own* up
      // (`rootPositionFromFrame`'s `frame.up`), never the still-easing
      // quaternion's — lifting along a lagging orientation was tried first
      // and looks worse than either alternative: right after crossing a
      // fold, the eased "up" is still pointing along the *previous* face's
      // normal, so the lift barely clears the new surface at all, and the
      // root sinks toward (or through) it until the slow rotation catches
      // up. Anchoring position to the true, always-correct normal instead
      // means the root never leaves the surface it's actually standing on;
      // the body just visibly swings around that fixed anchor as its own
      // rotation eases in, which reads as the bend, not the floor clipping
      // through the model.
      const frame = poseToWorld(poseRef.current);
      const slerpFactor = 1 - Math.exp(-ORIENTATION_SLERP_RATE * delta);
      quaternionRef.current.slerp(quaternionFromFrame(frame), slerpFactor);
      positionRef.current.copy(rootPositionFromFrame(frame, scale));
    }

    body.setNextKinematicTranslation(positionRef.current);
    body.setNextKinematicRotation(quaternionRef.current);

    if (
      tuckProgress !== behaviourRef.current.tuckProgress ||
      tuckMode !== behaviourRef.current.tuckMode
    ) {
      setTuckProgress(behaviourRef.current.tuckProgress);
      setTuckMode(behaviourRef.current.tuckMode);
    }

    // Publishes into the same bridge the fish's `SteeringSystem.tsx` does
    // (`domain/critterDebug.ts`), gated by the same dev toggle and rate —
    // but as this snail's own single-entry snapshot rather than a batch,
    // since (per the settled architecture) there's no shared snail registry
    // to collect one from. The Tank monitor window merges entries from
    // every publisher by id rather than replacing its table wholesale.
    if (monitorEnabled) {
      publishElapsedRef.current += delta;
      if (publishElapsedRef.current >= DEBUG_PUBLISH_INTERVAL_SEC) {
        publishElapsedRef.current = 0;
        scratchYawEuler.setFromQuaternion(quaternionRef.current, 'YXZ');
        const entry: CritterDebugEntry = {
          id: critter.id,
          mode: behaviourRef.current.mode,
          pos: [positionRef.current.x, positionRef.current.y, positionRef.current.z],
          speed: isMoving(mode) ? CRAWL_SPEED : 0,
          yawDeg: (scratchYawEuler.y * 180) / Math.PI,
          // Matches `heading.ts`'s convention (euler built as
          // `(-pitch, yaw, 0, 'YXZ')`), so a snail row's map tick points
          // the same way a fish row's does for the same forward vector.
          pitchDeg: (-scratchYawEuler.x * 180) / Math.PI,
          hue: critter.hue,
        };
        void emitCritterDebug({
          entries: [entry],
          simSeconds,
          isNight: isNightPresentation(dayNightOverride, simNight),
        });
      }
    }
  });

  return (
    <RigidBody
      ref={rigidBodyRef}
      type="kinematicPosition"
      position={[positionRef.current.x, positionRef.current.y, positionRef.current.z]}
      quaternion={[
        quaternionRef.current.x,
        quaternionRef.current.y,
        quaternionRef.current.z,
        quaternionRef.current.w,
      ]}
      colliders={false}
      userData={{ kind: 'snail', critterId: critter.id }}
      onCollisionEnter={(event: CollisionEnterPayload) => {
        if (isFishRigidBody(event.other.rigidBody?.userData)) {
          fishContactRequestRef.current = true;
        }
      }}
    >
      <CuboidCollider args={[he.x, he.y, he.z]} position={[0, he.centreOffsetY, 0]} />
      <group
        // Both models are authored facing `+X` (`snailGeometry.ts` mirrors
        // `fishGeometry.ts`'s convention) — see `quaternionFromFrame`'s own
        // doc comment above for why this rotation exists.
        rotation={[0, -Math.PI / 2, 0]}
        onClick={(e) => {
          e.stopPropagation();
          e.nativeEvent.stopPropagation();
          startleRequestRef.current = true;
          void selectCritter(critter.id);
        }}
      >
        <SnailModel critter={critter} tuckProgress={tuckProgress} tuckMode={tuckMode} />
      </group>
    </RigidBody>
  );
}
