// The aquarium castle — a hand-authored, camera-facing prop with a real
// cut-through doorway (`decor-svg/castle.svg`'s own header comment), built
// from the same SVG-extrusion technique `FishModel.tsx` uses. Static
// collision follows §5.1's convention for tank furniture, split into
// several boxes (not one solid footprint) specifically to leave the
// doorway clear — see `decorLayout.ts`'s `CASTLE_COLLIDER_BOXES`. An
// overhead spotlight (deliberately requested, not one of §10.1's generic
// fill/rim lights) picks it out from the base ambient/directional pair —
// anything swimming through its cone gets lit the same way, for free.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { CASTLE_GEOMETRY, DECOR_SVG_SCALE } from './decorGeometry';
import { CASTLE_COLLIDER_BOXES, CASTLE_POSITION, CASTLE_TOWER_OFFSET } from './decorLayout';

const KEEP_COLOUR = '#d9a86c';
const ROOF_COLOUR = '#c96f5e';
const WINDOW_COLOUR = '#4a3f45';
const FLAG_COLOUR = '#c2452d'; // matches SPEC.md §4's Paper notebook red-pen accent

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

/** A narrow arrow-slit — same relief colour/treatment as `Window`, just a
 * thin box instead of a circle, scattered across the keep face for a bit
 * more surface detail than one central window alone gives it. */
function ArrowSlit({ position }: { position: [number, number, number] }) {
  return (
    <mesh position={position} raycast={() => null}>
      <boxGeometry args={[0.035, 0.16, 0.03]} />
      <meshStandardMaterial color={WINDOW_COLOUR} roughness={0.4} />
    </mesh>
  );
}

/** A small pennant on a thin pole, mounted on the centre merlon — the one
 * purely decorative flourish on the keep, no relief/functional meaning
 * like the windows. */
function Flag({ position }: { position: [number, number, number] }) {
  const flagGeometry = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.09);
    shape.lineTo(0.14, 0.05);
    shape.lineTo(0, 0.01);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, []);
  return (
    <group position={position}>
      <mesh raycast={() => null}>
        <cylinderGeometry args={[0.01, 0.01, 0.22, 6]} />
        <meshStandardMaterial color={WINDOW_COLOUR} roughness={0.6} />
      </mesh>
      <mesh geometry={flagGeometry} position={[0, 0.02, 0.01]} castShadow raycast={() => null}>
        <meshStandardMaterial color={FLAG_COLOUR} roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/** Aimed down at the castle from just under the water's surface — `target`
 * is a plain `Object3D` rather than a position tuple because `SpotLight`'s
 * own `target` property must be a scene object, not a vector; set
 * imperatively once both light and target refs exist. */
function CastleSpotlight() {
  const lightRef = useRef<THREE.SpotLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);
  useEffect(() => {
    if (lightRef.current && targetRef.current) {
      lightRef.current.target = targetRef.current;
    }
  }, []);
  return (
    <>
      <spotLight
        ref={lightRef}
        position={[0, 2, 1.5]}
        color="#bfe8ff"
        intensity={3}
        angle={0.5}
        penumbra={0.5}
        distance={5}
        castShadow
        shadow-mapSize={[512, 512]}
      />
      <object3D ref={targetRef} position={[0, 0.8, 0]} />
    </>
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
      <ArrowSlit position={[-0.55, 1.0, 0.29]} />
      <ArrowSlit position={[0.55, 1.0, 0.29]} />
      <Flag position={[0, 2.0, 0]} />
      <CastleSpotlight />
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
