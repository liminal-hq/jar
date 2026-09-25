// Runs the three-phase steering/physics sync once per frame for every
// registered fish, per `docs/architecture/3d-engine.md` §3's per-frame
// order: read the RigidBody's actual position into the Yuka vehicle (so
// steering always reasons from ground truth) -> advance the shared
// `entityManager` (computes neighbours for separation, then each vehicle's
// steering behaviours) -> apply the resulting desired velocity to the
// RigidBody as an impulse, with heading set from the same vector.
//
// Deliberately *one* `useFrame` call for all fish, with no render-priority
// argument: `@react-three/fiber` v8 hands rendering control to userland the
// moment any `useFrame` callback passes a priority, which this scaffold
// has no reason to opt into — a per-fish `useFrame` for this phase ordering
// would require exactly that, which is why fish register into this
// system's registry instead of driving their own frame loop for it.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useFrame } from '@react-three/fiber';
import type { RapierRigidBody } from '@react-three/rapier';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type * as YUKA from 'yuka';

import { publishFishPositions } from '../../domain/debugChannel';
import { isNightPresentation } from '../../domain/dayNight';
import {
  useDayNightOverride,
  useFishEyeEnabled,
  useFishMonitorEnabled,
  useFishPositionOverlayEnabled,
} from '../../domain/devSettings';
import { emitFishDebug, type FishDebugEntry } from '../../domain/fishDebug';
import { emitFishPoses, type FishPoseEntry } from '../../domain/fishPose';
import { useJarStore } from '../../domain/jarClient';
import { entityManager } from './entityManager';
import {
  computePilotTargetHeading,
  computeTargetHeading,
  extractYaw,
  HEADING_COMMIT_SPEED,
  HEADING_RELEASE_SPEED,
} from './heading';
import { PILOTED_MAX_FORCE } from './manualPilotBehaviour';
import { isSelfPropelledMode, type FishMotionMode } from './motionState';
import { advancePilotYaw, getPilotYaw, isActivelyPiloted, seedPilotYaw } from './pilotInputState';
import { MAX_STEERING_FORCE } from './useFishSteering';

/** Extra per-fish detail only `FishModel.tsx` knows (its own animation
 * state) — optional because the standalone critter-card preview drives a
 * `FishModel` with no steering registration at all. */
export interface FishDebugAnim {
  /** A fast-decaying peak hold, not the instantaneous value — a genuine
   * one/two-frame spike would otherwise be invisible between the fish
   * monitor's ~5Hz polls (`FishModel.tsx`'s own comment on `peakTurnRateRef`). */
  turnRate: number;
  isResting: boolean;
  activeAmplitude: number;
  /** The tail beat's current accumulated phase (`FishModel.tsx`'s
   * `phaseRef`) — not just monitor telemetry, this also feeds `Fish.tsx`'s
   * `getThrustEnvelope` (`thrustEnvelope.ts`), which gates the physics
   * impulse below to the same beat. */
  phase: number;
}

export interface RegisteredFish {
  vehicle: YUKA.Vehicle;
  getBody: () => RapierRigidBody | null;
  maxSpeed: () => number;
  getMode: () => FishMotionMode;
  /** Slerped toward `targetHeading` each frame rather than snapped, so
   * turns visibly "swim through" instead of teleporting — seeded from the
   * body's actual rotation at registration time (`Fish.tsx`). Also the
   * live-yaw source for `tankContainmentBehaviour.ts`/
   * `castleAvoidanceBehaviour.ts`'s anticipatory margins: `Fish.tsx` hands
   * this exact object to a `currentHeadingRef` its own `getYaw` closure
   * reads from, so mutating it in place below (`.slerp()`) is what keeps
   * that live, with no extra wiring. */
  currentHeading: THREE.Quaternion;
  targetHeading: THREE.Quaternion;
  /** Hysteresis state for `computeTargetHeading`'s commit/release threshold
   * pair (`heading.ts`) — whether this fish is currently trusting its
   * instantaneous velocity for a fresh heading, versus holding the last one
   * through a low-speed wobble. Starts `false`: a freshly-spawned fish
   * holds its seeded heading until it's genuinely underway. */
  isHeadingActive: boolean;
  /** Feeds the fish monitor window (`windows/FishMonitor/FishMonitorWindow.tsx`)
   * — absent for a `FishModel` with no steering mode of its own. */
  getDebugAnim?: () => FishDebugAnim | null;
  /** `Critter.hue`, 0-360 — never changes after spawn, so a plain field
   * rather than a getter. Feeds the fish monitor window's map. */
  hue: number;
  /** `fishCollider.ts`'s `colliderHalfExtentsFor(critter).z` — this fish's
   * current *length* (forward/nose-to-tail) half-extent, numerically
   * identical to what the old spherical collider's own radius was. A
   * getter, not a plain field, since it scales with life-stage and so
   * changes as the fish grows. Its two consumers — another fish's
   * chase-catch check (`Fish.tsx`) and the fish-eye camera's forward
   * offset (`domain/fishPose.ts`) — both deliberately want this
   * conservative, worst-orientation scalar, not a heading-projected one. */
  getColliderRadius: () => number;
  /** `thrustMultiplierFor` (`thrustEnvelope.ts`) evaluated at this fish's
   * current tail phase — gates the impulse below so thrust arrives on the
   * power stroke and the fish coasts between beats, rather than tracking
   * its desired velocity continuously. */
  getThrustEnvelope: () => number;
}

type Registry = Map<number, RegisteredFish>;

const SteeringRegistryContext = createContext<Registry | null>(null);

export function useSteeringRegistry(): Registry {
  const registry = useContext(SteeringRegistryContext);
  if (!registry) throw new Error('useSteeringRegistry must be used inside <SteeringSystem>');
  return registry;
}

/** A permanently-empty registry provider — for a view-only scene that needs
 * to satisfy `useSteeringRegistry`'s context requirement (`Plants.tsx`
 * reads it to find the nearest fish to sway away from) without actually
 * running the tank's real per-frame steering/physics sync or its telemetry
 * publishers (`windows/FishEye/FishEyeScene.tsx`: mounting a real
 * `<SteeringSystem>` there instead would start a second, always-empty
 * publisher racing the tank's own real one on the exact same event
 * channels). An empty registry is a completely safe substitute for
 * `Plants.tsx`'s specific use — "no fish nearby" for every blade, same as
 * a real tank with zero fish in it, and this window never registers real
 * fish here regardless. */
export function EmptySteeringRegistry({ children }: { children: ReactNode }) {
  const emptyRegistry = useRef<Registry>(new Map()).current;
  return (
    <SteeringRegistryContext.Provider value={emptyRegistry}>
      {children}
    </SteeringRegistryContext.Provider>
  );
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
 * `linearDamping` instead of fighting it.
 *
 * This is a first-order lag — `1/VELOCITY_GAIN` is the time constant to
 * close ~63% of the gap. At 0.6 that's ~1.7s, which barely mattered while
 * `desired` itself stayed roughly steady between wander-cycle updates, but
 * a moving ceiling (`steeringParams.ts`'s `breathingMultiplier`, a burst
 * ramp) keeps the *target* itself in motion too, so the body chronically
 * trails it — read live as "tail beating hard, barely accelerating." 2.2
 * (~0.45s) fixed that, but was still too weak relative to `linearDamping`
 * (2.5, `Fish.tsx`) once `desired`'s own *direction* is also constantly
 * shifting (`WanderBehavior`'s per-update noise, amplified further by
 * containment/castle-avoidance's proximity-triggered corrections near a
 * wall) — live-diagnosed via a temporary registry/entity-manager
 * introspection hook: fish sitting near a wall margin had a Yuka-desired
 * speed pinned at `maxSpeed` while their real `RigidBody.linvel()` stayed
 * near zero for many seconds, `isResting` and all, because each frame's
 * correction was mostly re-aiming rather than building forward momentum a
 * damping term this strong could keep eating. 5 (~0.2s) gives the
 * controller enough authority to actually reach a healthy fraction of
 * `desired` against that damping even while the target keeps swinging —
 * confirmed live: freshly-spawned fish (a clean, obstruction-free case)
 * went straight to a normal cruise speed instead of the old value's slow
 * crawl. */
const VELOCITY_GAIN = 5;
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

/** Yuka never damps a vehicle's own velocity on its own — ramping a fish's
 * steering weights toward zero (`useFishSteering.ts`'s `setMode`/`rampWeights`)
 * leaves `vehicle.velocity` frozen at whatever it last was, forever, unless
 * something actively decays it. This is that decay for any fish that isn't
 * self-propelled right now (`motionState.ts`'s `isSelfPropelledMode` —
 * `active` and `chasing` are exempt); the velocity-matching impulse above
 * then brakes the body to match as the decayed target chases toward zero,
 * cooperating with `linearDamping` rather than leaving the body's own
 * momentum to bleed off unassisted. */
const NON_ACTIVE_VELOCITY_DECAY_RATE = 4;

/** How often the fish monitor snapshot publishes — a live table doesn't
 * need 60Hz, and publishing every frame would spam the Tauri event bridge
 * for no visible benefit. */
const DEBUG_PUBLISH_INTERVAL_SEC = 0.2;

/** How often the fish-eye window's pose snapshot publishes — smooth enough
 * to drive a camera (interpolated on the receiving end, `FishEyeScene.tsx`'s
 * own `POSE_PUBLISH_INTERVAL_MS`, derived from this rather than a second
 * hardcoded `1 / 30`) without publishing every single frame just to feed a
 * second window. Exported so the two stay a single source of truth. */
export const POSE_PUBLISH_INTERVAL_SEC = 1 / 30;

// Only the debug-telemetry publisher below still needs a raw Euler
// directly — it reads *both* yaw and pitch from one decomposition;
// everywhere else that only needs yaw uses `heading.ts`'s shared
// `extractYaw` instead.
const scratchYawEuler = new THREE.Euler();

interface SteeringSystemProps {
  children: ReactNode;
}

export function SteeringSystem({ children }: SteeringSystemProps) {
  const registryRef = useRef<Registry>(new Map());
  const monitorEnabled = useFishMonitorEnabled();
  const fishEyeEnabled = useFishEyeEnabled();
  const posePublishElapsedRef = useRef(0);
  const simSeconds = useJarStore((s) => s.simSeconds);
  // Authoritative — pushed by the sim core on every `TickUpdate`
  // (`jarClient.ts`'s `isNight` store field) rather than re-derived here,
  // so this can never disagree with what the core actually used for
  // energy/breeding eligibility this tick.
  const coreIsNight = useJarStore((s) => s.isNight);
  const dayNightOverride = useDayNightOverride();
  // `isNightPresentation`, not a hand-rolled auto/night ternary — that
  // pattern predates `'active'` (added by this same PR) and silently
  // reports "day" for it instead of the real clock state, since it only
  // ever compared against `'night'`. This is telemetry-only (the fish
  // monitor's status line), not read by any actual steering/sim logic.
  const effectiveIsNight = isNightPresentation(dayNightOverride, coreIsNight);
  const publishElapsedRef = useRef(0);

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
      // Widened while a key is genuinely held for this fish, so
      // `containment`/`castleAvoidance` can still claim their own full,
      // unclamped push (up to their own `STRENGTH`, 4) while leaving
      // `PILOT_STRENGTH`'s worth of budget still free for the player —
      // `manualPilotBehaviour.ts`'s `PILOTED_MAX_FORCE` comment has the
      // full reasoning (this used to stay at `MAX_STEERING_FORCE`
      // unconditionally, which live testing showed silently capped how
      // close a piloted fish could ever get to a wall). Reverted the
      // instant no key is held, so an idle piloted fish is indistinguishable
      // from an unpiloted one.
      const piloted = isActivelyPiloted(id);
      fish.vehicle.maxForce = piloted ? PILOTED_MAX_FORCE : MAX_STEERING_FORCE;
      // Seeded from this fish's own *rendered* heading the first frame
      // piloting engages (never mid-drive — `pilotYaw` stays seeded across
      // frames until the key set empties, `pilotInputState.ts`), so there's
      // no visible snap the instant a key is first pressed. Advanced here,
      // not in `ManualPilotBehaviour.calculate()` — see that file's own
      // comment for why turning would silently stall some frames if it
      // depended on that call happening.
      if (piloted) {
        if (getPilotYaw() === null) {
          seedPilotYaw(extractYaw(fish.currentHeading));
        }
        advancePilotYaw(delta);
      }
      if (debugPositions) debugPositions[id] = { x: t.x, y: t.y, z: t.z };
    }
    if (debugPositions) {
      lastPublishRef.current = state.clock.elapsedTime;
      publishFishPositions(debugPositions);
    }

    entityManager.update(delta);

    for (const [id, fish] of registry.entries()) {
      const body = fish.getBody();
      if (!body) continue;

      // Skipped for a fish actively under manual pilot input
      // (`render/steering/pilotInputState.ts`) even in a non-self-propelled
      // mode — this decay would otherwise fight the player's held key every
      // frame (equilibrium speed capped well below the fish's real
      // `maxSpeed`), which only matters if the daytime roll or night
      // settling flips a piloted fish out of `active` mid-drive. Checked
      // per fish, not per mode: the moment keys release, `isActivelyPiloted`
      // goes false and this fish's own mode machinery resumes untouched.
      if (!isSelfPropelledMode(fish.getMode()) && !isActivelyPiloted(id)) {
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
        // `getThrustEnvelope()`'s own mean-normalization only guarantees
        // this multiplier's time-average is 1 — it does not, on its own,
        // guarantee the resulting body motion's mean speed matches the
        // unpulsed controller. This is a closed-loop correction (∝ the
        // instantaneous `desired − actual` error), not an open-loop force:
        // pulsing it correlates the multiplier with the error itself under
        // `linearDamping`, so `E[multiplier] = 1` doesn't imply the same
        // mean impulse, and thus not the same cruise/arrival/chase-catch
        // timing either. The true compensation, if this drifts noticeably
        // in practice, is frequency-dependent (how fast the pulse cycles
        // relative to `linearDamping`'s own timescale, which itself varies
        // continuously with the fish's current tail-beat frequency) — not
        // a single constant derivable here. Retune `VELOCITY_GAIN` by eye
        // against real cruise/arrival timing if it's needed, rather than
        // trying to correct it through the envelope's own math.
        scratchImpulse.copy(scratchVelocity).sub(scratchLinvel);
        // The largest impulse that can ever be *correct*: exactly enough to
        // close the velocity error in one step (`mass * |error|` — Rapier
        // converts impulse to a velocity change via `/mass` internally, so
        // this is the impulse magnitude at which `Δv == error`). Computed
        // before scaling by `VELOCITY_GAIN * delta * thrustEnvelope()`,
        // which on a throttled frame (the tank window resumes from
        // hidden/minimized with a large, if `clampClockDelta`-bounded,
        // `delta`) or at the thrust envelope's own peak (~2x mean) can
        // otherwise scale well past that point — for a light enough fish,
        // past the `Δv > 2 * error` threshold where this explicit
        // correction diverges instead of converging, flinging or
        // stutter-snapping it. Clamping the impulse's *length* to this
        // bound (direction untouched) still lets a large error close in a
        // single frame when the scaled term is smaller — it only stops the
        // correction from ever overshooting past fully matching `desired`.
        const maxImpulseMagnitude = body.mass() * scratchImpulse.length();
        scratchImpulse.multiplyScalar(VELOCITY_GAIN * delta * fish.getThrustEnvelope());
        if (scratchImpulse.length() > maxImpulseMagnitude) {
          scratchImpulse.setLength(maxImpulseMagnitude);
        }
        body.applyImpulse(scratchImpulse, true);
      }

      // Hoisted out of the impulse-application gate above: a piloted fish
      // turning in place (`KeyA`/`KeyD`, no `KeyW`/`KeyS`) has near-zero
      // velocity, which `computeTargetHeading`'s own speed threshold would
      // read as "hold the last heading" rather than commit to — there's no
      // velocity to derive a turn from in the first place. A driven yaw
      // needs no such derivation, so it overrides the normal velocity-based
      // heading unconditionally while seeded, turn-in-place included; an
      // unpiloted (or idle-piloted) fish falls straight through to the
      // existing velocity-gated logic, completely unaffected.
      const pilotYaw = isActivelyPiloted(id) ? getPilotYaw() : null;
      if (pilotYaw !== null) {
        // `isHeadingActive` deliberately untouched here — it's the
        // commit/release hysteresis flag the *other* branch below uses, and
        // a driven yaw doesn't consult it at all while piloted. Stomping it
        // to `false` on every piloted frame used to discard whatever
        // hysteresis state was earned before piloting engaged, so the
        // instant a key released, the fish could land back in the `else`
        // branch requiring the higher `HEADING_COMMIT_SPEED` threshold to
        // re-engage instead of the lower `HEADING_RELEASE_SPEED` its actual
        // pre-pilot state called for — a momentary heading freeze right
        // after handing control back. Leaving it alone resumes exactly
        // where it left off.
        fish.targetHeading.copy(computePilotTargetHeading(pilotYaw, scratchVelocity));
      } else if (scratchVelocity.lengthSq() >= MIN_VELOCITY_SQ) {
        const threshold = fish.isHeadingActive ? HEADING_RELEASE_SPEED : HEADING_COMMIT_SPEED;
        const target = computeTargetHeading(scratchVelocity, threshold);
        fish.isHeadingActive = target !== null;
        if (target) fish.targetHeading.copy(target);
      }

      const slerpFactor = 1 - Math.exp(-HEADING_SLERP_RATE * delta);
      fish.currentHeading.slerp(fish.targetHeading, slerpFactor);
      body.setRotation(fish.currentHeading, true);
    }

    if (monitorEnabled) {
      publishElapsedRef.current += delta;
      if (publishElapsedRef.current >= DEBUG_PUBLISH_INTERVAL_SEC) {
        publishElapsedRef.current = 0;
        const entries: FishDebugEntry[] = [];
        for (const [id, fish] of registry) {
          const anim = fish.getDebugAnim?.() ?? null;
          scratchYawEuler.setFromQuaternion(fish.currentHeading, 'YXZ');
          // The fish's *actual* physical speed, not Yuka's internal steering
          // target (`fish.vehicle.getSpeed()`) — see `FishModel.tsx`'s
          // `getSpeed` doc comment for why those two can diverge. A monitor
          // meant for tuning against real numbers should show the real
          // number.
          const linvel = fish.getBody()?.linvel();
          const speed = linvel ? Math.hypot(linvel.x, linvel.y, linvel.z) : fish.vehicle.getSpeed();
          entries.push({
            id,
            mode: fish.getMode(),
            pos: [fish.vehicle.position.x, fish.vehicle.position.y, fish.vehicle.position.z],
            speed,
            yawDeg: (scratchYawEuler.y * 180) / Math.PI,
            // `heading.ts` builds the euler as `(-pitch, yaw, 0, 'YXZ')`.
            pitchDeg: (-scratchYawEuler.x * 180) / Math.PI,
            turnRate: anim?.turnRate ?? 0,
            isResting: anim?.isResting ?? false,
            hue: fish.hue,
          });
        }
        void emitFishDebug({ entries, simSeconds, isNight: effectiveIsNight });
      }
    }

    if (fishEyeEnabled) {
      posePublishElapsedRef.current += delta;
      if (posePublishElapsedRef.current >= POSE_PUBLISH_INTERVAL_SEC) {
        posePublishElapsedRef.current = 0;
        const poses: FishPoseEntry[] = [];
        for (const [id, fish] of registry) {
          poses.push({
            id,
            pos: [fish.vehicle.position.x, fish.vehicle.position.y, fish.vehicle.position.z],
            // Exactly this frame's rendered orientation — already slerped,
            // already includes a piloted fish's driven yaw — not
            // reconstructed from velocity, so the fish-eye window needs no
            // smoothing of its own beyond interpolating between snapshots.
            quat: [
              fish.currentHeading.x,
              fish.currentHeading.y,
              fish.currentHeading.z,
              fish.currentHeading.w,
            ],
            colliderRadius: fish.getColliderRadius(),
          });
        }
        void emitFishPoses({ poses, t: state.clock.elapsedTime });
      }
    }
  });

  return (
    <SteeringRegistryContext.Provider value={registryRef.current}>
      {children}
    </SteeringRegistryContext.Provider>
  );
}
