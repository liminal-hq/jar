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
import {
  BODY_DEPTH,
  createBodyGeometry,
  createVeilGeometry,
  MOUTH_HINGE,
  paintBellyGradient,
  PECTORAL_HINGE,
  SHARED_GEOMETRY,
  TAIL_PIVOT,
  wrapInPivot,
} from './fishGeometry';

interface FishModelProps {
  critter: Critter;
  vehicle: YUKA.Vehicle;
}

/** The SVG artwork is authored at a `viewBox="-170 -110 340 220"` scale —
 * this brings it down to roughly the same on-screen size as the model it
 * replaces (whose body sphere had radius 0.18). Combined with
 * `lifeStageScale` on the root group, same single-scale-group pattern the
 * model already used. */
const SVG_SCALE = 0.004;

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

const TAIL_FREQUENCY_BASE = 4;
const TAIL_FREQUENCY_SPEED = 2;
const VEIL_BEND_AMPLITUDE = 0.5;
const VEIL_PHASE_LAG = 1.1; // matches docs/architecture/3d-engine.md §6.6's per-segment stagger constant
const PECTORAL_FLUTTER_AMPLITUDE = 0.18;
const MOUTH_CYCLE_FREQUENCY = 0.9;
const MOUTH_OPEN_AMPLITUDE = 0.4; // ≈23°, inside a hand-picked ~20–25° sweet spot
const BODY_BANK_AMPLITUDE = 0.05;
const BODY_BOB_AMPLITUDE = 0.02;

export function FishModel({ critter, vehicle }: FishModelProps) {
  const rootRef = useRef<THREE.Group>(null);
  const tailPivotRef = useRef<THREE.Group>(null);
  const pectoralPivotRef = useRef<THREE.Group>(null);
  const pectoralFarPivotRef = useRef<THREE.Group>(null);
  const mouthPivotRef = useRef<THREE.Group>(null);

  // One random phase per fish, fixed at spawn — without it every fish beats
  // in perfect unison whenever they share a speed (§6.6).
  const phaseSeed = useMemo(() => Math.random() * Math.PI * 2, []);
  const prevDirection = useRef(new THREE.Vector3(0, 0, 1));

  const isMale = critter.sex === 'Male';
  const scale = lifeStageScale(critter.age_sec) * SVG_SCALE;
  const tailScale = isMale ? 1.2 : 1.0; // §6.7 — modest fin scale-up, males only
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

  useFrame((state, delta) => {
    const speed = vehicle.getSpeed();
    const direction =
      vehicle.velocity.squaredLength() > 0.0001
        ? new THREE.Vector3(vehicle.velocity.x, vehicle.velocity.y, vehicle.velocity.z).normalize()
        : prevDirection.current;

    // turnRate approximated from how fast the heading direction is
    // rotating, rather than tracked as a first-class steering output —
    // good enough to drive "sharper turn -> bigger S-curve" (§6.6).
    const angleDelta = prevDirection.current.angleTo(direction);
    const turnRate = delta > 0 ? angleDelta / delta : 0;
    prevDirection.current.copy(direction);

    const t = state.clock.elapsedTime;
    const frequency = TAIL_FREQUENCY_BASE + speed * TAIL_FREQUENCY_SPEED;
    const amplitude = speed < 0.05 ? 0.08 : 0.15 + Math.min(turnRate, 3) * 0.3;
    const phase = t * frequency + phaseSeed;

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
    if (rootRef.current) {
      rootRef.current.rotation.z = Math.sin(phase) * BODY_BANK_AMPLITUDE;
      rootRef.current.position.y = Math.sin(t * frequency * 0.5 + phaseSeed) * BODY_BOB_AMPLITUDE;
    }
  });

  return (
    <group ref={rootRef} scale={scale}>
      <mesh geometry={bodyGeometry}>
        <meshStandardMaterial vertexColors roughness={0.6} side={THREE.DoubleSide} />
      </mesh>

      <mesh geometry={SHARED_GEOMETRY.dorsal}>
        <meshStandardMaterial color={finColour} roughness={0.6} side={THREE.DoubleSide} />
      </mesh>

      <mesh geometry={SHARED_GEOMETRY.gill} position={[0, 0, BODY_DEPTH / 2 + 0.3]}>
        <meshStandardMaterial color={finColour} roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={SHARED_GEOMETRY.gill} position={[0, 0, -(BODY_DEPTH / 2 + 0.3)]}>
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
        <mesh geometry={tailGeometry}>
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
