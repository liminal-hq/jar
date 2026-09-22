// One fish: a Rapier `RigidBody` (physical truth) driven by a Yuka vehicle
// (steering) via `SteeringSystem`'s per-frame sync, presenting a
// `FishModel`. See `docs/architecture/3d-engine.md` §3's ownership table —
// this component is the concrete realization of that table's "per-critter
// runtime split" for one fish.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useFrame } from '@react-three/fiber';
import { BallCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import * as YUKA from 'yuka';

import { useDayNightOverride } from '../../domain/devSettings';
import { useJarStore } from '../../domain/jarClient';
import type { Critter } from '../../domain/protocol/generated/Critter';
import { selectCritter } from '../../domain/selection';
import { lifeStageScale } from '../../domain/simConstants';
import { FishModel } from '../models/FishModel';
import { MALE_TAIL_SCALE, SVG_SCALE, TAIL_TIP_SVG_DISTANCE } from '../models/fishGeometry';
import { simPercentToWorld, WALL_THICKNESS } from '../physics/coordinates';
import type { FishMotionMode } from '../steering/motionState';
import { useSteeringRegistry, type FishDebugAnim } from '../steering/SteeringSystem';
import { useFishSteering } from '../steering/useFishSteering';

/** A loose bounding sphere around `FishModel`'s combined body/tail/eye
 * geometry at scale 1, hand-picked rather than derived from the mesh —
 * collision doesn't need to trace the model precisely for a creature this
 * small, and a manual sphere sidesteps `colliders="hull"` entirely: its
 * automatic hull generation was producing a malformed collider from the
 * model's nested tail-pivot group, launching fish out of the tank on their
 * very first physics step.
 *
 * Sized from the tail tip, not the nose or body — `TAIL_TIP_SVG_DISTANCE`
 * is always the model's farthest point from its own origin, further out
 * than the nose in every fin type. A flat radius here (as this used to be)
 * undersizes it for a male and/or a Veil-tailed fish badly enough that the
 * tail visibly pokes through the glass or the sand while the RigidBody's
 * centre, which is all a `BallCollider` actually constrains, stays legally
 * inside — exactly the "fish swims through the wall" bug this fixes. */
function colliderRadiusFor(critter: Critter): number {
  const finType = critter.fin ?? 'Forked';
  const tailScale = critter.sex === 'Male' ? MALE_TAIL_SCALE : 1;
  return (
    TAIL_TIP_SVG_DISTANCE[finType] * SVG_SCALE * tailScale * lifeStageScale(critter.life_stage)
  );
}

/** Same tail-tip sizing as `colliderRadiusFor`, but always at this fish's
 * eventual adult/elder scale (`lifeStageScale` maxes out at `1`) rather
 * than its current age — used anywhere the result gets fixed once at
 * spawn/mount and can't react to the fish growing later: `spotClearance`
 * below (`favourite_spot` is rolled once at spawn and never revisited,
 * `rust-core.md` §6.4, so the clearance reserved around it has to stay
 * clear of whatever size this fish will grow into) and `useFishSteering`'s
 * containment margin (fixed once at mount). A fry-sized reservation would
 * leave an adult's much larger collider overlapping the wall/glass by the
 * time it actually gets there. */
function maxColliderRadiusFor(critter: Critter): number {
  const finType = critter.fin ?? 'Forked';
  const tailScale = critter.sex === 'Male' ? MALE_TAIL_SCALE : 1;
  return TAIL_TIP_SVG_DISTANCE[finType] * SVG_SCALE * tailScale;
}

interface FishProps {
  critter: Critter;
  livingPopulation: number;
}

/** SPEC.md §5 / `docs/architecture/3d-engine.md` §4.1: ~30% of the time a
 * wander cycle resolves, redirect to the favourite spot instead (or, per
 * `params.pauseChance`, take a brief rest instead) — a periodic roll (every
 * 8-15s) rather than hooking Yuka's per-cycle wander-circle-update event
 * directly. */
const ROLL_MIN_MS = 8000;
const ROLL_MAX_MS = 7000;
const ARRIVE_CHANCE = 0.3;
const ARRIVE_TOLERANCE = 0.3;
const ARRIVE_TIMEOUT_SEC = 20;
/** Night settling gets a much longer leash than the daytime "visit the
 * favourite spot" roll — a fish caught mid-tank when night falls (rather
 * than mid-cycle at a random moment) may have further to travel, and
 * there's no rush; it should still eventually give up and settle wherever
 * it ends up rather than swim forever. */
const NIGHT_SETTLE_TIMEOUT_SEC = 30;
const PAUSE_MIN_MS = 2000;
const PAUSE_MAX_MS = 3000;

export function Fish({ critter, livingPopulation }: FishProps) {
  const rigidBodyRef = useRef<RapierRigidBody>(null);
  const registry = useSteeringRegistry();

  // How much room this fish's eventual adult-sized collider (plus the wall
  // collider's own half-thickness) needs reserved inside
  // `TANK_INNER_BOUNDS` — see `simPercentToWorld`'s own comment for why
  // mapping onto that bound alone still lets a fish's collider overlap the
  // wall, and `maxColliderRadiusFor`'s own comment for why this has to be
  // the fish's eventual size, not its size at spawn.
  const spotClearance = useMemo(
    () => WALL_THICKNESS / 2 + maxColliderRadiusFor(critter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const favouriteSpotWorld = useMemo(() => {
    const p = simPercentToWorld(
      critter.favourite_spot.x,
      critter.favourite_spot.y,
      critter.favourite_spot.z,
      spotClearance,
    );
    return new YUKA.Vector3(p.x, p.y, p.z);
    // Favourite spot never changes after spawn (rust-core.md §6.4) — no
    // need to react to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const spawnPosition = useMemo(
    () =>
      simPercentToWorld(
        critter.favourite_spot.x,
        critter.favourite_spot.y,
        critter.favourite_spot.z,
        spotClearance,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Fixed once at spawn, same rationale as `favouriteSpotWorld`/
  // `spawnPosition` above — this fish's `fin`/`sex` never change, so its
  // eventual max collider size doesn't either.
  const maxColliderRadius = useMemo(
    () => maxColliderRadiusFor(critter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const steering = useFishSteering(
    critter.personality,
    livingPopulation,
    favouriteSpotWorld,
    maxColliderRadius,
  );

  // Authoritative — pushed by the sim core on every `TickUpdate`
  // (`jarClient.ts`'s `isNight` store field) rather than re-derived here.
  const simNight = useJarStore((s) => s.isNight);
  // Dev-only override (`windows/FishMonitor/FishMonitorWindow.tsx`) to pin
  // day or night on demand rather than wait out a real day/night cycle —
  // `'auto'` (the real jar clock) in production builds, where the toggle
  // can't be set.
  const dayNightOverride = useDayNightOverride();
  const night = dayNightOverride === 'auto' ? simNight : dayNightOverride === 'night';
  const nightRef = useRef(night);
  const debugAnimRef = useRef<FishDebugAnim | null>(null);
  useEffect(() => {
    nightRef.current = night;
  }, [night]);

  const modeRef = useRef<FishMotionMode>('active');
  const setMode = (mode: FishMotionMode) => {
    modeRef.current = mode;
    steering.setMode(mode);
  };

  useEffect(() => {
    // Seed both heading quaternions from the body's actual spawn rotation
    // (rather than identity) so a freshly-spawned fish doesn't visibly snap
    // to its first commanded heading — it slerps from wherever it already
    // faces, same as it will for every turn after.
    const spawnRotation = rigidBodyRef.current?.rotation() ?? { x: 0, y: 0, z: 0, w: 1 };
    const currentHeading = new THREE.Quaternion(
      spawnRotation.x,
      spawnRotation.y,
      spawnRotation.z,
      spawnRotation.w,
    );
    registry.set(critter.id, {
      vehicle: steering.vehicle,
      getBody: () => rigidBodyRef.current,
      maxSpeed: () => steering.maxSpeedFor(critter.energy),
      getMode: () => modeRef.current,
      currentHeading,
      targetHeading: currentHeading.clone(),
      isHeadingActive: false,
      getDebugAnim: () => debugAnimRef.current,
      hue: critter.hue,
    });
    return () => {
      registry.delete(critter.id);
    };
    // `critter.energy` is read imperatively via the closure below on every
    // frame `SteeringSystem` calls `maxSpeed()` — no need to re-register
    // when it ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, critter.id, steering]);

  // Night falling/lifting overrides whatever the daytime roll below was
  // doing — settle in (arrive-only, per §4.1) when night starts, resume
  // when day returns (but only if we're not already back to `active` on
  // our own, e.g. a night that fell and lifted between two daytime rolls
  // without this fish ever having reached `settling`/`settled`).
  useEffect(() => {
    if (night) {
      settleElapsedRef.current = 0;
      setMode('settling');
    } else if (modeRef.current === 'settling' || modeRef.current === 'settled') {
      setMode('active');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [night]);

  // Drives both the daytime "visit the favourite spot" roll and night
  // settling to their conclusion: ends `settling` once close enough to the
  // favourite spot, or after a timeout so a fish can never get stuck
  // swimming toward it forever. Night settling gets a longer timeout and
  // lands on `settled` (stays until day); a daytime visit lands back on
  // `active`. Ordinary default-priority `useFrame` — safe alongside
  // `SteeringSystem`'s own, since neither passes a render-priority argument
  // (see that file's header for why that distinction matters with R3F v8).
  const settleElapsedRef = useRef(0);
  useFrame((_, delta) => {
    // Fades wander/separation/arrive toward whatever `setMode` last
    // targeted, every frame and every mode — not just while settling. See
    // `useFishSteering.ts`'s `BEHAVIOR_WEIGHT_RAMP_RATE` comment for why an
    // instant behavior-set flip was the actual cause of fish visibly
    // "shaking" for a moment at every night settle/wake transition.
    steering.rampWeights(delta);

    if (modeRef.current !== 'settling') return;
    settleElapsedRef.current += delta;
    const distance = steering.vehicle.position.distanceTo(favouriteSpotWorld);
    const timeout = nightRef.current ? NIGHT_SETTLE_TIMEOUT_SEC : ARRIVE_TIMEOUT_SEC;
    if (distance < ARRIVE_TOLERANCE || settleElapsedRef.current > timeout) {
      setMode(nightRef.current ? 'settled' : 'active');
    }
  });

  useEffect(() => {
    let cancelled = false;
    let pauseTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const scheduleNext = () => {
      const delay = ROLL_MIN_MS + Math.random() * ROLL_MAX_MS;
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        // Only roll while genuinely idle-and-active during the day — a
        // fish already settling/settled/paused (or mid-night) shouldn't
        // have this roll layer a second transition on top.
        if (!nightRef.current && modeRef.current === 'active') {
          if (Math.random() < steering.params.pauseChance) {
            setMode('paused');
            const pauseDuration = PAUSE_MIN_MS + Math.random() * PAUSE_MAX_MS;
            pauseTimeoutId = setTimeout(() => {
              if (!cancelled && modeRef.current === 'paused') setMode('active');
            }, pauseDuration);
          } else if (Math.random() < ARRIVE_CHANCE) {
            settleElapsedRef.current = 0;
            setMode('settling');
          }
        }
        scheduleNext();
      }, delay);
    };
    let timeoutId = setTimeout(scheduleNext, 0);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      clearTimeout(pauseTimeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steering]);

  return (
    <RigidBody
      ref={rigidBodyRef}
      position={[spawnPosition.x, spawnPosition.y, spawnPosition.z]}
      colliders={false}
      gravityScale={0}
      linearDamping={2.5}
      // Rotation is exclusively script-authored (`SteeringSystem.tsx`'s
      // `setRotation` every frame) — locking all three axes here stops
      // wall/fish collisions from injecting spin between those writes.
      // `angularDamping` doesn't apply now: it only damps physics-driven
      // spin, and there is none once rotation is locked.
      enabledRotations={[false, false, false]}
    >
      <BallCollider args={[colliderRadiusFor(critter)]} />
      <group
        // `SteeringSystem.tsx` computes the RigidBody's heading assuming
        // local +Z is forward (`docs/architecture/3d-engine.md` §6.2's own
        // "must line up exactly... or every fish will swim backwards"
        // warning) — but the vector-fish model is authored facing +X
        // (`fish-svg/body.svg`'s header comment). This fixed −90° yaw is
        // the one-time correction: it rotates the model's local +X nose
        // onto the RigidBody's own +Z, so the two conventions agree
        // without touching every mesh inside `FishModel`.
        rotation={[0, -Math.PI / 2, 0]}
        onClick={(e) => {
          // Stops propagation to other intersected R3F objects, but not
          // the underlying native DOM click — that would still bubble to
          // the canvas's own click handler (TankWindow.tsx's drawer
          // toggle) without also stopping it there.
          e.stopPropagation();
          e.nativeEvent.stopPropagation();
          void selectCritter(critter.id);
        }}
      >
        <FishModel
          critter={critter}
          vehicle={steering.vehicle}
          getMode={() => modeRef.current}
          onDebugFrame={(anim) => {
            debugAnimRef.current = anim;
          }}
        />
      </group>
    </RigidBody>
  );
}
