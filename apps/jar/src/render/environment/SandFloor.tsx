// Two-tone sand floor — a darker base box (unchanged shape from the
// original placeholder) with a lighter, lobed SVG overlay and scattered
// pebbles laid on top, replacing the flat single-colour box per §8.1's own
// "two-tone, matching the original's two layered ellipses" spec line. The
// floor's containment collider is untouched (`AquariumEnvironment.tsx`
// still owns it) — this is visual only.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';

import { TANK_DEPTH, TANK_WIDTH } from '../physics/coordinates';
import { SAND_GEOMETRY, SAND_SVG_SCALE } from './decorGeometry';
import { FLOOR_TOP_Y } from './decorLayout';

const SAND_BASE_COLOUR = '#c9b78e';
const SAND_LIGHT_COLOUR = '#d8c9a0';
const ROCK_COLOUR = '#8a7860';
const PEBBLE_COLOUR = '#a9906f';

export function SandFloor() {
  return (
    <group>
      <mesh position={[0, FLOOR_TOP_Y - 0.1, 0]} receiveShadow>
        <boxGeometry args={[TANK_WIDTH, 0.2, TANK_DEPTH]} />
        <meshStandardMaterial color={SAND_BASE_COLOUR} roughness={0.9} />
      </mesh>

      {/* Overlay/rock/pebbles: authored top-down, so rotate the extruded
          slab flat (its own "depth" axis becomes world Y) and lift it just
          above the base box's own top face. */}
      <mesh
        geometry={SAND_GEOMETRY.top}
        position={[0, FLOOR_TOP_Y + 0.01, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={SAND_SVG_SCALE}
        receiveShadow
        raycast={() => null}
      >
        <meshStandardMaterial color={SAND_LIGHT_COLOUR} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh
        geometry={SAND_GEOMETRY.rock}
        position={[0, FLOOR_TOP_Y + 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={SAND_SVG_SCALE}
        castShadow
        receiveShadow
        raycast={() => null}
      >
        <meshStandardMaterial color={ROCK_COLOUR} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh
        geometry={SAND_GEOMETRY.pebbles}
        position={[0, FLOOR_TOP_Y + 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={SAND_SVG_SCALE}
        castShadow
        receiveShadow
        raycast={() => null}
      >
        <meshStandardMaterial color={PEBBLE_COLOUR} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
