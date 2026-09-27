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
import { footDeformation } from './footDeformation';
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
  FOOT_TOE_X,
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
import { headMountTransform } from './snailFootRig';
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

/** The shell mount's own secondary motion (issue #112) — a genuine mass-
 * spring-damper, not just an eased follow, chasing `gaitRef`'s own
 * `stretch` signal (already a smoothed acceleration proxy) with its own lag
 * and overshoot, so the shell settles a visible beat behind the foot's own
 * motion rather than moving in perfect lockstep with it. `STIFFNESS`/
 * `DAMPING` are picked for a couple of clearly visible wobbles before
 * settling (damping ratio ≈0.47 — underdamped, not a dead thud) at a normal
 * frame delta; tune by eye alongside the position/tilt scales, which stay
 * deliberately small ("should be felt, not seen" — the same restraint issue
 * #112's own design notes call for on this layer specifically). Damping is
 * applied as `Math.exp(-DAMPING * delta)` (below), not the codebase's more
 * common `1 - rate * delta` linear form — that form goes negative (and gets
 * clamped to exactly zero, killing the spring's velocity outright rather
 * than just damping it) for any `delta ≥ 1 / DAMPING`; the exponential form
 * stays positive for every delta, matching every other frame-rate-
 * independent decay in this codebase (`SteeringSystem.tsx`'s heading slerp,
 * `Snail.tsx`'s own smoothed-speed easing). */
const SHELL_SPRING_STIFFNESS = 40;
const SHELL_SPRING_DAMPING = 6;
const SHELL_SPRING_POSITION_SCALE = 3;
const SHELL_SPRING_TILT_SCALE = 0.08;

/** The eyestalks ride the same spring signal as the shell (not a second,
 * independent spring) — a snail's whole forebody sways together, not the
 * shell and the head each settling on their own separate schedule. Smaller
 * than the shell's own tilt scale: the stalks are far lighter than the
 * shell, so they should read as *following* its wobble, not matching it. */
const EYESTALK_SPRING_TILT_SCALE = 0.15;

/** Eyestalk sway — independent per stalk (its own phase offset) so the pair
 * doesn't move in lockstep, mirroring why `FishModel.tsx` seeds a random
 * `phaseSeed` per fish. Slow and modest: a snail's stalks drift, they don't
 * flutter like a fish's pectorals. */
const EYE_SWAY_AMPLITUDE = 0.12;
const EYE_SWAY_FREQUENCY = 0.6;
const EYE_SWAY_FAR_PHASE_OFFSET = 1.1;

/** The foot's head bone's own authored rest position (`snailGeometry.ts`
 * chains the bones along the sole line, the toe-most at `FOOT_TOE_X`) —
 * what `headMountTransform` divides out so the eyestalks below keep their
 * own authored coordinates while riding that bone. */
const EYESTALK_MOUNT_REST = new THREE.Vector3(FOOT_TOE_X, SOLE_Y, 0);

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
  const footMeshRef = useRef<THREE.SkinnedMesh>(null);
  const eyestalkMountRef = useRef<THREE.Group>(null);
  const eyestalkPivotRef = useRef<THREE.Group>(null);
  const eyestalkFarPivotRef = useRef<THREE.Group>(null);
  const shellGroupRef = useRef<THREE.Group>(null);
  const operculumGroupRef = useRef<THREE.Group>(null);

  // The shell's own secondary-motion spring state — position and velocity
  // of a one-dimensional mass-spring-damper chasing `gaitRef`'s `stretch`
  // signal (see `SHELL_SPRING_STIFFNESS`'s own doc comment).
  const shellSpringRef = useRef({ position: 0, velocity: 0 });

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

  // The bone chain the foot mesh skins to — created at rest, so an undriven
  // instance (`CritterPreview.tsx`) renders pixel-identical to the plain rigid
  // mesh it replaced; `Snail.tsx` drives it per frame off the crawl spine.
  // `bones[0]` (the root) mounts as a *sibling* of the mesh below — see that
  // JSX's own comment for what has to stay true of both their ancestors.
  const footBones = useMemo(() => createFootBones(), []);
  const footSkeleton = useMemo(() => new THREE.Skeleton(footBones), [footBones]);
  useLayoutEffect(() => {
    // `Skeleton`'s inverse bind matrices are derived from each bone's
    // current `matrixWorld` the moment `bind()` runs — R3F mounts
    // `<primitive object={footBones[0]}>` synchronously during commit, but
    // matrixWorld propagation itself only happens on the next render tick
    // unless forced here, so this must run before `bind()`, not after it.
    // The mesh's own `matrixWorld` needs the identical treatment: `bind()`'s
    // default `bindMatrix` argument (used when none is passed explicitly,
    // as here) is `this.matrixWorld` exactly as it stands at that instant —
    // still identity, pre-propagation, if left unforced. That desyncs the
    // mesh's own bind reference from the bones' correctly-forced one, and
    // every skinned vertex reads the mismatch: normally an invisible
    // one-frame flicker, but a grossly oversized, mispositioned render for
    // as long as a render pause lands right after mount (the window losing
    // focus, most visibly) freezes that bad frame on screen.
    footBones[0]!.updateWorldMatrix(true, true);
    footMeshRef.current?.updateWorldMatrix(true, false);
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
      stretchAnchorX: FOOT_TOE_X,
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

  useFrame((state, delta) => {
    if (still) return;

    const t = state.clock.elapsedTime;
    const pose = tuckPoseForMode(tuckProgress, tuckMode);

    // The eyestalks are head parts, so they ride the foot's head bone
    // rather than the model group, which the RigidBody anchors at the
    // shell's seat — see `headMountTransform`. This group carries the
    // rest-to-current mapping alone, leaving both pivots (and the sway,
    // fold and retract below) on their own authored coordinates.
    if (eyestalkMountRef.current) {
      headMountTransform(
        footBones,
        EYESTALK_MOUNT_REST,
        eyestalkMountRef.current.position,
        eyestalkMountRef.current.quaternion,
      );
    }

    // The shell's own secondary-motion spring (issue #112) — a genuine
    // mass-spring-damper chasing `gaitRef`'s `stretch` signal, integrated
    // with a plain semi-implicit Euler step (stable enough at this
    // stiffness/timestep; nothing here needs a fancier integrator). Reused
    // by the eyestalks below at their own, smaller scale, rather than
    // running a second independent spring.
    const springTarget = gaitRef?.current.stretch ?? 0;
    const spring = shellSpringRef.current;
    spring.velocity += (springTarget - spring.position) * SHELL_SPRING_STIFFNESS * delta;
    spring.velocity *= Math.exp(-SHELL_SPRING_DAMPING * delta);
    spring.position += spring.velocity * delta;

    const idleSway = Math.sin(t * EYE_SWAY_FREQUENCY + phaseSeed) * EYE_SWAY_AMPLITUDE;
    const idleSwayFar =
      Math.sin(t * EYE_SWAY_FREQUENCY + phaseSeed + EYE_SWAY_FAR_PHASE_OFFSET) * EYE_SWAY_AMPLITUDE;
    const eyestalkScale = Math.max(
      1 - THREE.MathUtils.smoothstep(pose.eyestalkFold, EYESTALK_RETRACT_START, 1),
      EYESTALK_RETRACT_MIN_SCALE,
    );
    const eyestalkSpringTilt = spring.position * EYESTALK_SPRING_TILT_SCALE;
    if (eyestalkPivotRef.current) {
      eyestalkPivotRef.current.rotation.z =
        THREE.MathUtils.lerp(idleSway, EYESTALK_FOLD_ROTATION_Z, pose.eyestalkFold) +
        eyestalkSpringTilt;
      eyestalkPivotRef.current.scale.setScalar(eyestalkScale);
    }
    if (eyestalkFarPivotRef.current) {
      eyestalkFarPivotRef.current.rotation.z =
        THREE.MathUtils.lerp(idleSwayFar, EYESTALK_FOLD_ROTATION_Z, pose.eyestalkFold) +
        eyestalkSpringTilt;
      eyestalkFarPivotRef.current.scale.setScalar(eyestalkScale);
    }

    if (shellGroupRef.current) {
      shellGroupRef.current.position.y = -SHELL_SEALED_DROP * pose.shellSettle;
      // Secondary motion (issue #112): the spring's own position becomes a
      // small shift along local `+X` (the model's authored-forward axis)
      // plus a matching tilt, layered on top of the sleep/wake settle
      // above rather than replacing it — the shell visibly lags/overshoots
      // as the body starts and stops, instead of moving in lockstep.
      shellGroupRef.current.position.x = spring.position * SHELL_SPRING_POSITION_SCALE;
      shellGroupRef.current.rotation.z = spring.position * SHELL_SPRING_TILT_SCALE;
    }

    // `gaitRef`'s own phase already only advances while genuinely crawling
    // (`Snail.tsx` owns that gate) — falling back to a plain wall-clock
    // oscillation when undriven (`CritterPreview.tsx`) keeps that panel's
    // idle "gently crawling in place" read, the same role a stationary
    // Yuka vehicle plays for `FishModel`'s own idle swim.
    const ripplePhase = (gaitRef ? gaitRef.current.phase : t * FOOT_RIPPLE_SPEED) + phaseSeed;
    // Withdrawal and squash-and-stretch reach the foot as uniforms, not as a
    // transform on any node above the mesh: the foot is a `SkinnedMesh`, and
    // three's default `AttachedBindMode` divides the mesh's own world matrix
    // straight back out of the skinning result, so an ancestor scale is
    // cancelled before it can move a single vertex (`footDeformation.ts`).
    setFootRippleUniforms(
      rippleUniforms,
      ripplePhase,
      FOOT_RIPPLE_AMPLITUDE * (1 - pose.footWithdraw),
      footDeformation(pose.footWithdraw, gaitRef?.current.stretch ?? 0),
    );

    operculumMaterial.opacity = pose.operculumSeal;
    operculumNucleusMaterial.opacity = pose.operculumSeal;
    if (operculumGroupRef.current) {
      operculumGroupRef.current.position.y = OPERCULUM_SLIDE_DISTANCE * (1 - pose.operculumSeal);
    }
  });

  return (
    <group scale={scale}>
      {/* The bone chain mounts as a *sibling* of the foot mesh, both directly
          under this one static outer group, and nothing between either of
          them and the scene root ever carries a per-frame transform.

          That's not just tidiness. A bone's own `matrixWorld` is what the
          skinning maths measures against its bind pose, and this outer
          group's uniform life-stage scale is the only thing the rig
          (`snailFootRig.ts`) divides back out when it projects world-space
          spine samples into bone-local space — so any further transform
          above the chain would put the whole foot somewhere other than on
          the crawl surface the spine sampled. The mesh side is the mirror
          image: an `AttachedBindMode` `SkinnedMesh` cancels its own
          `matrixWorld` out of the skinning result entirely, so a transform
          placed above the mesh alone does nothing at all. Deformation of the
          foot therefore belongs in neither place — it happens inside the
          vertex shader, ahead of skinning (`footDeformation.ts`,
          `footRippleShader.ts`). */}
      <primitive object={footBones[0]!} />
      <skinnedMesh
        ref={footMeshRef}
        geometry={footGeometry}
        material={footMaterial}
        customDepthMaterial={footDepthMaterial}
        castShadow
        receiveShadow
        // The rig deforms well beyond the rest geometry's own bounding box —
        // both the bend and the shader's own displacement — and three.js
        // can't know that from a SkinnedMesh's static geometry bounds, so
        // culling stays off rather than letting a snail flicker at the edge
        // of the camera frustum.
        frustumCulled={false}
      />

      <group ref={eyestalkMountRef}>
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
      </group>

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
