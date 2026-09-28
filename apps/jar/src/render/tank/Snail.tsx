// One snail: a self-contained controller, not a generalized `SteeringSystem`
// participant — no Yuka vehicle, no steering-registry entry
// (`docs/architecture/3d-engine.md` §4.4's settled architecture: the
// accepted cost is that fish won't separation-steer around a snail, though
// the kinematic collider below does stop a *fish* overlapping one — a
// dynamic-vs-kinematic pair Rapier's solver genuinely resolves. It resolves
// nothing between two kinematic bodies, so snails keep out of each other's
// way by steering instead, via `snailRegistry.ts`/`snailSeparation.ts`). It owns
// a `CrawlSpine` (`crawlSpine.ts`) directly, advances its head in `useFrame`,
// samples it at every foot bone's own gait-perturbed offset
// (`snailGaitOffsets.ts`), and converts those into a script-authored
// position/rotation on a **kinematic** Rapier `RigidBody` (the root, read off
// the foot itself) plus a driven bone chain (the bend) — the same "no gravity
// fight" discipline as `Fish.tsx`'s dynamic one, just without physics ever
// moving it. Presents `SnailModel`, driving its `tuckProgress`/`tuckMode` from
// `snailBehaviour.ts`'s state machine. Also publishes its own telemetry into
// `domain/critterDebug.ts` (the Tank monitor window's bridge), gated by the
// same dev toggle as the fish's own publisher in `SteeringSystem.tsx`.
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
import { useEffect, useRef, useState } from 'react';
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
  resizeSpine,
  sampleSpine,
  type CrawlSpine,
  type SpineSample,
} from '../environment/crawlSpine';
import {
  advance,
  dropToFloor,
  EDGE_AVOIDANCE_RADIUS,
  poseToWorld,
  randomFloorPose,
  unlinkedEdgeAvoidanceBias,
  type CrawlFrame,
  type CrawlPose,
  type Vec3,
} from '../environment/crawlSurfaces';
import { SnailModel, type SnailGait } from '../models/SnailModel';
import {
  basisQuaternionFromVectors,
  rootTransformFromFoot,
  updateFootBones,
  type SampledFrame,
} from '../models/snailFootRig';
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
import {
  accordionAmplitude,
  accordionWavenumber,
  gaitBoneOffsets,
  sampledBodyLength,
} from './snailGaitOffsets';
import { forgetSnailPosition, otherSnailPositions, publishSnailPosition } from './snailRegistry';
import {
  snailSeparationResponse,
  SNAIL_SEPARATION_RADIUS,
  SNAIL_SEPARATION_TURN_RATE,
} from './snailSeparation';

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
 * `CrawlPose`, not the spine). The main crawl loop no longer uses this: it
 * takes the seat off the foot's own bones instead
 * (`rootTransformFromFoot`), which is the only way the two can be
 * guaranteed to agree. A single detached pose has no foot to read, so the
 * approximation is exactly right here — and the landing reseed below lines
 * the spine up with it, so the two never disagree at the handover.
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

const FALLBACK_TANGENTS = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)];

/** One spine sample's own `SampledFrame` (`snailFootRig.ts`): `up` straight
 * from the sample's own `normal` (`crawlSpine.ts` interpolates the
 * crease-rounded field along the trail, rather than this re-evaluating it
 * at the snapped `faceId`/`u`/`v` — see `SpineSample.normal` for why that
 * distinction is the difference between a continuous body and one that
 * disagrees with itself about which way is up), and `forward` from a
 * *central difference*
 * of neighbouring spine samples' positions rather than any single sample's
 * own stored heading — a chord direction along the body's actual travelled
 * path is what makes adjacent segments bend to follow a turn, not just a
 * fold (`docs/architecture/3d-engine.md` §4.4's own note on why a spine
 * beats back-tracing alone). Re-orthonormalized against `up` (Gram-Schmidt,
 * the same idea `crawlSurfaces.ts`'s own `poseToWorldRounded` used before
 * the spine existed) since a raw chord isn't generally perpendicular to a
 * *rounded* up near a fold. */
function sampledFrameAt(samples: SpineSample[], index: number): SampledFrame {
  const sample = samples[index]!;
  const position = new THREE.Vector3(sample.position.x, sample.position.y, sample.position.z);
  const up = new THREE.Vector3(sample.normal.x, sample.normal.y, sample.normal.z);

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

/** Samples the spine at every bone offset in one combined arc-length query
 * — so each point's `sampledFrameAt` tangent comes from its own true
 * neighbours along the body. `boneOffsets` are arc-length distances behind
 * the spine's head; the toe/head bone's own unperturbed offset is exactly `0`,
 * and the gait's accordion wave (`snailGaitOffsets.ts`) can push it either side
 * of that. Either direction is safe here: `sampleSpine` clamps a query past
 * the head or past the oldest crumb rather than throwing, and
 * `sampledBodyLength` keeps the tail-ward side inside the recorded trail so
 * the clamp is never actually reached. The wave is also gentle enough never to
 * reorder two bones (`accordionKeepsBonesOrdered`), which is what lets the
 * sort below be a pure re-indexing rather than a change of who is whose
 * neighbour.
 *
 * The shell's seat is deliberately *not* among them any more: it rides the
 * foot's own bones instead (`rootTransformFromFoot`), which is what stops
 * the shell and the foot reading the surface independently and disagreeing
 * about it. */
function computeBoneFrames(spine: CrawlSpine, boneOffsets: number[]): SampledFrame[] {
  const order = boneOffsets.map((_, i) => i).sort((a, b) => boneOffsets[a]! - boneOffsets[b]!);
  const samples = sampleSpine(
    spine,
    order.map((i) => boneOffsets[i]!),
  );
  const boneFrames: SampledFrame[] = new Array(boneOffsets.length);
  order.forEach((originalIndex, sortedIndex) => {
    boneFrames[originalIndex] = sampledFrameAt(samples, sortedIndex);
  });
  return boneFrames;
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
  const accordionA = accordionAmplitude(crumbSpacing);
  const accordionK = accordionWavenumber(bodyLength);
  // The spine is sized to how deep the *gait* reaches, not to the body alone
  // — `snailGaitOffsets.ts`'s `sampledBodyLength` for why the difference is
  // the tail-most bone freezing for part of every cycle.
  const spineLength = sampledBodyLength(bodyLength, crumbSpacing);

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
  // seat — every bone is obtained by sampling the spine at its own fixed
  // offset behind that head (`computeBoneFrames`), so each one is a real
  // point the spine has actually recorded reaching, never an extrapolation
  // ahead of it; the seat then rides those bones rather than sampling for
  // itself (`rootTransformFromFoot`).
  //
  // The spawn search (`randomFloorPose` clears the castle) and the initial
  // bone sampling are not free, so a lazy `useState` initialiser runs them
  // once at mount instead of on every render.
  const [initial] = useState(() => {
    const spine = createSpine(randomFloorPose(Math.random), spineLength, crumbSpacing);
    const root = rootTransformFromFoot(
      computeBoneFrames(
        spine,
        gaitBoneOffsets(boneOffsets, gaitRef.current.phase, accordionK, accordionA),
      ),
      FOOT_BONE_XS,
      SHELL_SEAT_X,
      SOLE_Y,
      scale,
    );
    return { spine, root };
  });
  const spineRef = useRef<CrawlSpine>(initial.spine);
  const positionRef = useRef<THREE.Vector3>(initial.root.position);
  const quaternionRef = useRef<THREE.Quaternion>(initial.root.quaternion);

  const behaviourRef = useRef<SnailBehaviourState>(createInitialSnailBehaviour());
  const headingBiasRef = useRef(0);
  const startleRequestRef = useRef(false);
  const fishContactRequestRef = useRef(false);
  const detachAnchorRef = useRef<DetachAnchor | null>(null);

  // Reused every frame rather than reallocated — `otherSnailPositions`
  // truncates and refills it in place.
  const neighboursRef = useRef<Vec3[]>([]);
  useEffect(() => () => forgetSnailPosition(critter.id), [critter.id]);

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

    // A snail grows through its life stages, so the body sampling this spine
    // gets longer while the spine itself was sized at spawn — and a trail
    // shorter than what the body samples collapses every bone past its end
    // onto one point (see `resizeSpine`). Checked here rather than in an effect
    // because `scale` is a plain per-render derivation, not state anything
    // reacts to.
    resizeSpine(spineRef.current, spineLength, crumbSpacing);

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

      // Nothing touches the bones for the whole fall, deliberately: a bone's
      // *local* transform is exactly the body's own shape relative to the
      // root, so leaving the chain alone is what makes a falling snail one
      // rigid object — foot and shell travelling and rotating together by
      // construction, however far the root lerps and slerps on the way down.
      // Re-deriving the chain against the root's changing orientation
      // instead would pin the bend to *world* space while the root turned
      // underneath it, which is precisely a foot coming off its own shell.
    } else {
      if (prevMode === 'detached' && detachAnchorRef.current) {
        // Re-seeds the whole spine around the landing spot rather than
        // carrying breadcrumbs over from wherever the snail detached —
        // `resetSpine`'s own back-trace lays the body out correctly around
        // `landed` immediately, with no warm-up pop.
        //
        // `landed` is where the *seat* lands (that's what
        // `rootPositionFromFrame` placed the root against above), but a
        // spine's head is the **toe**, `seatOffset` further along the body —
        // so the head pose to re-seed from is `landed` advanced by exactly
        // that much. Seeding the head at `landed` itself instead put the toe
        // where the seat was meant to be, teleporting the whole snail a
        // `seatOffset` backwards on the first frame after touchdown.
        resetSpine(spineRef.current, advance(detachAnchorRef.current.landed, seatOffset));
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
      let speedScale = 1;

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
        // Measured at the head (the toe), not the root: it's the leading
        // end that runs into things, and it's the end steering can still
        // do something about.
        const head = poseToWorld(spineRef.current.headPose);
        const crowding = snailSeparationResponse(
          head,
          otherSnailPositions(critter.id, neighboursRef.current),
          SNAIL_SEPARATION_RADIUS,
        );
        speedScale = crowding.speedScale;
        advanceSpine(
          spineRef.current,
          CRAWL_SPEED * pulseMultiplier * speedScale * delta,
          headingBiasRef.current * delta +
            avoidance * EDGE_AVOIDANCE_TURN_RATE * delta +
            crowding.turn * SNAIL_SEPARATION_TURN_RATE * delta,
        );
      }

      // Squash-and-stretch: derived from the *smoothed* speed's own frame-
      // to-frame change rather than a hand-built spring — a first-order lag
      // chasing a step target already overshoots-then-settles on its own,
      // which is exactly the shape a start/stop stretch/squash wants, with
      // no separate oscillator to tune.
      // `speedScale` included on purpose: a snail easing off because
      // another is in its way should squash the same way one coming to a
      // stop of its own accord does.
      const targetSpeed = isMoving(mode) ? CRAWL_SPEED * pulseMultiplier * speedScale : 0;
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
      const boneFrames = computeBoneFrames(
        spineRef.current,
        gaitBoneOffsets(boneOffsets, gaitRef.current.phase, accordionK, accordionA),
      );

      // One derivation, one source: every bone sits on its own spine sample,
      // and the root — and so the rigid shell bolted to it — is the *foot's*
      // own frame at the seat, blended from the same two bones the skinned
      // mesh blends for a vertex there (`rootTransformFromFoot`). Neither
      // half reads the surface on its own account, so neither can disagree
      // with the other about it.
      const root = rootTransformFromFoot(boneFrames, FOOT_BONE_XS, SHELL_SEAT_X, SOLE_Y, scale);
      positionRef.current.copy(root.position);
      quaternionRef.current.copy(root.quaternion);

      const bones = footBonesRef.current;
      if (bones) {
        updateFootBones(bones, boneFrames, positionRef.current, quaternionRef.current, scale);
      }
    }

    body.setNextKinematicTranslation(positionRef.current);
    body.setNextKinematicRotation(quaternionRef.current);

    // Published every frame regardless of mode — a sealed or falling snail
    // is still something the others have to crawl around.
    publishSnailPosition(critter.id, poseToWorld(spineRef.current.headPose).position);

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
