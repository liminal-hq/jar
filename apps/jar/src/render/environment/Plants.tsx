// Three swaying plant clusters — per-blade per-vertex bend, the same
// technique `FishModel.tsx`'s veil tail uses (`bladeSwayAngle`'s own doc
// comment for why a per-vertex bend beats a rigid hinge-pivot swing for
// something as flexible as a plant blade). No colliders (§8.2's own
// precedent — foliage is decoration, not something a critter needs to be
// physically blocked by).
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

import {
  createBroadBladeGeometry,
  createKelpBladeGeometry,
  DECOR_SVG_SCALE,
} from './decorGeometry';
import {
  PLANT_BROADLEAF_POSITION,
  PLANT_SMALL_KELP_POSITION,
  PLANT_TALL_KELP_POSITION,
} from './decorLayout';
import { bladeSwayAngle } from './plantSway';

interface BladeSpec {
  kind: 'kelp' | 'broad';
  colour: string;
  rotationDeg: number;
  scale: number;
}

const KELP_GREEN_DARK = '#3b7f56';
const KELP_GREEN_PRIMARY = '#4f9d6b';
const KELP_GREEN_LIGHT = '#6fbf85';

const TALL_KELP_BLADES: BladeSpec[] = [
  { kind: 'kelp', colour: KELP_GREEN_DARK, rotationDeg: -26, scale: 0.62 },
  { kind: 'kelp', colour: KELP_GREEN_PRIMARY, rotationDeg: -13, scale: 0.84 },
  { kind: 'kelp', colour: KELP_GREEN_LIGHT, rotationDeg: 0, scale: 1.05 },
  { kind: 'kelp', colour: KELP_GREEN_PRIMARY, rotationDeg: 13, scale: 0.86 },
  { kind: 'kelp', colour: KELP_GREEN_DARK, rotationDeg: 26, scale: 0.66 },
];

const BROADLEAF_BLADES: BladeSpec[] = [
  { kind: 'broad', colour: KELP_GREEN_DARK, rotationDeg: -28, scale: 0.78 },
  { kind: 'broad', colour: KELP_GREEN_PRIMARY, rotationDeg: -9, scale: 1 },
  { kind: 'broad', colour: KELP_GREEN_LIGHT, rotationDeg: 9, scale: 0.92 },
  { kind: 'broad', colour: KELP_GREEN_DARK, rotationDeg: 28, scale: 0.7 },
];

const SMALL_KELP_BLADES: BladeSpec[] = [
  { kind: 'kelp', colour: KELP_GREEN_PRIMARY, rotationDeg: -23, scale: 0.58 },
  { kind: 'kelp', colour: KELP_GREEN_DARK, rotationDeg: 1, scale: 0.78 },
  { kind: 'kelp', colour: KELP_GREEN_LIGHT, rotationDeg: 23, scale: 0.6 },
];

/** One blade: clones the shared rest geometry (its per-frame bend differs
 * per instance, same reason `FishModel.tsx`'s veil tail needs its own
 * clone rather than sharing one mutable geometry across fish), bends it
 * every frame around a random per-blade phase so a cluster's blades don't
 * sway in unison. */
function Blade({ kind, colour, rotationDeg, scale }: BladeSpec) {
  const geometry = useMemo(
    () => (kind === 'kelp' ? createKelpBladeGeometry() : createBroadBladeGeometry()).clone(),
    [kind],
  );
  const restPositions = useMemo(() => {
    const pos = geometry.attributes.position;
    return pos ? (pos.array.slice() as Float32Array) : null;
  }, [geometry]);
  const bladeLength = useMemo(() => {
    if (!restPositions) return 0;
    let max = 0;
    for (let i = 0; i < restPositions.length; i += 3) {
      max = Math.max(max, -restPositions[i + 1]!);
    }
    return max;
  }, [restPositions]);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);

  useFrame((state) => {
    if (!restPositions || bladeLength <= 0) return;
    const pos = geometry.attributes.position;
    if (!pos) return;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < restPositions.length; i += 3) {
      const x = restPositions[i]!;
      const y = restPositions[i + 1]!;
      const z = restPositions[i + 2]!;
      const h = -y; // height from the base — the blade grows toward -y.
      const tt = THREE.MathUtils.clamp(h / bladeLength, 0, 1);
      const angle = bladeSwayAngle(tt, t, phase);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      // Rotates the (height, width) pair around the base — the same
      // per-vertex-bend shape as the veil tail's own (length, thickness)
      // rotation, remapped to this blade's own long axis (§6.6).
      const newH = h * cos - x * sin;
      const newX = h * sin + x * cos;
      pos.setXYZ(i / 3, newX, -newH, z);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  });

  return (
    <mesh
      geometry={geometry}
      rotation={[0, 0, THREE.MathUtils.degToRad(rotationDeg)]}
      scale={scale * DECOR_SVG_SCALE}
      castShadow
      receiveShadow
      raycast={() => null}
    >
      <meshStandardMaterial color={colour} roughness={0.6} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Cluster({
  position,
  blades,
}: {
  position: { x: number; y: number; z: number };
  blades: BladeSpec[];
}) {
  // One random phase per blade, fixed at spawn — same rationale as
  // `FishModel.tsx`'s own `phaseSeed`, generated once here rather than
  // inside `Blade` so each blade in the array below gets its own distinct
  // key/identity across re-renders.
  const keyedBlades = useRef(blades.map((b, i) => ({ ...b, key: i }))).current;
  return (
    <group position={[position.x, position.y, position.z]}>
      {keyedBlades.map((b) => (
        <Blade
          key={b.key}
          kind={b.kind}
          colour={b.colour}
          rotationDeg={b.rotationDeg}
          scale={b.scale}
        />
      ))}
    </group>
  );
}

export function Plants() {
  return (
    <>
      <Cluster position={PLANT_TALL_KELP_POSITION} blades={TALL_KELP_BLADES} />
      <Cluster position={PLANT_BROADLEAF_POSITION} blades={BROADLEAF_BLADES} />
      <Cluster position={PLANT_SMALL_KELP_POSITION} blades={SMALL_KELP_BLADES} />
    </>
  );
}
