// Aquarium backdrop + containment. The visible floor is a simple two-tone
// stand-in for the real sand/rock/plants (`docs/architecture/3d-engine.md`
// §8.1 — still TODO, see `NEXT_STEPS.md`); the invisible fixed walls are
// real containment per §5.1 ("Static/fixed bodies: tank walls... inset
// slightly from the visible glass so no clipping is visible at the
// boundary"), inset a small margin from `TANK_WIDTH`/`TANK_HEIGHT`/
// `TANK_DEPTH` so fish don't visibly clip the glass before bouncing off it.
//
// The glass box below uses plain alpha blending (`transparent`/`opacity`),
// not `meshPhysicalMaterial`'s `transmission` — transmission achieves its
// see-through look by re-rendering the scene's opaque contents into an
// offscreen texture and sampling that, which still writes opaque alpha to
// the canvas. That would defeat the point here: the desktop behind Jar's
// window needs to show through the tank itself, tinted by the glass, not
// just around it — real alpha blending is what actually punches a
// partially-transparent hole in the canvas's own output.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';

import { useJarStore } from '../../domain/jarClient';
import { TANK_DEPTH, TANK_HEIGHT, TANK_INNER_BOUNDS, TANK_WIDTH } from '../physics/coordinates';

const WALL_THICKNESS = 0.1;

export function AquariumEnvironment() {
  const halfW = TANK_INNER_BOUNDS.x;
  const halfH = TANK_INNER_BOUNDS.y;
  const halfD = TANK_INNER_BOUNDS.z;
  const lightOn = useJarStore((s) => s.settings.light_on);

  return (
    <>
      {/* Sand floor — stand-in for the real two-tone floor/rock/plants. */}
      <mesh position={[0, -halfH, 0]}>
        <boxGeometry args={[TANK_WIDTH, 0.2, TANK_DEPTH]} />
        <meshStandardMaterial color="#d8c9a0" roughness={0.9} />
      </mesh>

      {/* Glass tank enclosure: a translucent tinted box around the whole
          volume rather than just a front pane, so the tank reads as glass
          full of water from every angle while still letting the desktop
          show through it. `depthWrite: false` avoids the far/near faces of
          this same transparent box fighting each other for draw order —
          an ordinary depth-sorted opaque box doesn't have this problem,
          but two overlapping transparent faces of one mesh do.
          `raycast={() => null}`: click-through, so it never steals a
          critter-select hit meant for what's inside or behind it. */}
      <mesh raycast={() => null}>
        <boxGeometry args={[TANK_WIDTH, TANK_HEIGHT, TANK_DEPTH]} />
        <meshPhysicalMaterial
          color="#7fd0e0"
          transparent
          opacity={0.12}
          roughness={0.1}
          clearcoat={0.3}
          clearcoatRoughness={0.15}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Surface highlight (§8.1's last bullet): a soft light band toggled
          by the drawer's Light control, standing in for a light-shaft
          effect without a real volumetric light. */}
      {lightOn && (
        <mesh position={[0, halfH - 0.15, 0]} raycast={() => null}>
          <planeGeometry args={[TANK_WIDTH, 0.3]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0.35}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      )}

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
