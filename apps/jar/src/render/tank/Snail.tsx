// One snail: a self-contained controller, not a generalized `SteeringSystem`
// participant — no Yuka vehicle, no steering-registry entry
// (`docs/architecture/3d-engine.md` §4.4's settled architecture: the
// accepted cost is that fish won't separation-steer around a snail, but the
// kinematic collider below still keeps them from overlapping one). It owns
// a `CrawlSpine` (`crawlSpine.ts`) directly, advances its head in `useFrame`,
// samples it at the shell seat and every foot bone's own offset, and
// converts those into a script-authored position/rotation on a
// **kinematic** Rapier `RigidBody` (the root) plus a driven bone chain (the
// bend) — the same "no gravity fight" discipline as `Fish.tsx`'s dynamic
// one, just without physics ever moving it. Presents `SnailModel`, driving
// its `tuckProgress`/`tuckMode` from `snailBehaviour.ts`'s state machine.
// Also publishes its own telemetry into `domain/critterDebug.ts` (the Tank
// monitor window's bridge), gated by the same dev toggle as the fish's own
// publisher in `SteeringSystem.tsx`.
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
  advanceSpine,
  createSpine,
  resetSpine,
  sampleSpine,
  type CrawlSpine,
  type SpineSample,
} from '../environment/crawlSpine';
import {
  dropToFloor,
  EDGE_AVOIDANCE_RADIUS,
  FILLET_RADIUS,
  poseToWorld,
  randomFloorPose,
  roundedNormalAt,
  unlinkedEdgeAvoidanceBias,
  type CrawlFrame,
  type CrawlPose,
} from '../environment/crawlSurfaces';
import { SnailModel, type SnailGait } from '../models/SnailModel';
import {
  FOOT_BONE_XS,
  FOOT_TAIL_TIP_X,
  FOOT_TOE_X,
  SHELL_SEAT_X,
  SNAIL_BODY_SCALE,
  SOLE_Y,
  SVG_SCALE,
} from '../models/snailGeometry';
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

/** How strongly `unlinkedEdgeAvoidanceBias`'s own (already 0-to-1-weighted)
 * signal steers a wandering snail back toward its face's centre as it
 * nears a genuine dead end (a wall's rim, the lintel's un-linked
 * underside) — the softer alternative to `advance()`'s hard clamp-and-
 * reflect bounce, which still applies as the backstop if a snail reaches
 * the edge anyway. Tune by eye. */
const EDGE_AVOIDANCE_TURN_RATE = 1.5;

/** `crawlSpine.ts`'s crumb spacing, expressed as a fraction of the body's
 * own length rather than a fixed world-unit constant — this keeps the
 * spine's resolution (crumbs per body length) consistent across life
 * stages, since a fry's whole body is much shorter than an adult's. */
const CRUMB_SAMPLES_PER_BODY = 24;

/** The gait's own angular rate (radians/sec while genuinely crawling) —
 * reuses the exact cadence the foot ripple already shipped with (its own
 * `FOOT_RIPPLE_SPEED`), so retiring that wall-clock-driven oscillation for
 * this gated, shared one doesn't change how fast the ripple itself looks,
 * only *when* it plays (now genuinely tied to crawling, not free-running
 * — issue #112's own coupling: one clock for the ripple, the speed pulse,
 * and the spine's own sampling wave, so they read as one gait rather than
 * three animations that happen to share a rate). */
const GAIT_ANGULAR_RATE = 1.4;

/** How much the crawl speed itself pulses with the gait — a real gastropod
 * surges during a pedal wave's push phase; ±35% around `CRAWL_SPEED`,
 * exaggerated for legibility like every other snail-motion constant. */
const GAIT_PULSE_AMPLITUDE = 0.35;

/** How quickly the body's *effective* speed (what squash-and-stretch
 * actually reacts to) catches up to its target — low enough that starting
 * or stopping takes a visible fraction of a second to settle, which is
 * exactly the lag squash-and-stretch is meant to dramatize. */
const SPEED_SMOOTH_RATE = 4;

/** Converts the smoothed speed's own frame-to-frame *change* (world units
 * / sec²) into a stretch fraction — tune by eye alongside `MAX_STRETCH`. */
const STRETCH_RESPONSE = 0.15;
const MAX_STRETCH = 0.35;

/** The spine-sampling "accordion" wave: each bone/seat offset is nudged
 * along the body by a small amount, oscillating with the same gait phase,
 * so the body visibly bunches and spreads as the pedal wave passes through
 * — not just a speed pulse, an actual compression wave along its length.
 * Amplitude is expressed as a multiple of the spine's own crumb spacing
 * (never asking `sampleSpine` for finer detail than the trail actually
 * records) rather than a fixed world-unit constant, matching
 * `CRUMB_SAMPLES_PER_BODY`'s own "scale with the body, not a magic
 * number" reasoning. Wavelength is a fraction of the body's own length —
 * half a body per cycle reads as one clear compression, not a busy ripple. */
const ACCORDION_AMPLITUDE_CRUMB_MULTIPLE = 1.5;
const ACCORDION_WAVELENGTH_BODY_FRACTION = 0.5;

/** The fixed `-90°` yaw `Fish.tsx`'s model group already applies to its own
 * mesh (both models are authored facing `+X`), as a quaternion rather than
 * an Euler — `updateFootBones` needs its *inverse* to undo that yaw when
 * projecting a bone's world-space surface frame back into the model's own
 * (pre-yaw) local space. A module-level constant: the yaw never changes
 * per-snail or per-frame. */
const MODEL_YAW_QUAT_INV = new THREE.Quaternion()
  .setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0))
  .invert();

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

/** `forward`→local `+Z`, `up`→local `+Y` — the same axis convention
 * `fishCollider.ts` and `Fish.tsx` use, so this component's inner model
 * group needs the identical `-90°` yaw correction `Fish.tsx` applies (both
 * models are authored facing `+X`). `xAxis` (local `+X`) is derived as
 * `up × forward` rather than reusing a face's own `right` directly, since
 * that's the assignment that keeps (`forward`, `up`, `xAxis`) a proper
 * right-handed basis under this module's `(x, y, z)` axis order. Shared by
 * every quaternion this file builds from a surface frame — the root's own
 * (via `quaternionFromFrame`) and every bone's (via `updateFootBones`). */
function basisQuaternionFromVectors(forward: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
  const xAxis = new THREE.Vector3().crossVectors(up, forward).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(xAxis, up, forward),
  );
}

function quaternionFromFrame(frame: CrawlFrame): THREE.Quaternion {
  return basisQuaternionFromVectors(
    new THREE.Vector3(frame.forward.x, frame.forward.y, frame.forward.z),
    new THREE.Vector3(frame.up.x, frame.up.y, frame.up.z),
  );
}

/** The RigidBody's own root sits above the sole by `-SOLE_Y * scale` along
 * `up` (`SOLE_Y` is negative, in `snailGeometry.ts`'s raw-SVG-derived
 * convention), and offset by `-SHELL_SEAT_X * scale` along `forward` — an
 * approximation of "where the shell's seat would be," good enough for the
 * detach/float-down animation's own target pose (a single instantaneous
 * `CrawlPose`, not the spine). The main crawl loop no longer uses this: once
 * a real spine exists, the seat's true position comes from sampling it
 * directly (the `seatOffset`-based `sampleSpine` call in the main
 * `useFrame` below) rather than approximating it off a single pose.
 * `forward`, not `xAxis`: `SHELL_SEAT_X` is a distance along the model's own
 * authored toe-tail axis, and the fixed `-90°` yaw the inner model group
 * applies (`quaternionFromFrame`'s own doc comment) is exactly what maps
 * that axis onto the RigidBody's `forward` (local `+Z`), not onto `xAxis`
 * (local `+X`, the model's *thickness* axis once yawed) — using `xAxis`
 * here shifted the root sideways instead of back toward the tail, a bug
 * caught during this stack's own code-review pass. */
function rootPositionFromFrame(frame: CrawlFrame, scale: number): THREE.Vector3 {
  const up = new THREE.Vector3(frame.up.x, frame.up.y, frame.up.z);
  const forward = new THREE.Vector3(frame.forward.x, frame.forward.y, frame.forward.z);
  return new THREE.Vector3(frame.position.x, frame.position.y, frame.position.z)
    .addScaledVector(up, -SOLE_Y * scale)
    .addScaledVector(forward, -SHELL_SEAT_X * scale);
}

/** A world-space position plus the surface frame (`up`/`forward`) at one
 * point along the spine — `up` from `roundedNormalAt` (the continuous,
 * crease-aware field, exactly as the rigid-body root already used), but
 * `forward` from a *central difference* of neighbouring spine samples'
 * positions rather than any single sample's own stored heading: a chord
 * direction along the body's actual travelled path is what makes adjacent
 * segments bend to follow a turn, not just a fold (`docs/architecture/
 * 3d-engine.md` §4.4's own note on why a spine beats back-tracing alone).
 * Re-orthonormalized against `up` (Gram-Schmidt, the same idea
 * `crawlSurfaces.ts`'s own `poseToWorldRounded` used before the spine
 * existed) since a raw chord isn't generally perpendicular to a *rounded*
 * up near a fold. */
interface SampledFrame {
  position: THREE.Vector3;
  up: THREE.Vector3;
  forward: THREE.Vector3;
}

const FALLBACK_TANGENTS = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)];

function sampledFrameAt(samples: SpineSample[], index: number): SampledFrame {
  const sample = samples[index]!;
  const position = new THREE.Vector3(sample.position.x, sample.position.y, sample.position.z);
  const normal = roundedNormalAt(sample.faceId, sample.u, sample.v, FILLET_RADIUS);
  const up = new THREE.Vector3(normal.x, normal.y, normal.z);

  // `samples` is sorted ascending by offset-behind-head, so `prev` (a
  // smaller index) is the more head-ward neighbour and `next` (a larger
  // index) is the more tail-ward one — `forward` (the direction of travel)
  // points from tail-ward to head-ward, i.e. always `(the more head-ward
  // point) - (the more tail-ward point)`.
  const prev = samples[index - 1];
  const next = samples[index + 1];
  const tangent = new THREE.Vector3();
  if (prev && next) {
    tangent.set(
      prev.position.x - next.position.x,
      prev.position.y - next.position.y,
      prev.position.z - next.position.z,
    );
  } else if (next) {
    tangent.set(
      sample.position.x - next.position.x,
      sample.position.y - next.position.y,
      sample.position.z - next.position.z,
    );
  } else if (prev) {
    tangent.set(
      prev.position.x - sample.position.x,
      prev.position.y - sample.position.y,
      prev.position.z - sample.position.z,
    );
  }

  // Degenerate only when every recorded sample coincides exactly (a
  // just-spawned or just-landed snail that hasn't moved at all yet) — any
  // vector perpendicular to `up` is a fine placeholder until real spacing
  // develops, so try two fixed candidates rather than propagating NaN.
  let rejected = tangent.clone().sub(up.clone().multiplyScalar(tangent.dot(up)));
  if (rejected.lengthSq() < 1e-12) {
    for (const fallback of FALLBACK_TANGENTS) {
      rejected = fallback.clone().sub(up.clone().multiplyScalar(fallback.dot(up)));
      if (rejected.lengthSq() >= 1e-12) break;
    }
  }
  return { position, up, forward: rejected.normalize() };
}

/** Drives `bones` (tail-most first, matching `snailGeometry.ts`'s
 * `FOOT_BONE_XS` order) toward `frames` (one per bone, same order) —
 * each bone's own rotation is *parent-relative*, so a world-space desired
 * orientation has to be divided out one link at a time down the chain.
 * Rather than juggling that division in true world space (which would also
 * need to account for the fixed model yaw and the RigidBody's own current
 * orientation), every frame is first projected into the model's own
 * pre-yaw local space via `rootQuatInv`/`MODEL_YAW_QUAT_INV` — once there,
 * bone 0's local rotation *is* its projected orientation directly (its
 * parent, `footGroupRef`, carries no rotation of its own), and each
 * following bone's local rotation is simply the previous bone's projected
 * orientation "divided out" of its own. */
function updateFootBones(
  bones: THREE.Bone[],
  frames: SampledFrame[],
  rootQuatInv: THREE.Quaternion,
): void {
  let previousLocal: THREE.Quaternion | null = null;
  for (let i = 0; i < bones.length; i++) {
    const frame = frames[i]!;
    const localForward = frame.forward
      .clone()
      .applyQuaternion(rootQuatInv)
      .applyQuaternion(MODEL_YAW_QUAT_INV);
    const localUp = frame.up
      .clone()
      .applyQuaternion(rootQuatInv)
      .applyQuaternion(MODEL_YAW_QUAT_INV);
    const local = basisQuaternionFromVectors(localForward, localUp);
    if (previousLocal) {
      bones[i]!.quaternion.copy(previousLocal).invert().multiply(local);
    } else {
      bones[i]!.quaternion.copy(local);
    }
    previousLocal = local;
  }
}

/** The rigid root's own world position: `frame.position` (already the
 * *exact* on-surface point, whether it came from a single rounded pose or
 * — now — a spine sample) lifted along `frame.up` by `-SOLE_Y * scale`, so
 * the foot's sole (not the model's local origin) is what actually touches
 * the surface. */
function liftedRootPosition(frame: SampledFrame, scale: number): THREE.Vector3 {
  return frame.position.clone().addScaledVector(frame.up, -SOLE_Y * scale);
}

interface RootAndBoneFrames {
  rootFrame: SampledFrame;
  boneFrames: SampledFrame[];
}

/** Samples the spine once for the seat (the RigidBody's own root) and every
 * bone offset together, sorted into one combined arc-length query — so each
 * point's `sampledFrameAt` tangent comes from its own true neighbours along
 * the body, not just whichever *other* point happens to share its fixed
 * role. `boneOffsets`/`seatOffset` are arc-length distances behind the
 * spine's head (the toe/head bone), all non-negative by construction —
 * `FOOT_TOE_X` is itself the head bone's own offset, exactly `0`. */
function computeRootAndBoneFrames(
  spine: CrawlSpine,
  boneOffsets: number[],
  seatOffset: number,
): RootAndBoneFrames {
  const roles: Array<'seat' | number> = ['seat', ...boneOffsets.map((_, i) => i)];
  const offsets = [seatOffset, ...boneOffsets];
  const order = roles.map((_, i) => i).sort((a, b) => offsets[a]! - offsets[b]!);

  const samples = sampleSpine(
    spine,
    order.map((i) => offsets[i]!),
  );
  const framesByOrder = samples.map((_, sortedIndex) => sampledFrameAt(samples, sortedIndex));

  let rootFrame: SampledFrame | null = null;
  const boneFrames: SampledFrame[] = new Array(boneOffsets.length);
  order.forEach((originalIndex, sortedIndex) => {
    const role = roles[originalIndex]!;
    if (role === 'seat') rootFrame = framesByOrder[sortedIndex]!;
    else boneFrames[role] = framesByOrder[sortedIndex]!;
  });
  return { rootFrame: rootFrame!, boneFrames };
}

/** Nudges a spine-sampling offset along the body by a small amount that
 * oscillates with the shared gait phase — the "accordion" compression wave:
 * every bone (and the seat) bunches toward the head and spreads back out
 * again as the wave passes through, on top of whatever the bend itself is
 * already doing. Purely a query-time perturbation of which arc length gets
 * sampled — `sampleSpine` already clamps gracefully at either end of the
 * recorded trail, so a perturbation pushing an offset slightly negative or
 * past the oldest crumb is harmless, not a new failure mode to guard. */
function withAccordionWave(offset: number, phase: number, k: number, amplitude: number): number {
  return offset + amplitude * Math.sin(offset * k - phase);
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

  // Arc-length offsets behind the spine's own head (the toe/head bone,
  // whose own offset is trivially `0`) — recomputed fresh each render, the
  // same "cheap enough not to bother memoizing" treatment `scale`/`he`
  // already get, since `FOOT_BONE_XS` is a fixed 9-entry array.
  const bodyLength = (FOOT_TOE_X - FOOT_TAIL_TIP_X) * scale;
  const crumbSpacing = bodyLength / CRUMB_SAMPLES_PER_BODY;
  const seatOffset = (FOOT_TOE_X - SHELL_SEAT_X) * scale;
  const boneOffsets = FOOT_BONE_XS.map((x) => (FOOT_TOE_X - x) * scale);
  const accordionAmplitude = crumbSpacing * ACCORDION_AMPLITUDE_CRUMB_MULTIPLE;
  const accordionK = (2 * Math.PI) / (bodyLength * ACCORDION_WAVELENGTH_BODY_FRACTION);

  // The bone chain itself lives inside `SnailModel`, which hands it up via
  // `onBonesReady` once created — a ref, not React state, since this
  // component mutates the bones' rotations imperatively every frame rather
  // than re-rendering to change them.
  const footBonesRef = useRef<THREE.Bone[] | null>(null);

  // The shared gait clock + its own derived stretch, handed to `SnailModel`
  // as a live ref rather than changing props (the same rationale as
  // `footBonesRef` above) so the foot ripple and squash-and-stretch can
  // read this component's own per-frame state without a re-render.
  const gaitRef = useRef<SnailGait>({ phase: 0, stretch: 0 });
  const smoothedSpeedRef = useRef(0);

  // Spawn once at mount, mutated in place every frame thereafter — this
  // spine drives an imperative kinematic body transform (and, now, a bone
  // chain), not a render, so it lives in a ref rather than React state
  // (same rationale as `Fish.tsx`'s `currentHeadingRef`). The spine's own
  // head tracks the crawler's *leading* point (the toe), not the shell
  // seat — the seat, and every bone, are obtained by sampling the spine at
  // their own fixed offset behind that head (`computeRootAndBoneFrames`),
  // so every one of them is a real point the spine has actually recorded
  // reaching, never an extrapolation ahead of it.
  const spineRef = useRef<CrawlSpine>(
    createSpine(randomFloorPose(Math.random), bodyLength, crumbSpacing),
  );
  const initialFrames = computeRootAndBoneFrames(
    spineRef.current,
    boneOffsets.map((offset) =>
      withAccordionWave(offset, gaitRef.current.phase, accordionK, accordionAmplitude),
    ),
    withAccordionWave(seatOffset, gaitRef.current.phase, accordionK, accordionAmplitude),
  );
  const positionRef = useRef<THREE.Vector3>(liftedRootPosition(initialFrames.rootFrame, scale));
  const quaternionRef = useRef<THREE.Quaternion>(
    basisQuaternionFromVectors(initialFrames.rootFrame.forward, initialFrames.rootFrame.up),
  );

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
    const onFloor = spineRef.current.headPose.faceId === 'floor';
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
        // Re-seeds the whole spine around the landing spot rather than
        // carrying breadcrumbs over from wherever the snail detached —
        // `resetSpine`'s own back-trace lays the body out correctly around
        // `landed` immediately, with no warm-up pop.
        resetSpine(spineRef.current, detachAnchorRef.current.landed);
        detachAnchorRef.current = null;
      }

      // The gait phase only advances while genuinely crawling — it's what
      // gates the foot ripple to actual movement instead of free-running
      // off wall-clock time, per issue #112's own "one shared clock for the
      // ripple, the speed pulse, and the spine's own sampling wave" design.
      if (isMoving(mode)) {
        gaitRef.current.phase += GAIT_ANGULAR_RATE * delta;
      }
      const pulseMultiplier = 1 + GAIT_PULSE_AMPLITUDE * Math.sin(gaitRef.current.phase);

      if (isMoving(mode)) {
        headingBiasRef.current = THREE.MathUtils.clamp(
          headingBiasRef.current + (Math.random() - 0.5) * HEADING_BIAS_JITTER * delta,
          -MAX_HEADING_BIAS,
          MAX_HEADING_BIAS,
        );
        const avoidance = unlinkedEdgeAvoidanceBias(
          spineRef.current.headPose,
          EDGE_AVOIDANCE_RADIUS,
        );
        advanceSpine(
          spineRef.current,
          CRAWL_SPEED * pulseMultiplier * delta,
          headingBiasRef.current * delta + avoidance * EDGE_AVOIDANCE_TURN_RATE * delta,
        );
      }

      // Squash-and-stretch: derived from the *smoothed* speed's own frame-
      // to-frame change rather than a hand-built spring — a first-order lag
      // chasing a step target already overshoots-then-settles on its own,
      // which is exactly the shape a start/stop stretch/squash wants, with
      // no separate oscillator to tune.
      const targetSpeed = isMoving(mode) ? CRAWL_SPEED * pulseMultiplier : 0;
      const previousSmoothedSpeed = smoothedSpeedRef.current;
      smoothedSpeedRef.current +=
        (targetSpeed - smoothedSpeedRef.current) * (1 - Math.exp(-SPEED_SMOOTH_RATE * delta));
      const acceleration =
        delta > 0 ? (smoothedSpeedRef.current - previousSmoothedSpeed) / delta : 0;
      gaitRef.current.stretch = THREE.MathUtils.clamp(
        acceleration * STRETCH_RESPONSE,
        -MAX_STRETCH,
        MAX_STRETCH,
      );

      // Runs every frame regardless of `isMoving` — a paused/sealed snail's
      // spine hasn't changed, so this just re-derives the same frames it
      // already had, but skipping it would mean a special-cased "first
      // frame after a mode change" resync that isn't worth the complexity
      // at this population scale.
      const { rootFrame, boneFrames } = computeRootAndBoneFrames(
        spineRef.current,
        boneOffsets.map((offset) =>
          withAccordionWave(offset, gaitRef.current.phase, accordionK, accordionAmplitude),
        ),
        withAccordionWave(seatOffset, gaitRef.current.phase, accordionK, accordionAmplitude),
      );
      quaternionRef.current.copy(basisQuaternionFromVectors(rootFrame.forward, rootFrame.up));
      positionRef.current.copy(liftedRootPosition(rootFrame, scale));

      const bones = footBonesRef.current;
      if (bones) {
        updateFootBones(bones, boneFrames, quaternionRef.current.clone().invert());
      }
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
          speed: isMoving(mode)
            ? CRAWL_SPEED * (1 + GAIT_PULSE_AMPLITUDE * Math.sin(gaitRef.current.phase))
            : 0,
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
      <CuboidCollider
        args={[he.x, he.y, he.z]}
        position={[0, he.centreOffsetY, he.centreOffsetZ]}
      />
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
        <SnailModel
          critter={critter}
          tuckProgress={tuckProgress}
          tuckMode={tuckMode}
          gaitRef={gaitRef}
          onBonesReady={(bones) => {
            footBonesRef.current = bones;
          }}
        />
      </group>
    </RigidBody>
  );
}
