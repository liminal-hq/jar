// The aquarium castle — a hand-authored, camera-facing prop with a real
// cut-through doorway (`decor-svg/castle.svg`'s own header comment), built
// from the same SVG-extrusion technique `FishModel.tsx` uses. Static
// collision follows §5.1's convention for tank furniture, split into
// several boxes (not one solid footprint) specifically to leave the
// doorway clear — see `decorLayout.ts`'s `CASTLE_COLLIDER_BOXES`.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { useMemo } from 'react';
import * as THREE from 'three';

import { CASTLE_GEOMETRY, DECOR_SVG_SCALE } from './decorGeometry';
import { CASTLE_COLLIDER_BOXES, CASTLE_POSITION, CASTLE_TOWER_OFFSET } from './decorLayout';

const KEEP_COLOUR = '#d9a86c';
const ROOF_COLOUR = '#c96f5e';

function Tower({ x }: { x: number }) {
  return (
    <group position={[x, 0, 0]} scale={DECOR_SVG_SCALE}>
      <mesh geometry={CASTLE_GEOMETRY.towerBody} raycast={() => null}>
        <meshStandardMaterial color={KEEP_COLOUR} roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={CASTLE_GEOMETRY.towerRoof} raycast={() => null}>
        <meshStandardMaterial color={ROOF_COLOUR} roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

export function Castle() {
  // `meshStandardMaterial` is stateless/shared-safe across the keep and
  // merlons (same colour, same settings) — one instance, not two.
  const keepMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: KEEP_COLOUR,
        roughness: 0.6,
        side: THREE.DoubleSide,
      }),
    [],
  );

  return (
    <group position={[CASTLE_POSITION.x, CASTLE_POSITION.y, CASTLE_POSITION.z]}>
      <group scale={DECOR_SVG_SCALE}>
        <mesh geometry={CASTLE_GEOMETRY.keepBody} material={keepMaterial} raycast={() => null} />
        <mesh geometry={CASTLE_GEOMETRY.merlons} material={keepMaterial} raycast={() => null} />
      </group>
      <Tower x={-CASTLE_TOWER_OFFSET} />
      <Tower x={CASTLE_TOWER_OFFSET} />

      {/* Several boxes, not one — deliberately leaves the doorway clear
          (`decorLayout.ts`'s own comment on `CASTLE_COLLIDER_BOXES`). */}
      <RigidBody type="fixed" colliders={false}>
        {CASTLE_COLLIDER_BOXES.map((box, i) => (
          <CuboidCollider
            key={i}
            args={[box.halfExtents.x, box.halfExtents.y, box.halfExtents.z]}
            position={[box.position.x, box.position.y, box.position.z]}
          />
        ))}
      </RigidBody>
    </group>
  );
}
