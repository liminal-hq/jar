// Aquarium backdrop + containment. The visible floor is a simple two-tone
// stand-in for the real sand/rock/plants (`docs/architecture/3d-engine.md`
// §8.1 — still TODO, see `NEXT_STEPS.md`); the invisible fixed walls are
// real containment per §5.1 ("Static/fixed bodies: tank walls... inset
// slightly from the visible glass so no clipping is visible at the
// boundary"), inset a small margin from `TANK_WIDTH`/`TANK_HEIGHT`/
// `TANK_DEPTH` so fish don't visibly clip the glass before bouncing off it.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { CuboidCollider, RigidBody } from '@react-three/rapier';

import { TANK_DEPTH, TANK_HEIGHT, TANK_WIDTH } from '../physics/coordinates';

const WALL_INSET = 0.15;
const WALL_THICKNESS = 0.1;

export function AquariumEnvironment() {
  const halfW = TANK_WIDTH / 2 - WALL_INSET;
  const halfH = TANK_HEIGHT / 2 - WALL_INSET;
  const halfD = TANK_DEPTH / 2 - WALL_INSET;

  return (
    <>
      {/* Sand floor — stand-in for the real two-tone floor/rock/plants. */}
      <mesh position={[0, -halfH, 0]}>
        <boxGeometry args={[TANK_WIDTH, 0.2, TANK_DEPTH]} />
        <meshStandardMaterial color="#d8c9a0" roughness={0.9} />
      </mesh>

      {/* Invisible containment box — six thin fixed colliders rather than
          one hollow shape, since Rapier has no built-in "inside of a box"
          primitive. */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[halfW, WALL_THICKNESS / 2, halfD]} position={[0, -halfH, 0]} />
        <CuboidCollider args={[halfW, WALL_THICKNESS / 2, halfD]} position={[0, halfH, 0]} />
        <CuboidCollider args={[WALL_THICKNESS / 2, halfH, halfD]} position={[-halfW, 0, 0]} />
        <CuboidCollider args={[WALL_THICKNESS / 2, halfH, halfD]} position={[halfW, 0, 0]} />
        <CuboidCollider args={[halfW, halfH, WALL_THICKNESS / 2]} position={[0, 0, -halfD]} />
        <CuboidCollider args={[halfW, halfH, WALL_THICKNESS / 2]} position={[0, 0, halfD]} />
      </RigidBody>
    </>
  );
}
