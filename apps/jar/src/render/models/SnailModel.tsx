// Extruded vector snail model (issue #98) — the hand-authored SVG
// silhouettes in `snail-svg/` (parsed and cached once by `snailGeometry.ts`)
// mirror `FishModel.tsx`'s own technique exactly: no rigged mesh, a flat
// shell/foot/eyestalk assembly that flexes via GPU vertex shaders instead of
// a skeleton. Shell type and pattern are gene-driven per `ShellType`/
// `Pattern`; hue lives on the shell, the foot gets a heavily-desaturated tint
// of the same hue plus a vertex-colour sole gradient (the snail's belly
// gradient). This is the presentation component only — `tuckProgress`/
// `tuckMode` are driven by PR 6's `Snail.tsx` controller (not built yet);
// here they're plain props so this component has no state-machine
// dependency of its own.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import type { Critter } from '../../domain/protocol/generated/Critter';
import type { Pattern } from '../../domain/protocol/generated/Pattern';
import type { ShellType } from '../../domain/protocol/generated/ShellType';
import { lifeStageScale } from '../../domain/simConstants';
import {
  attachFootRippleDepthMaterial,
  attachFootRippleVertexShader,
  setFootRippleUniforms,
} from './footRippleShader';
import {
  createFootGeometry,
  EYESTALK_FOLD_ROTATION_Z,
  EYESTALK_GEOMETRY,
  EYESTALK_EYE,
  EYESTALK_HINGE,
  FOOT_SOLE_GRADIENT_HEIGHT,
  OPERCULUM_EXTRUSION_DEPTH,
  paintSoleGradient,
  SHELL_ASSETS,
  SHELL_EXTRUSION_DEPTH,
  SHELL_SEALED_DROP,
  SOLE_Y,
  SVG_SCALE,
  tuckPoseForMode,
} from './snailGeometry';
import { wrapInPivot } from './svgExtrude';

interface SnailModelProps {
  critter: Critter;
  /** Holds the model at its rest (fully emerged) pose instead of animating —
   * same rationale as `FishModel`'s own `still`: a passed critter's
   * memorial preview should read as "a picture of them," not a frozen
   * mid-tuck glitch. */
  still?: boolean;
  /** Normalized position on the tuck timeline: `0` fully awake/emerged, `1`
   * fully sealed. Driven every frame by the future `Snail.tsx` controller
   * (PR 6); defaults to `0` (fully emerged) for callers with no sleep state
   * of their own (`CritterPreview.tsx`). */
  tuckProgress?: number;
  /** `'startle'` runs the identical rig but never opens the operculum (issue
   * #98: "the identical rig, shorter run, no operculum phase") — the caller
   * is still responsible for driving a shorter `tuckProgress` excursion;
   * this only changes whether progress past the foot-withdrawal window can
   * seal the shell. Defaults to `'sleep'`. */
  tuckMode?: 'sleep' | 'startle';
}

/** Eyestalk sway — independent per stalk (its own phase offset) so the pair
 * doesn't move in lockstep, mirroring why `FishModel.tsx` seeds a random
 * `phaseSeed` per fish. Slow and modest: a snail's stalks drift, they don't
 * flutter like a fish's pectorals. */
const EYE_SWAY_AMPLITUDE = 0.12;
const EYE_SWAY_FREQUENCY = 0.6;
const EYE_SWAY_FAR_PHASE_OFFSET = 1.1;

/** Pivot z-offset for the mirrored eyestalk pair (the fish's pectoral pivot
 * is offset ±7; the eyestalks are a smaller, closer-set pair). */
const EYESTALK_Z_OFFSET = 4;

/** Stalks don't merely lie down on the way in — they invert into the head
 * and disappear, the way a real snail's tentacles do and the way the foot
 * already shrinks on withdrawal below. The pivot scales about the stalk's
 * own hinge (`wrapInPivot` puts the group there), so it shortens into its
 * base rather than shrinking toward some arbitrary centre, and the eye
 * bulb — a child of that pivot — goes in with it. Retraction rides the
 * back half of the existing `eyestalkFold` window rather than all of it:
 * the fold wants to read as a fold before the stalk starts vanishing.
 * Being a pure function of `eyestalkFold`, it runs in reverse on waking
 * with no separate path. */
const EYESTALK_RETRACT_START = 0.45;

/** Never exactly zero — a zero-scaled node has a singular normal matrix.
 * Far below a pixel at any plausible camera distance. */
const EYESTALK_RETRACT_MIN_SCALE = 0.001;

/** Foot doesn't fully vanish on withdrawal — it shrinks toward the shell,
 * which is what actually hides most of it as the shell settles over the
 * same window (`snailGeometry.ts`'s `tuckPose`). */
const FOOT_WITHDRAW_SCALE = 0.85;

/** Crawl-ripple tuning, exaggerated for legibility rather than biologically
 * literal (project convention) — a slow, clearly-visible travelling bump
 * rather than a subtle one. Tune by eye. */
const FOOT_RIPPLE_SPEED = 1.4;
const FOOT_RIPPLE_WAVELENGTH = 60;
const FOOT_RIPPLE_AMPLITUDE = 6;

/** How far (in raw SVG units) the operculum trapdoor slides from before
 * it's sealed — issue #98's "operculum slides + fades over the last 30%,"
 * the slide distance itself isn't specified there; tune by eye. */
const OPERCULUM_SLIDE_DISTANCE = 16;

const SHELL_SATURATION = 0.62;
const SHELL_LIGHTNESS = 0.5;
/** "Heavily-desaturated hue tint" per issue #98 — the foot still carries the
 * snail's own hue (settled decision, superseding an earlier "stays neutral"
 * option), just far more muted than the shell. */
const FOOT_SATURATION = 0.12;
const FOOT_LIGHTNESS = 0.58;
const SOLE_SATURATION = 0.06;
const SOLE_LIGHTNESS = 0.8;
const DECAL_SATURATION_BOOST = 0.1;
const IDENTITY_DECAL_LIGHTNESS = 0.34;
const PATTERN_DECAL_LIGHTNESS = 0.26;

/** Foot-family horn colours, deliberately *not* the shell hue — issue #98:
 * "a sealed snail still reads as an animal at home, never an empty shell." */
const OPERCULUM_COLOUR = '#8f7a66';
const OPERCULUM_NUCLEUS_COLOUR = '#6f5b47';
/** Same ink as the fish eye (issue #98's own art proposal). */
const EYE_COLOUR = '#22222a';

function createDecalMaterial(colour: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: colour, roughness: 0.7, side: THREE.DoubleSide });
}

export function SnailModel({
  critter,
  still = false,
  tuckProgress = 0,
  tuckMode = 'sleep',
}: SnailModelProps) {
  const footGroupRef = useRef<THREE.Group>(null);
  const eyestalkPivotRef = useRef<THREE.Group>(null);
  const eyestalkFarPivotRef = useRef<THREE.Group>(null);
  const shellGroupRef = useRef<THREE.Group>(null);
  const operculumGroupRef = useRef<THREE.Group>(null);

  const phaseSeed = useMemo(() => Math.random() * Math.PI * 2, []);

  // `shell`/`pattern` never change after birth (SPEC.md §5), same
  // fallback-for-fish-and-gecko convention as `FishModel.tsx`'s `fin`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shellType = useMemo<ShellType>(() => critter.shell ?? 'Coil', []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pattern = useMemo<Pattern>(() => critter.pattern ?? 'Solid', []);

  const scale = lifeStageScale(critter.life_stage) * SVG_SCALE;

  const shellColour = useMemo(
    () => new THREE.Color().setHSL(critter.hue / 360, SHELL_SATURATION, SHELL_LIGHTNESS),
    [critter.hue],
  );
  const footColour = useMemo(
    () => new THREE.Color().setHSL(critter.hue / 360, FOOT_SATURATION, FOOT_LIGHTNESS),
    [critter.hue],
  );
  const soleColour = useMemo(
    () => new THREE.Color().setHSL(critter.hue / 360, SOLE_SATURATION, SOLE_LIGHTNESS),
    [critter.hue],
  );
  const identityDecalColour = useMemo(
    () =>
      new THREE.Color().setHSL(
        critter.hue / 360,
        Math.min(1, SHELL_SATURATION + DECAL_SATURATION_BOOST),
        IDENTITY_DECAL_LIGHTNESS,
      ),
    [critter.hue],
  );
  const patternDecalColour = useMemo(
    () =>
      new THREE.Color().setHSL(
        critter.hue / 360,
        Math.min(1, SHELL_SATURATION + DECAL_SATURATION_BOOST),
        PATTERN_DECAL_LIGHTNESS,
      ),
    [critter.hue],
  );

  const shellAssets = SHELL_ASSETS[shellType];
  const shellDepth = SHELL_EXTRUSION_DEPTH[shellType];
  const operculumDepth = OPERCULUM_EXTRUSION_DEPTH[shellType];
  // The shell silhouette is a solid slab with no literal cutout at the
  // aperture, so the operculum can't sit centred inside it (it would just
  // be buried in solid geometry) — flush-mounting its front face against
  // the shell's own front face, and letting it recede backward from there,
  // is what "tucked inside the aperture rim rather than capping it proud"
  // (issue #98) means in this model's plain-slab geometry.
  const operculumZOffset = shellDepth / 2 - operculumDepth / 2;

  // Per-snail clone: the foot's sole gradient is painted per snail from its
  // own hue, so (like the fish body) it can't be shared read-only.
  const footGeometry = useMemo(() => createFootGeometry(), []);
  useEffect(() => {
    paintSoleGradient(footGeometry, footColour, soleColour);
  }, [footGeometry, footColour, soleColour]);

  const footMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65 }),
    [],
  );
  const rippleParams = useMemo(
    () => ({
      soleY: SOLE_Y,
      envelopeHeight: FOOT_SOLE_GRADIENT_HEIGHT,
      wavelength: FOOT_RIPPLE_WAVELENGTH,
    }),
    [],
  );
  const rippleUniforms = useMemo(
    () => attachFootRippleVertexShader(footMaterial, rippleParams),
    [footMaterial, rippleParams],
  );
  const footDepthMaterial = useMemo(
    () => attachFootRippleDepthMaterial(rippleParams, rippleUniforms),
    [rippleParams, rippleUniforms],
  );

  const eyestalkMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: footColour, roughness: 0.6 }),
    [footColour],
  );
  const eyestalkPivot = useMemo(() => {
    const pivot = wrapInPivot(
      EYESTALK_GEOMETRY,
      eyestalkMaterial,
      EYESTALK_HINGE.x,
      EYESTALK_HINGE.y,
    );
    pivot.position.z = EYESTALK_Z_OFFSET;
    return pivot;
  }, [eyestalkMaterial]);
  const eyestalkFarPivot = useMemo(() => {
    const pivot = wrapInPivot(
      EYESTALK_GEOMETRY,
      eyestalkMaterial,
      EYESTALK_HINGE.x,
      EYESTALK_HINGE.y,
    );
    pivot.position.z = -EYESTALK_Z_OFFSET;
    return pivot;
  }, [eyestalkMaterial]);

  const shellMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: shellColour, roughness: 0.55 }),
    [shellColour],
  );
  const identityDecalMaterial = useMemo(
    () => createDecalMaterial(identityDecalColour),
    [identityDecalColour],
  );
  const patternDecalMaterial = useMemo(
    () => createDecalMaterial(patternDecalColour),
    [patternDecalColour],
  );
  const operculumMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: OPERCULUM_COLOUR,
        roughness: 0.8,
        transparent: true,
      }),
    [],
  );
  const operculumNucleusMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: OPERCULUM_NUCLEUS_COLOUR,
        roughness: 0.8,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    [],
  );

  const patternDecals = pattern === 'Solid' ? [] : shellAssets.patternDecals[pattern];

  // Per-snail geometry clones and manually constructed materials aren't
  // JSX-owned, so R3F never disposes them on its own — same rationale as
  // `FishModel.tsx`'s identical cleanup effect. `SHELL_ASSETS`/
  // `EYESTALK_GEOMETRY` are excluded on purpose: shared read-only across
  // every snail instance.
  useEffect(() => {
    return () => {
      footGeometry.dispose();
      footMaterial.dispose();
      footDepthMaterial.dispose();
      eyestalkMaterial.dispose();
      shellMaterial.dispose();
      identityDecalMaterial.dispose();
      patternDecalMaterial.dispose();
      operculumMaterial.dispose();
      operculumNucleusMaterial.dispose();
    };
  }, [
    footGeometry,
    footMaterial,
    footDepthMaterial,
    eyestalkMaterial,
    shellMaterial,
    identityDecalMaterial,
    patternDecalMaterial,
    operculumMaterial,
    operculumNucleusMaterial,
  ]);

  useFrame((state) => {
    if (still) return;

    const t = state.clock.elapsedTime;
    const pose = tuckPoseForMode(tuckProgress, tuckMode);

    const idleSway = Math.sin(t * EYE_SWAY_FREQUENCY + phaseSeed) * EYE_SWAY_AMPLITUDE;
    const idleSwayFar =
      Math.sin(t * EYE_SWAY_FREQUENCY + phaseSeed + EYE_SWAY_FAR_PHASE_OFFSET) * EYE_SWAY_AMPLITUDE;
    const eyestalkScale = Math.max(
      1 - THREE.MathUtils.smoothstep(pose.eyestalkFold, EYESTALK_RETRACT_START, 1),
      EYESTALK_RETRACT_MIN_SCALE,
    );
    if (eyestalkPivotRef.current) {
      eyestalkPivotRef.current.rotation.z = THREE.MathUtils.lerp(
        idleSway,
        EYESTALK_FOLD_ROTATION_Z,
        pose.eyestalkFold,
      );
      eyestalkPivotRef.current.scale.setScalar(eyestalkScale);
    }
    if (eyestalkFarPivotRef.current) {
      eyestalkFarPivotRef.current.rotation.z = THREE.MathUtils.lerp(
        idleSwayFar,
        EYESTALK_FOLD_ROTATION_Z,
        pose.eyestalkFold,
      );
      eyestalkFarPivotRef.current.scale.setScalar(eyestalkScale);
    }

    if (footGroupRef.current) {
      footGroupRef.current.scale.setScalar(1 - pose.footWithdraw * FOOT_WITHDRAW_SCALE);
    }

    if (shellGroupRef.current) {
      shellGroupRef.current.position.y = -SHELL_SEALED_DROP * pose.shellSettle;
    }

    setFootRippleUniforms(
      rippleUniforms,
      t * FOOT_RIPPLE_SPEED + phaseSeed,
      FOOT_RIPPLE_AMPLITUDE * (1 - pose.footWithdraw),
    );

    operculumMaterial.opacity = pose.operculumSeal;
    operculumNucleusMaterial.opacity = pose.operculumSeal;
    if (operculumGroupRef.current) {
      operculumGroupRef.current.position.y = OPERCULUM_SLIDE_DISTANCE * (1 - pose.operculumSeal);
    }
  });

  return (
    <group scale={scale}>
      <group ref={footGroupRef}>
        <mesh
          geometry={footGeometry}
          material={footMaterial}
          customDepthMaterial={footDepthMaterial}
          castShadow
          receiveShadow
        />
      </group>

      <primitive object={eyestalkPivot} ref={eyestalkPivotRef}>
        <mesh position={[EYESTALK_EYE.x, EYESTALK_EYE.y, 0]}>
          <sphereGeometry args={[EYESTALK_EYE.r, 12, 12]} />
          <meshStandardMaterial color={EYE_COLOUR} roughness={0.4} />
        </mesh>
      </primitive>
      <primitive object={eyestalkFarPivot} ref={eyestalkFarPivotRef}>
        <mesh position={[EYESTALK_EYE.x, EYESTALK_EYE.y, 0]}>
          <sphereGeometry args={[EYESTALK_EYE.r, 12, 12]} />
          <meshStandardMaterial color={EYE_COLOUR} roughness={0.4} />
        </mesh>
      </primitive>

      <group ref={shellGroupRef}>
        <mesh geometry={shellAssets.base} material={shellMaterial} castShadow receiveShadow />

        {shellAssets.identityDecals.map((decal) => (
          <group key={decal.id}>
            <mesh
              geometry={decal.geometry}
              material={identityDecalMaterial}
              position={[0, 0, shellDepth / 2 + 0.3]}
              castShadow
            />
            <mesh
              geometry={decal.geometry}
              material={identityDecalMaterial}
              position={[0, 0, -(shellDepth / 2 + 0.3)]}
              castShadow
            />
          </group>
        ))}

        {patternDecals.map((decal) => (
          <group key={decal.id}>
            <mesh
              geometry={decal.geometry}
              material={patternDecalMaterial}
              position={[0, 0, shellDepth / 2 + 0.4]}
              castShadow
            />
            <mesh
              geometry={decal.geometry}
              material={patternDecalMaterial}
              position={[0, 0, -(shellDepth / 2 + 0.4)]}
              castShadow
            />
          </group>
        ))}

        <group ref={operculumGroupRef} position={[0, 0, operculumZOffset]}>
          <mesh geometry={shellAssets.operculum} material={operculumMaterial} castShadow />
          <mesh
            geometry={shellAssets.operculumNucleus}
            material={operculumNucleusMaterial}
            position={[0, 0, operculumDepth / 2 + 0.3]}
          />
          <mesh
            geometry={shellAssets.operculumNucleus}
            material={operculumNucleusMaterial}
            position={[0, 0, -(operculumDepth / 2 + 0.3)]}
          />
        </group>
      </group>
    </group>
  );
}
