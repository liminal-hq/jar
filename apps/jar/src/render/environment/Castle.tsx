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
const WINDOW_COLOUR = '#4a3f45';

/** Plain sphere primitive, not an extruded SVG shape — same rationale as
 * `FishModel.tsx`'s eye/spot circles: cheap, and there's no reason to route
 * something this simple through `SVGLoader`. Mounted slightly proud of
 * whichever face it sits on so it doesn't z-fight the wall behind it. */
function Window({ position, radius }: { position: [number, number, number]; radius: number }) {
  return (
    <mesh position={position} raycast={() => null}>
      <sphereGeometry args={[radius, 12, 12]} />
      <meshStandardMaterial color={WINDOW_COLOUR} roughness={0.4} />
    </mesh>
  );
}

function Tower({ x }: { x: number }) {
  return (
    <group position={[x, 0, 0]}>
      <group scale={DECOR_SVG_SCALE}>
        <mesh geometry={CASTLE_GEOMETRY.towerBody} castShadow receiveShadow raycast={() => null}>
          <meshStandardMaterial color={KEEP_COLOUR} roughness={0.6} side={THREE.DoubleSide} />
        </mesh>
        <mesh geometry={CASTLE_GEOMETRY.towerRoof} castShadow receiveShadow raycast={() => null}>
          <meshStandardMaterial color={ROOF_COLOUR} roughness={0.6} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <Window position={[0, 0.45, 0.245]} radius={0.07} />
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
        <mesh
          geometry={CASTLE_GEOMETRY.keepBody}
          material={keepMaterial}
          castShadow
          receiveShadow
          raycast={() => null}
        />
        <mesh
          geometry={CASTLE_GEOMETRY.merlons}
          material={keepMaterial}
          castShadow
          receiveShadow
          raycast={() => null}
        />
      </group>
      <Window position={[0, 1.4, 0.29]} radius={0.09} />
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
