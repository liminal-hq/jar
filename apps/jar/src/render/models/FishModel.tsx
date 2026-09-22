// Extruded vector fish model (`docs/architecture/3d-engine.md` §6) — the
// hand-authored SVG silhouettes in `fish-svg/` (parsed and cached once by
// `fishGeometry.ts`) stand in for the originally-envisioned rigged GLTF
// pipeline, giving Jar's flat-vector-art identity a genuinely fish-shaped
// model without needing a real asset pipeline or a bone rig. Implements
// hue-via-material-color and the belly gradient (§6.4), life-stage scale
// (§6.3), spot toggles, sex dimorphism (§6.7), and — for the first time —
// the `fin` gene actually changing which tail mesh a fish gets, rather
// than being tracked by the sim and never rendered.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type * as YUKA from 'yuka';

import type { Critter } from '../../domain/protocol/generated/Critter';
import { lifeStageScale } from '../../domain/simConstants';
import { burstOverdrive } from '../steering/chaseParams';
import type { FishMotionMode } from '../steering/motionState';
import { animationMulFor, maxSpeedFor } from '../steering/steeringParams';
import {
  BODY_DEPTH,
  createBodyGeometry,
  createVeilGeometry,
  MALE_TAIL_SCALE,
  MOUTH_HINGE,
  paintBellyGradient,
  PECTORAL_HINGE,
  SHARED_GEOMETRY,
  SVG_SCALE,
  TAIL_PIVOT,
  wrapInPivot,
} from './fishGeometry';
import { advanceTailPhase } from './tailPhase';
import { computeTurnRate } from './turnRate';

interface FishModelProps {
  critter: Critter;
  vehicle: YUKA.Vehicle;
  /** Holds the model at its rest pose instead of animating — for a passed
   * critter's memorial preview (`CritterPreview.tsx`), where a stopped fish
   * reads as "this is a picture of them," not "they're still swimming." */
  still?: boolean;
  /** The fish's current steering mode (`Fish.tsx`), read imperatively each
   * frame rather than as a reactive prop — mode changes shouldn't force a
   * re-render, only change what the existing `useFrame` loop does. Absent
   * for the standalone critter-card preview (`CritterPreview.tsx`), which
   * has no steering mode of its own — treated as always `'active'` there. */
  getMode?: () => FishMotionMode;
  /** This fish's *actual* physical speed (the Rapier `RigidBody`'s real
   * `linvel()` magnitude), read imperatively each frame — same rationale as
   * `getMode`. Defaults to `vehicle.getSpeed()` (Yuka's internal steering
   * *target*, not what the body is really doing) when absent, preserving
   * the critter-card preview's behaviour (no physics body of its own).
   *
   * The two diverge because `SteeringSystem.tsx` applies the desired
   * velocity to the body as a *damped, gain-limited impulse* rather than
   * setting velocity directly (`VELOCITY_GAIN`, ~1.7s time constant) — a
   * deliberate choice so wall/fish collisions can still push back rather
   * than being overridden every frame. Normally that lag is small enough
   * not to matter, but a speed ceiling that keeps moving (`breathingMultiplier`,
   * a burst ramp) keeps the *target* itself in motion too, so the body can
   * chronically trail it. Animating off `vehicle.getSpeed()` in that case
   * reads as "tail flapping hard, barely moving" — animating off the real
   * physical speed instead means the tail only works as hard as the fish is
   * actually, physically working. */
  getSpeed?: () => number;
  /** This fish's current speed ceiling — `maxSpeedFor(energy)` raised
   * during a chase burst (`Fish.tsx`'s `getSpeedCeiling`). Read imperatively
   * each frame, same rationale as `getMode`. Defaults to the flat
   * `maxSpeedFor(critter.energy)` when absent, so the critter-card preview
   * (which has no burst state) is unaffected. */
  getSpeedCeiling?: () => number;
  /** Called once per frame with this fish's animation state, for the fish
   * monitor window (`domain/fishDebug.ts`) and — via `phase` —
   * `Fish.tsx`'s `getThrustEnvelope` (`thrustEnvelope.ts`), which gates the
   * physics impulse to the same tail beat this animates. A callback rather
   * than an imperative handle since `Fish.tsx` just wants to stash the
   * latest value in a ref, not react to it. Absent (and skipped entirely)
   * for the critter-card preview. */
  onDebugFrame?: (anim: {
    turnRate: number;
    isResting: boolean;
    activeAmplitude: number;
    phase: number;
  }) => void;
}

/** Eye and spot positions are plain sphere primitives, not extruded SVG
 * shapes (cheap, no reason to route something this simple through
 * `SVGLoader`) — hand-picked coordinates, with y negated by hand since
 * these don't go through `fishGeometry.ts`'s `extrude()` (which does that
 * flip internally for the pieces that need it). */
const EYE = { x: 68, y: 10, r: 7 };
const MOUTH_BACKING = { x: 96, y: -6, r: 4 };
const SPOTS: Array<{ x: number; y: number; r: number }> = [
  { x: 18, y: 14, r: 6 },
  { x: -18, y: -2, r: 5 },
  { x: -40, y: 4, r: 5 },
  { x: 45, y: -8, r: 4 },
];

// Reused across every fish's `useFrame` call, read immediately and never
// stored — safe to share at module scope (same pattern as
// `SteeringSystem.tsx`'s own scratch vectors).
const scratchVelocity = new THREE.Vector3();

/** Below this speed (fraction of the fish's own `maxSpeedFor(energy)`
 * ceiling — a tired fish still "works hard" near its own cap, not an
 * absolute number), the tail-beat blends from a leisurely cruise toward a
 * quicker, wider "excited" beat — `THREE.MathUtils.smoothstep` between the
 * two, not a hard cutover. */
const EXCITE_SPEED_NORM_LOW = 0.45;
const EXCITE_SPEED_NORM_HIGH = 0.7;

/** Tail-beat frequency (Hz) at the calm and excited ends of the cruise
 * range, each itself lerped further by `speedNorm` within its own end —
 * toned down from an earlier pass that let the excited ceiling reach 10Hz,
 * which read as vibrating rather than swimming. */
const CALM_FREQUENCY_BASE = 2.2;
const CALM_FREQUENCY_SPEED_SCALE = 1.8;
const EXCITED_FREQUENCY_BASE = 4;
const EXCITED_FREQUENCY_SPEED_SCALE = 2.5;

/** Base tail-beat amplitude at the calm and excited ends of the cruise
 * range (before the turn/overdrive boosts below). */
const CALM_AMPLITUDE = 0.08;
const EXCITED_AMPLITUDE = 0.16;

/** Fan/Forked tails are one rigid single-pivot paddle with no secondary
 * motion (unlike Veil, which layers `VEIL_BEND_AMPLITUDE`'s per-vertex
 * progressive bend on top of this same base swing) — at the plain base
 * amplitude above, that single small pivot rotation reads as stiff/rigid
 * rather than swimming. This boosts *only* their base swing to compensate;
 * Veil is left at 1 since it's already getting its exaggeration from the
 * secondary bend instead. */
const RIGID_TAIL_AMPLITUDE_MULTIPLIER = 1.8;

/** How much a turn adds to tail amplitude — kept well under
 * `CALM_AMPLITUDE`/`EXCITED_AMPLITUDE` above (a fraction of the base range,
 * not a comparable addition to it), so a turn reads as a slightly bigger
 * tail sweep, not a faster/more frantic one. A live pass at `0.08`/cap `2`
 * (max +0.16, matching the *entire* base range) still read as swishing too
 * fast through a turn — halved again here. The old `turnRate * 0.25` with
 * no practical cap could add up to 3-7x the base amplitude on an ordinary
 * turn. */
const TURN_RATE_AMPLITUDE_SCALE = 0.045;
const TURN_RATE_AMPLITUDE_CAP = 1.5;

/** A turn's amplitude boost above pairs with a *reduction* in frequency —
 * the same stroke-length/cadence trade a swimmer makes: a bigger sweep
 * covered at the same beat rate has a faster-moving tail tip and reads as
 * "swishing faster," when the intent is just "swishing wider." At
 * `TURN_RATE_AMPLITUDE_CAP` this trims frequency by ~18%. */
const TURN_RATE_FREQUENCY_DAMP_SCALE = 0.12;

/** A separate, real-speed-derived signal from `excite`/`speedNorm`: how
 * *steady* the fish's actual speed is right now, not how fast. Speeding up
 * or slowing down is the hardest part of this whole animation to sell (the
 * body's own physical response lags the steering target, `getSpeed`'s doc
 * comment above) — so amplitude gets no bonus while genuinely accelerating,
 * and a modest one once speed has actually settled, rather than reading
 * uniformly lively regardless of whether the fish is mid-transition. Smoothed
 * (not raw per-frame delta-speed) so it doesn't flicker frame to frame. */
const ACCEL_SMOOTHING_RATE = 3;
const ACCEL_STEADY_THRESHOLD = 0.15;
const ACCEL_BUSY_THRESHOLD = 1.0;
const STEADY_AMPLITUDE_BONUS = 0.25;

/** How much a burst's `burstOverdrive` term (`chaseParams.ts`) can further
 * scale frequency/amplitude on top of everything above — halved from an
 * earlier pass for the same "less flutter, more swim" reason. */
const OVERDRIVE_FREQUENCY_SCALE = 0.3;
const OVERDRIVE_AMPLITUDE_SCALE = 0.15;

/** Real "not swimming" state, not just a quiet moment — speed has to stay
 * below `REST_ENTER_SPEED` for a full `REST_ENTER_DWELL_SEC` before rest
 * kicks in (no per-frame flicker at the boundary), and has to climb back
 * past the higher `REST_EXIT_SPEED` (not just re-cross the same line) to
 * leave it — both well below cruise speed. `paused`/`settled` modes
 * (`Fish.tsx`) force rest immediately, no dwell needed. */
const REST_ENTER_SPEED = 0.05;
const REST_EXIT_SPEED = 0.12;
const REST_ENTER_DWELL_SEC = 0.5;
/** How quickly the tail's amplitude/frequency actually ramp toward their
 * rest-vs-active target once the rest *state* above has changed — never an
 * instant cut, "a fully motionless fish is the fastest way to break the
 * illusion" (§6.6). */
const REST_BLEND_TIME_CONSTANT_SEC = 0.4;
const REST_TAIL_FREQUENCY = 1.5;
const REST_TAIL_AMPLITUDE = 0.02;
/** A resting fish still occasionally adjusts itself — a brief burst back up
 * near cruise amplitude, immediately left to decay back toward the rest
 * target by the same per-frame blend above, so it reads as "the fish just
 * flicked its tail," not a state-machine glitch. */
const MICRO_FLICK_AMPLITUDE = 0.12;
const MICRO_FLICK_MIN_INTERVAL_SEC = 4;
const MICRO_FLICK_MAX_INTERVAL_SEC = 4;

const VEIL_BEND_AMPLITUDE = 0.5;
const VEIL_PHASE_LAG = 1.1; // matches docs/architecture/3d-engine.md §6.6's per-segment stagger constant
const PECTORAL_FLUTTER_AMPLITUDE = 0.18;
const MOUTH_CYCLE_FREQUENCY = 0.9;
const MOUTH_OPEN_AMPLITUDE = 0.4; // ≈23°, inside a hand-picked ~20–25° sweet spot
const BODY_BANK_AMPLITUDE = 0.05;
const BODY_BOB_AMPLITUDE = 0.02;

export function FishModel({
  critter,
  vehicle,
  still = false,
  getMode,
  getSpeed,
  getSpeedCeiling,
  onDebugFrame,
}: FishModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const tailPivotRef = useRef<THREE.Group>(null);
  const pectoralPivotRef = useRef<THREE.Group>(null);
  const pectoralFarPivotRef = useRef<THREE.Group>(null);
  const mouthPivotRef = useRef<THREE.Group>(null);

  // One random phase per fish, fixed at spawn — without it every fish beats
  // in perfect unison whenever they share a speed (§6.6).
  const phaseSeed = useMemo(() => Math.random() * Math.PI * 2, []);
  // The tail beat's own accumulated phase, seeded from the above — see
  // `advanceTailPhase`'s doc comment for why this has to accumulate rather
  // than derive from absolute clock time.
  const phaseRef = useRef(phaseSeed);
  const prevDirection = useRef(new THREE.Vector3(0, 0, 1));
  // Peak-hold for `onDebugFrame`'s reported turn rate — the fish monitor
  // window only samples a few times a second, so a genuine one/two-frame
  // spike (e.g. right at a night settle/wake mode flip) would otherwise be
  // invisible between polls. Decays fast enough to read as "just happened"
  // rather than a stuck reading.
  const peakTurnRateRef = useRef(0);

  // Smoothed real-speed derivative, feeding the steady-state amplitude
  // bonus above — see `ACCEL_SMOOTHING_RATE`'s doc comment.
  const prevSpeedRef = useRef(0);
  const smoothedAccelRef = useRef(0);

  // Idle/rest state — see the constants above for the hysteresis and blend
  // timing this drives.
  const isRestingRef = useRef(false);
  const belowRestEnterSinceRef = useRef<number | null>(null);
  const workingFrequencyRef = useRef(REST_TAIL_FREQUENCY);
  const workingAmplitudeRef = useRef(REST_TAIL_AMPLITUDE);
  const nextMicroFlickRef = useRef<number | null>(null);

  const isMale = critter.sex === 'Male';
  const scale = lifeStageScale(critter.life_stage) * SVG_SCALE;
  const tailScale = isMale ? MALE_TAIL_SCALE : 1.0; // §6.7 — modest fin scale-up, males only
  const saturation = isMale ? 0.75 : 0.62; // §6.7 — a few points apart, not a strong split

  const bodyColour = useMemo(
    () => new THREE.Color().setHSL(critter.hue / 360, saturation, 0.55),
    [critter.hue, saturation],
  );
  const bellyColour = useMemo(
    () => new THREE.Color().setHSL(critter.hue / 360, 0.4, 0.82),
    [critter.hue],
  );
  const finColour = useMemo(
    () => new THREE.Color().setHSL(critter.hue / 360, saturation, 0.48),
    [critter.hue, saturation],
  );

  // `fin` never changes after birth (SPEC.md §5) — read once, with a
  // fallback for the `FinType | null` type even though it's always
  // populated for a real fish in practice (`null` is only for geckos).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const finType = useMemo(() => critter.fin ?? 'Forked', []);

  // Per-fish clone: the belly gradient is painted per fish from its own
  // hue, so this can't be the shared module-level geometry.
  const bodyGeometry = useMemo(() => createBodyGeometry(), []);
  useEffect(() => {
    paintBellyGradient(bodyGeometry, bodyColour, bellyColour);
  }, [bodyGeometry, bodyColour, bellyColour]);

  // Per-fish clone: only the veil tail needs one (its per-frame bend
  // differs per fish); fan/forked reuse the shared, unmutated geometry.
  const veilGeometry = useMemo(() => (finType === 'Veil' ? createVeilGeometry() : null), [finType]);
  const veilRestPositions = useMemo(() => {
    const pos = veilGeometry?.attributes.position;
    return pos ? (pos.array.slice() as Float32Array) : null;
  }, [veilGeometry]);
  const veilTailLength = useMemo(() => {
    if (!veilRestPositions) return 0;
    let max = 0;
    for (let i = 0; i < veilRestPositions.length; i += 3) {
      max = Math.max(max, -veilRestPositions[i]!);
    }
    return max;
  }, [veilRestPositions]);

  const tailGeometry =
    finType === 'Fan'
      ? SHARED_GEOMETRY.tailFan
      : finType === 'Forked'
        ? SHARED_GEOMETRY.tailForked
        : (veilGeometry ?? SHARED_GEOMETRY.tailForked);

  const pectoralMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({ color: finColour, roughness: 0.6, side: THREE.DoubleSide }),
    [finColour],
  );
  const pectoralPivot = useMemo(() => {
    const pivot = wrapInPivot(
      SHARED_GEOMETRY.pectoral,
      pectoralMaterial,
      PECTORAL_HINGE.x,
      PECTORAL_HINGE.y,
    );
    pivot.position.z = BODY_DEPTH / 2 - 1;
    return pivot;
  }, [pectoralMaterial]);
  const pectoralFarPivot = useMemo(() => {
    const pivot = wrapInPivot(
      SHARED_GEOMETRY.pectoral,
      pectoralMaterial,
      PECTORAL_HINGE.x,
      PECTORAL_HINGE.y,
    );
    pivot.position.z = -(BODY_DEPTH / 2 - 1);
    return pivot;
  }, [pectoralMaterial]);

  const mouthMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({ color: bodyColour, roughness: 0.6, side: THREE.DoubleSide }),
    [bodyColour],
  );
  const mouthPivot = useMemo(
    () => wrapInPivot(SHARED_GEOMETRY.mouth, mouthMaterial, MOUTH_HINGE.x, MOUTH_HINGE.y),
    [mouthMaterial],
  );

  // Per-fish geometry clones and manually constructed materials aren't
  // JSX-owned, so R3F never disposes them on its own — over a long-running
  // app's worth of `Born`/`Passed` cycles that would otherwise leak a
  // `BufferGeometry` and two `Material`s per fish. `SHARED_GEOMETRY` and
  // the JSX-declared `<meshStandardMaterial>`s elsewhere in this component
  // are excluded on purpose: the former is shared read-only across every
  // fish instance, and the latter are already R3F-managed.
  useEffect(() => {
    return () => {
      bodyGeometry.dispose();
      veilGeometry?.dispose();
      pectoralMaterial.dispose();
      mouthMaterial.dispose();
    };
  }, [bodyGeometry, veilGeometry, pectoralMaterial, mouthMaterial]);

  useFrame((state, delta) => {
    if (still) return;

    const speed = getSpeed ? getSpeed() : vehicle.getSpeed();

    // turnRate drives "sharper turn -> bigger S-curve" (§6.6) — see
    // `turnRate.ts` for why it's gated below a minimum speed rather than
    // measured from every frame's raw velocity direction.
    scratchVelocity.set(vehicle.velocity.x, vehicle.velocity.y, vehicle.velocity.z);
    const { turnRate, direction } = computeTurnRate(
      speed,
      scratchVelocity,
      prevDirection.current,
      delta,
    );
    prevDirection.current.copy(direction);

    const t = state.clock.elapsedTime;
    const mode = getMode ? getMode() : 'active';

    // Rest-state hysteresis: `paused`/`settled` force it immediately;
    // otherwise a real, sustained lull in speed (not a single quiet frame)
    // earns it, and only a clearly-faster speed (not just crossing back
    // over the same line) earns the way out.
    if (mode === 'paused' || mode === 'settled') {
      isRestingRef.current = true;
      belowRestEnterSinceRef.current = null;
    } else if (isRestingRef.current) {
      if (speed > REST_EXIT_SPEED) {
        isRestingRef.current = false;
        belowRestEnterSinceRef.current = null;
      }
    } else if (speed < REST_ENTER_SPEED) {
      if (belowRestEnterSinceRef.current === null) belowRestEnterSinceRef.current = t;
      else if (t - belowRestEnterSinceRef.current >= REST_ENTER_DWELL_SEC) {
        isRestingRef.current = true;
      }
    } else {
      belowRestEnterSinceRef.current = null;
    }

    // Speed-tiered intensity, normalized by *this fish's own* speed ceiling
    // rather than an absolute number — a tired fish at its (lower) cap
    // still visibly "works hard," which is what makes cruise vs excited
    // read as distinct characters rather than one continuous dial. The
    // ceiling itself is the *raised* one during a chase burst
    // (`getSpeedCeiling`), so normalizing against it doesn't just clamp
    // straight to 1 — `overdrive` below is what makes a burst read as
    // genuinely harder than normal top gear, not identical to it.
    const baseCeiling = maxSpeedFor(critter.energy);
    const speedCeiling = getSpeedCeiling ? getSpeedCeiling() : baseCeiling;
    const speedNorm = THREE.MathUtils.clamp(speed / speedCeiling, 0, 1);
    const excite = THREE.MathUtils.smoothstep(
      speedNorm,
      EXCITE_SPEED_NORM_LOW,
      EXCITE_SPEED_NORM_HIGH,
    );
    const overdrive = burstOverdrive(speed, baseCeiling);
    const { freqMul, ampMul } = animationMulFor(critter.personality, critter.mood);
    const cappedTurnRate = Math.min(turnRate, TURN_RATE_AMPLITUDE_CAP);

    // How steady (vs. actively changing) the fish's real speed is right
    // now — smoothed so an isolated frame's noise doesn't flicker the
    // bonus below on and off.
    const rawAccel = delta > 0 ? (speed - prevSpeedRef.current) / delta : 0;
    prevSpeedRef.current = speed;
    smoothedAccelRef.current = THREE.MathUtils.lerp(
      smoothedAccelRef.current,
      rawAccel,
      1 - Math.exp(-ACCEL_SMOOTHING_RATE * delta),
    );
    const steadiness =
      1 -
      THREE.MathUtils.smoothstep(
        Math.abs(smoothedAccelRef.current),
        ACCEL_STEADY_THRESHOLD,
        ACCEL_BUSY_THRESHOLD,
      );
    const activeFrequency =
      THREE.MathUtils.lerp(
        CALM_FREQUENCY_BASE + CALM_FREQUENCY_SPEED_SCALE * speedNorm,
        EXCITED_FREQUENCY_BASE + EXCITED_FREQUENCY_SPEED_SCALE * speedNorm,
        excite,
      ) *
      freqMul *
      (1 + OVERDRIVE_FREQUENCY_SCALE * overdrive) *
      (1 - TURN_RATE_FREQUENCY_DAMP_SCALE * cappedTurnRate);
    const rigidTailMul = finType === 'Veil' ? 1 : RIGID_TAIL_AMPLITUDE_MULTIPLIER;
    const activeAmplitude =
      (THREE.MathUtils.lerp(CALM_AMPLITUDE, EXCITED_AMPLITUDE, excite) +
        cappedTurnRate * TURN_RATE_AMPLITUDE_SCALE) *
      rigidTailMul *
      ampMul *
      (1 + OVERDRIVE_AMPLITUDE_SCALE * overdrive) *
      (1 + STEADY_AMPLITUDE_BONUS * steadiness);

    // Micro-flick while resting: an instant bump back toward cruise
    // amplitude that the blend below immediately starts decaying again —
    // reads as "the fish just adjusted itself," not a freeze-frame.
    if (isRestingRef.current) {
      if (nextMicroFlickRef.current === null) {
        nextMicroFlickRef.current =
          t + MICRO_FLICK_MIN_INTERVAL_SEC + Math.random() * MICRO_FLICK_MAX_INTERVAL_SEC;
      } else if (t >= nextMicroFlickRef.current) {
        workingAmplitudeRef.current = MICRO_FLICK_AMPLITUDE;
        nextMicroFlickRef.current =
          t + MICRO_FLICK_MIN_INTERVAL_SEC + Math.random() * MICRO_FLICK_MAX_INTERVAL_SEC;
      }
    } else {
      nextMicroFlickRef.current = null;
    }

    const targetFrequency = isRestingRef.current ? REST_TAIL_FREQUENCY : activeFrequency;
    const targetAmplitude = isRestingRef.current ? REST_TAIL_AMPLITUDE : activeAmplitude;
    const blend = 1 - Math.exp(-delta / REST_BLEND_TIME_CONSTANT_SEC);
    workingFrequencyRef.current = THREE.MathUtils.lerp(
      workingFrequencyRef.current,
      targetFrequency,
      blend,
    );
    workingAmplitudeRef.current = THREE.MathUtils.lerp(
      workingAmplitudeRef.current,
      targetAmplitude,
      blend,
    );

    const frequency = workingFrequencyRef.current;
    const amplitude = workingAmplitudeRef.current;
    phaseRef.current = advanceTailPhase(phaseRef.current, frequency, delta);
    const phase = phaseRef.current;

    peakTurnRateRef.current = Math.max(turnRate, peakTurnRateRef.current * Math.exp(-5 * delta));
    onDebugFrame?.({
      turnRate: peakTurnRateRef.current,
      isResting: isRestingRef.current,
      activeAmplitude: amplitude,
      phase,
    });

    if (tailPivotRef.current) {
      tailPivotRef.current.rotation.y = Math.sin(phase) * amplitude;
    }

    // Veil-only secondary bend: bends progressively more toward the tip
    // each frame (a per-vertex deformation, not a literal second joint),
    // phase-lagged along its length by the same stagger §6.6 specifies for
    // the real bone chain, so it reads as one continuous wave rather than
    // a rigid paddle. Fan/forked stay rigid single-pivot — their paddle
    // shapes don't need it.
    if (finType === 'Veil' && veilGeometry && veilRestPositions) {
      const pos = veilGeometry.attributes.position;
      if (pos) {
        for (let i = 0; i < veilRestPositions.length; i += 3) {
          const x = veilRestPositions[i]!;
          const y = veilRestPositions[i + 1]!;
          const z = veilRestPositions[i + 2]!;
          const tt = THREE.MathUtils.clamp(-x / veilTailLength, 0, 1);
          const angle = tt * VEIL_BEND_AMPLITUDE * Math.sin(phase + tt * VEIL_PHASE_LAG);
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          pos.setXYZ(i / 3, x * cos - z * sin, y, x * sin + z * cos);
        }
        pos.needsUpdate = true;
        veilGeometry.computeVertexNormals();
      }
    }

    const flutter = Math.sin(phase * 1.3 + 0.6) * PECTORAL_FLUTTER_AMPLITUDE;
    if (pectoralPivotRef.current) pectoralPivotRef.current.rotation.z = flutter;
    if (pectoralFarPivotRef.current) pectoralFarPivotRef.current.rotation.z = flutter;

    // Mouth's own slower period — it doesn't open/close on the tail's
    // beat. Rotates about Z (the hinge's own 2D plane); sign verified by
    // tracing the jaw tip's trajectory under rotation before this shipped
    // (the tip moves toward the belly side, i.e. drops down, with this
    // sign).
    if (mouthPivotRef.current) {
      mouthPivotRef.current.rotation.z =
        -Math.max(0, Math.sin(t * MOUTH_CYCLE_FREQUENCY + phaseSeed)) * MOUTH_OPEN_AMPLITUDE;
    }

    // Whole-body bank/bob, approximating the spine wave §6.2 describes as
    // the aspirational technique — there's no bone rig here, so this is a
    // local wobble layered on `FishModel`'s own root group rather than a
    // true per-segment bend. Doesn't fight `Fish.tsx`'s `RigidBody`, which
    // owns the fish's actual world position/heading — this just adds a
    // small additional local transform nested inside that.
    //
    // Scaled by `excite` (real-speed-derived, same term the tail's own
    // frequency/amplitude use) rather than following `frequency` at full
    // strength unconditionally — `frequency` alone can spike well above
    // what the body is actually doing (the overdrive term above reacts to a
    // *raised ceiling*, not to genuine forward progress catching up to it),
    // and with no bone rig to distribute that into a real swimming
    // undulation, a fast bank/bob with little real motion under it reads as
    // the whole fish vibrating in place rather than swimming hard.
    const swayIntensity = THREE.MathUtils.lerp(0.3, 1, excite);
    if (rootRef.current) {
      rootRef.current.rotation.z = Math.sin(phase) * BODY_BANK_AMPLITUDE * swayIntensity;
      rootRef.current.position.y =
        Math.sin(t * frequency * 0.5 + phaseSeed) * BODY_BOB_AMPLITUDE * swayIntensity;
    }
  });

  return (
    <group ref={rootRef} scale={scale}>
      <mesh geometry={bodyGeometry} castShadow receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.6} side={THREE.DoubleSide} />
      </mesh>

      <mesh geometry={SHARED_GEOMETRY.dorsal} castShadow>
        <meshStandardMaterial color={finColour} roughness={0.6} side={THREE.DoubleSide} />
      </mesh>

      <mesh geometry={SHARED_GEOMETRY.gill} position={[0, 0, BODY_DEPTH / 2 + 0.3]} castShadow>
        <meshStandardMaterial color={finColour} roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={SHARED_GEOMETRY.gill} position={[0, 0, -(BODY_DEPTH / 2 + 0.3)]} castShadow>
        <meshStandardMaterial color={finColour} roughness={0.6} side={THREE.DoubleSide} />
      </mesh>

      <primitive object={pectoralPivot} ref={pectoralPivotRef} />
      <primitive object={pectoralFarPivot} ref={pectoralFarPivotRef} />
      <primitive object={mouthPivot} ref={mouthPivotRef} />

      <mesh position={[MOUTH_BACKING.x, MOUTH_BACKING.y, 0]}>
        <sphereGeometry args={[MOUTH_BACKING.r, 12, 12]} />
        <meshStandardMaterial color="#22222a" roughness={0.4} />
      </mesh>

      <group ref={tailPivotRef} position={[TAIL_PIVOT.x, TAIL_PIVOT.y, 0]} scale={tailScale}>
        <mesh geometry={tailGeometry} castShadow>
          <meshStandardMaterial color={finColour} roughness={0.6} side={THREE.DoubleSide} />
        </mesh>
      </group>

      <mesh position={[EYE.x, EYE.y, BODY_DEPTH / 2 + 3]}>
        <sphereGeometry args={[EYE.r, 16, 16]} />
        <meshStandardMaterial color="#22222a" roughness={0.4} />
      </mesh>
      <mesh position={[EYE.x, EYE.y, -(BODY_DEPTH / 2 + 3)]}>
        <sphereGeometry args={[EYE.r, 16, 16]} />
        <meshStandardMaterial color="#22222a" roughness={0.4} />
      </mesh>

      {critter.spots &&
        SPOTS.map((spot, i) => (
          <group key={i}>
            <mesh position={[spot.x, spot.y, BODY_DEPTH / 2 + spot.r * 0.4]}>
              <sphereGeometry args={[spot.r, 12, 12]} />
              <meshStandardMaterial color="#2b2a33" roughness={0.7} />
            </mesh>
            <mesh position={[spot.x, spot.y, -(BODY_DEPTH / 2 + spot.r * 0.4)]}>
              <sphereGeometry args={[spot.r, 12, 12]} />
              <meshStandardMaterial color="#2b2a33" roughness={0.7} />
            </mesh>
          </group>
        ))}
    </group>
  );
}
