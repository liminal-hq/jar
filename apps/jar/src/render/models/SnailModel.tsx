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
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
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
  addFootSkinAttributes,
  createFootBones,
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
  SNAIL_BODY_SCALE,
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
  /** Hands the caller the foot's own bone chain once it's created, so a
   * real controller (`Snail.tsx`, issue #112's bend-wiring PR) can drive
   * each bone's rotation imperatively every frame without this component
   * re-rendering — the same "own the objects, mutate them directly"
   * discipline `positionRef`/`quaternionRef` already use for the RigidBody
   * transform itself. `CritterPreview.tsx`'s undriven usage simply omits
   * this, leaving every bone at its rest (identity) transform. */
  onBonesReady?: (bones: THREE.Bone[]) => void;
  /** A live, mutated-every-frame handoff of the crawl gait — a real ref
   * object, not a value, for the same reason `onBonesReady` uses one: a
   * controller (`Snail.tsx`) updates this every frame without triggering a
   * React re-render, and this component reads `.current` fresh inside its
   * own `useFrame` rather than relying on a prop value that would only ever
   * update on this component's own (rare) re-renders. `phase` couples the
   * foot ripple to the same clock driving the crawl's own speed pulse and
   * the spine's arc-length sampling, so all three read as one gait rather
   * than independent animations; `stretch` drives the whole foot assembly's
   * squash-and-stretch. Omitted (or its `.current` left at the default) for
   * `CritterPreview.tsx`'s undriven usage, which has no real gait to share —
   * the ripple falls back to a plain wall-clock oscillation and the body
   * stays unstretched.
   *
   * Reading `.current` fresh each frame is only correct if `Snail.tsx`'s
   * own `useFrame` (which writes it) has already run *this* frame by the
   * time this component's `useFrame` reads it — true today because R3F
   * runs same-priority callbacks in subscription order, and `Snail.tsx`
   * (the parent, mounting `<SnailModel>` in its own JSX) always subscribes
   * first. Neither call site pins an explicit priority; if one ever does,
   * this ordering assumption needs revisiting alongside it. */
  gaitRef?: { current: SnailGait };
}

/** `phase` in the same units `footRippleShader.ts`'s own phase argument
 * expects (radians, growing over time/distance); `stretch` a signed
 * fraction (`0` = neutral, positive = stretched along the direction of
 * travel, negative = squashed). */
export interface SnailGait {
  phase: number;
  stretch: number;
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
  onBonesReady,
  gaitRef,
}: SnailModelProps) {
  const footGroupRef = useRef<THREE.Group>(null);
  const footMeshRef = useRef<THREE.SkinnedMesh>(null);
  const eyestalkPivotRef = useRef<THREE.Group>(null);
  const eyestalkFarPivotRef = useRef<THREE.Group>(null);
  const shellGroupRef = useRef<THREE.Group>(null);
  const operculumGroupRef = useRef<THREE.Group>(null);

  const phaseSeed = useMemo(() => Math.random() * Math.PI * 2, []);

  // `shell`/`pattern` never change after birth (SPEC.md §5). `shell` keeps
  // a fish/gecko-`None` fallback (mirrors `FishModel.tsx`'s `fin`); `pattern`
  // is always populated now, so it's read directly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shellType = useMemo<ShellType>(() => critter.shell ?? 'Coil', []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pattern = useMemo<Pattern>(() => critter.pattern, []);

  const scale = lifeStageScale(critter.life_stage) * SVG_SCALE * SNAIL_BODY_SCALE;

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
  // own hue, so (like the fish body) it can't be shared read-only. Skin
  // attributes are geometry-shape-derived, not per-snail, but are added
  // here too rather than shared — same per-instance-clone reasoning.
  const footGeometry = useMemo(() => {
    const geometry = createFootGeometry();
    addFootSkinAttributes(geometry);
    return geometry;
  }, []);
  useEffect(() => {
    paintSoleGradient(footGeometry, footColour, soleColour);
  }, [footGeometry, footColour, soleColour]);

  // The bone chain the foot mesh skins to — at rest here (issue #112's PR 6
  // scope; nothing yet drives a per-frame bend), so binding renders
  // pixel-identical to the plain rigid mesh it replaces. `bones[0]` (the
  // root) mounts as a *sibling* of `footGroupRef` below, not a child of it
  // — see that JSX's own comment for why a skinned mesh's bone chain must
  // not share a changing-scale ancestor with the mesh itself.
  const footBones = useMemo(() => createFootBones(), []);
  const footSkeleton = useMemo(() => new THREE.Skeleton(footBones), [footBones]);
  useLayoutEffect(() => {
    // `Skeleton`'s inverse bind matrices are derived from each bone's
    // current `matrixWorld` the moment `bind()` runs — R3F mounts
    // `<primitive object={footBones[0]}>` synchronously during commit, but
    // matrixWorld propagation itself only happens on the next render tick
    // unless forced here, so this must run before `bind()`, not after it.
    footBones[0]!.updateWorldMatrix(true, true);
    footMeshRef.current?.bind(footSkeleton);
  }, [footBones, footSkeleton]);

  useEffect(() => {
    onBonesReady?.(footBones);
    // Deliberately excludes `onBonesReady` itself: a real controller
    // (`Snail.tsx`) passes a fresh inline function every render, and
    // `footBones` only ever changes once (mount) — re-invoking on every
    // caller re-render would hand out the same array repeatedly for no
    // reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [footBones]);

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
      footSkeleton.dispose();
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
    footSkeleton,
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
      const withdrawScale = 1 - pose.footWithdraw * FOOT_WITHDRAW_SCALE;
      // Squash-and-stretch (issue #112) rides this same group, on top of
      // the existing withdrawal scale, rather than any individual bone —
      // every bone in the chain is a *child* of the previous one, so a
      // per-bone scale would compound down the chain (bone 3 ending up
      // stretched by `stretch^3`); this group is a single ancestor of the
      // whole assembly, so its scale only ever applies once. The model is
      // authored facing local `+X` (this group has no rotation of its own
      // to remap that), so `+X` is the stretch axis; `y`/`z` take the full
      // inverse (not the physically-correct square root) for an
      // exaggerated "plump" rather than a subtle one, matching this
      // project's stated preference for exaggeration over accuracy.
      const stretchFactor = 1 + (gaitRef?.current.stretch ?? 0);
      footGroupRef.current.scale.set(
        withdrawScale * stretchFactor,
        withdrawScale / stretchFactor,
        withdrawScale / stretchFactor,
      );
    }

    if (shellGroupRef.current) {
      shellGroupRef.current.position.y = -SHELL_SEALED_DROP * pose.shellSettle;
    }

    // `gaitRef`'s own phase already only advances while genuinely crawling
    // (`Snail.tsx` owns that gate) — falling back to a plain wall-clock
    // oscillation when undriven (`CritterPreview.tsx`) keeps that panel's
    // idle "gently crawling in place" read, the same role a stationary
    // Yuka vehicle plays for `FishModel`'s own idle swim.
    const ripplePhase = (gaitRef ? gaitRef.current.phase : t * FOOT_RIPPLE_SPEED) + phaseSeed;
    setFootRippleUniforms(
      rippleUniforms,
      ripplePhase,
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
      {/* The bone chain is deliberately *not* inside `footGroupRef` — a
          `SkinnedMesh`'s skinning math already bakes in the *change* in
          every shared ancestor's transform between bind time and now (that's
          how a bone's own rotation reaches the mesh at all), so if
          `footGroupRef`'s own scale (withdrawal, and later squash-and-
          stretch) were a shared ancestor of *both* the mesh and this chain,
          that scale would be applied twice: once normally, via the mesh's
          own `matrixWorld`, and a second time via the bone-transform ratio
          picking up the very same change. Sitting here, as a sibling of
          `footGroupRef` under the same static outer group, means the bones'
          own `matrixWorld` never reflects `footGroupRef`'s scale at all —
          the mesh alone carries it, exactly once, through the ordinary
          (non-skinning) transform pipeline. */}
      <primitive object={footBones[0]!} />
      <group ref={footGroupRef}>
        <skinnedMesh
          ref={footMeshRef}
          geometry={footGeometry}
          material={footMaterial}
          customDepthMaterial={footDepthMaterial}
          castShadow
          receiveShadow
          // The rig will actually deform beyond the rest geometry's own
          // bounding box once something drives a bend (issue #112's later
          // PRs) — three.js can't know that from a SkinnedMesh's static
          // geometry bounds, so culling must stay off from the start
          // rather than being remembered as a fast-follow once bending
          // makes a snail flicker at the edge of the camera frustum.
          frustumCulled={false}
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
