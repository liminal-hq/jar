// The aquarium castle — a hand-authored, camera-facing prop with a real
// cut-through doorway (`decor-svg/castle.svg`'s own header comment), built
// from the same SVG-extrusion technique `FishModel.tsx` uses. Static
// collision follows §5.1's convention for tank furniture, split into
// several boxes (not one solid footprint) specifically to leave the
// doorway clear — see `decorLayout.ts`'s `CASTLE_COLLIDER_BOXES`. A small
// ground-level uplighting fixture prop (deliberately requested, not one
// of §10.1's generic fill/rim lights) picks it out from the base
// ambient/directional pair — anything swimming through its cone gets lit
// the same way, for free.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { useJarStore } from '../../domain/jarClient';
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

const LAMP_HOUSING_COLOUR = '#4a3f45';
const LAMP_BULB_COLOUR = '#fff4d6';
const LAMP_BARREL_LENGTH = 0.14;

const UP = new THREE.Vector3(0, 1, 0);

/** A fixture's aim, computed from two fixed points — the barrel's own
 * quaternion (rotating its local +Y, the axis it's modelled along, to
 * point along `position → target`) and the lens tip's world offset (so
 * the actual light source can originate from the open end of the barrel,
 * not its buried base). Pure geometry, no runtime lookAt: both points are
 * static layout constants, so this only ever needs to run once per
 * fixture. */
function aimFixture(
  position: [number, number, number],
  target: [number, number, number],
  barrelLength: number,
) {
  const from = new THREE.Vector3(...position);
  const dir = new THREE.Vector3(...target).sub(from).normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  const lensPosition = from.clone().addScaledVector(dir, barrelLength);
  return { quaternion, lensPosition };
}

/** A small ground-level floodlight fixture — not a lamppost-style bulb,
 * but a barrel canister on a stake, tilted so its lens end (bright,
 * emissive) aims up at the wall and its plain back end faces the camera —
 * the same "housing you see, light you don't stare into" real landscape
 * spotlights have. The stake itself stays vertical (it's outside the
 * tilted group) even though the barrel it holds is angled. Not a light
 * source itself; `GroundUplight` is the real light, mounted at the lens
 * tip and aimed the same direction. */
function LightProp({
  position,
  quaternion,
}: {
  position: [number, number, number];
  quaternion: THREE.Quaternion;
}) {
  return (
    <group position={position}>
      <mesh position={[0, -0.04, 0]} castShadow receiveShadow raycast={() => null}>
        <cylinderGeometry args={[0.02, 0.025, 0.08, 8]} />
        <meshStandardMaterial color={LAMP_HOUSING_COLOUR} roughness={0.6} metalness={0.3} />
      </mesh>
      <group quaternion={quaternion}>
        <mesh
          position={[0, LAMP_BARREL_LENGTH / 2, 0]}
          castShadow
          receiveShadow
          raycast={() => null}
        >
          <cylinderGeometry args={[0.045, 0.045, LAMP_BARREL_LENGTH, 12]} />
          <meshStandardMaterial color={LAMP_HOUSING_COLOUR} roughness={0.5} metalness={0.4} />
        </mesh>
        {/* The lens: local +Y, so the barrel's own quaternion (which
            rotates +Y onto the aim direction) carries it along for free —
            facing the target, away from the camera. */}
        <mesh
          position={[0, LAMP_BARREL_LENGTH, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          raycast={() => null}
        >
          <circleGeometry args={[0.046, 16]} />
          <meshStandardMaterial
            color={LAMP_BULB_COLOUR}
            emissive={LAMP_BULB_COLOUR}
            emissiveIntensity={1.6}
            roughness={0.3}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    </group>
  );
}

// Left of the door, not right — the right side is where `SandFloor.tsx`'s
// rock sits (`decor-svg/sand-top.svg`'s own "near the rock" note), and a
// first pass here sat close enough to it to read as swallowed by its
// shadow rather than as its own distinct fixture.
// z=0.85, not flush against the wall — a lamp planted right at a vertical
// surface's own base aims almost straight up it, grazing the face at a
// steep angle a Lambertian surface barely lights, while the merlon tops'
// near-horizontal, top-facing surfaces catch that same near-vertical ray
// far better. Standing the fixture out from the wall, the way a real
// landscape uplight actually would be, gives the ray a real forward
// component into the face it's meant to light, not just an upward one.
// x=-0.85, not -0.55 — same door-widened reasoning as `ArrowSlit`'s own
// comment below: the door now spans ±0.65, so -0.55 would plant the lamp
// inside the opening instead of on the sand beside it.
const LIGHT_PROP_POSITION: [number, number, number] = [-0.85, 0.03, 0.85];
// x=-0.925, not -0.35 — the doorway itself is clear space out to
// ±CASTLE_DOOR_HALF_WIDTH (0.65), so a target inside that span aims into
// the opening rather than the wall beside it; -0.925 lands at the centre
// of the actual left wall segment (which spans -1.2 to -0.65), above the
// lamp. y=0.75, not up near the crown (1.4) — a target that high puts the
// brightest part of the cone right at the merlon/crown edge instead of
// the flat wall, and a nearby round prop (roughness 0.4, glossy enough
// for a highlight a diffuse flat surface wouldn't show) can read as "the
// wall lighting up" on its own. 0.75 sits in a plain flat stretch of
// wall with no round prop nearby to fake it.
const LIGHT_PROP_TARGET: [number, number, number] = [-0.925, 0.75, 0.29];

// Intensity at `light_intensity`'s default 100% — the value tuning
// converged on before that setting existed. Setup's slider scales this,
// not an absolute unit.
const GROUND_UPLIGHT_BASE_INTENSITY = 25;

/** A ground-level flood uplight, genuinely originating from `LightProp`'s
 * lens and aimed up the wall — not a light floating in space with no
 * visible source. `target` is a plain `Object3D` rather than a position
 * tuple because `SpotLight`'s own `target` property must be a scene
 * object, not a vector; set imperatively once both light and target refs
 * exist. Wide angle/penumbra and a real intensity margin over the tank-
 * wide LED strip's own ambient wash — a "flood," not a tight pin-spot. */
function GroundUplight() {
  // Setup's own intensity slider (JarSettings.light_intensity, a 0-200%
  // scale) — a separate knob from the tank-wide LED strip's light_on/
  // light_colour, since this fixture is always on regardless of that
  // toggle.
  const intensityPercent = useJarStore((s) => s.settings.light_intensity);
  // Not memoized: `aimFixture` is a handful of vector ops on module-level
  // constants, called once per render of a component that itself only
  // renders once — too cheap to be worth `useMemo`, and memoizing it with
  // an empty dependency array bit us live during tuning: editing
  // `LIGHT_PROP_POSITION`/`LIGHT_PROP_TARGET` silently didn't recompute
  // this under Fast Refresh (the memo survives HMR since the component
  // instance itself isn't remounted), making several rounds of on-screen
  // verification compare against a stale aim without either of us
  // realizing it.
  const { quaternion, lensPosition } = aimFixture(
    LIGHT_PROP_POSITION,
    LIGHT_PROP_TARGET,
    LAMP_BARREL_LENGTH,
  );
  const lightRef = useRef<THREE.SpotLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);
  useEffect(() => {
    if (lightRef.current && targetRef.current) {
      lightRef.current.target = targetRef.current;
    }
  }, []);
  return (
    <>
      <LightProp position={LIGHT_PROP_POSITION} quaternion={quaternion} />
      {/* No castShadow: this light's own source sits essentially at the
          surface of `LightProp`'s barrel mesh (deliberately, for the
          "light genuinely comes from the lens" effect) — with shadows
          on, that mesh immediately self-shadows its own light out
          almost entirely. This fixture is a small accent, not a primary
          shadow-casting light — the scene's directionalLight already
          owns real shadows (§8.1's own note). */}
      <spotLight
        ref={lightRef}
        position={[lensPosition.x, lensPosition.y, lensPosition.z]}
        color="#ffe9bd"
        intensity={GROUND_UPLIGHT_BASE_INTENSITY * (intensityPercent / 100)}
        angle={0.7}
        penumbra={0.5}
        distance={3}
      />
      <object3D ref={targetRef} position={LIGHT_PROP_TARGET} />
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
      {/* x=±0.9, not ±0.55 — `decorLayout.ts`'s `CASTLE_DOOR_HALF_WIDTH`
          is 0.65, so ±0.55 would sit inside the door opening instead of
          on the solid wall beside it. ±0.9 lands near the centre of each
          wall segment, which spans ±0.65 to ±1.2. */}
      <ArrowSlit position={[-0.9, 1.0, 0.29]} />
      <ArrowSlit position={[0.9, 1.0, 0.29]} />
      <Flag position={[0, 2.0, 0]} />
      <GroundUplight />
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
