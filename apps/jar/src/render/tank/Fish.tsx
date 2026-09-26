// One fish: a Rapier `RigidBody` (physical truth) driven by a Yuka vehicle
// (steering) via `SteeringSystem`'s per-frame sync, presenting a
// `FishModel`. See `docs/architecture/3d-engine.md` §3's ownership table —
// this component is the concrete realization of that table's "per-critter
// runtime split" for one fish.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import * as YUKA from 'yuka';

import { useDayNightOverride } from '../../domain/devSettings';
import { isAsleep } from '../../domain/dayNight';
import { useJarStore } from '../../domain/jarClient';
import type { Critter } from '../../domain/protocol/generated/Critter';
import type { CritterId } from '../../domain/protocol/generated/CritterId';
import { selectCritter } from '../../domain/selection';
import { keepClearOfCastle } from '../environment/decorLayout';
import { FishModel } from '../models/FishModel';
import { simPercentToWorld, WALL_THICKNESS } from '../physics/coordinates';
import {
  burstChanceFor,
  burstMultiplierFor,
  CHASE_CAUGHT_SURFACE_GAP,
  CHASE_EXCLUSION_COOLDOWN_SEC,
  CHASE_MAX_SEC,
  chaseChanceFor,
  rampBurstMultiplier,
  SPONTANEOUS_BURST_SEC,
} from '../steering/chaseParams';
import { selectChaseTarget, type ChaseCandidate } from '../steering/chaseTarget';
import type { FishMotionMode } from '../steering/motionState';
import { isActivelyPiloted } from '../steering/pilotInputState';
import { useSteeringRegistry, type FishDebugAnim } from '../steering/SteeringSystem';
import { breathingMultiplier } from '../steering/steeringParams';
import { thrustMultiplierFor } from '../steering/thrustEnvelope';
import { extractYaw } from '../steering/heading';
import { useFishSteering } from '../steering/useFishSteering';
import { adultColliderHalfExtentsFor, colliderHalfExtentsFor } from './fishCollider';

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
  // wall. Deliberately still the fixed, length-based (worst-orientation)
  // adult extent, not a live yaw-projected value — this reservation is a
  // one-time, orientation-unknown spawn-time nudge (`useFishSteering.ts`'s
  // live containment margin is the one that goes yaw-aware, since it's
  // recomputed every frame and so can actually react to heading).
  const spotClearance = useMemo(
    () => WALL_THICKNESS / 2 + adultColliderHalfExtentsFor(critter).z,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // A fish's own collider radius, nudged clear of the castle's static
  // colliders (`decorLayout.ts`'s `keepClearOfCastle`) — `favourite_spot`
  // is rolled in jar-core, which has no knowledge of decor
  // (`docs/architecture/rust-core.md`'s "no I/O, no render knowledge"
  // sim-core boundary), so nothing upstream can already have avoided the
  // castle. Left un-nudged, a fish whose rolled spot happened to land
  // inside a collider box would mount its RigidBody already
  // interpenetrating it, which Rapier resolves with an immediate
  // pop/launch on the very first physics step. `spawnPosition` and
  // `favouriteSpotWorld` share this one nudged point rather than each
  // computing (and each needing to separately remember to nudge) their
  // own — they're the same point by definition: where the fish starts is
  // where it returns to when it visits its favourite spot.
  const safeFavouriteSpot = useMemo(() => {
    const p = simPercentToWorld(
      critter.favourite_spot.x,
      critter.favourite_spot.y,
      critter.favourite_spot.z,
      spotClearance,
    );
    return keepClearOfCastle(p, adultColliderHalfExtentsFor(critter).z);
    // Favourite spot never changes after spawn (rust-core.md §6.4) — no
    // need to react to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const favouriteSpotWorld = useMemo(
    () => new YUKA.Vector3(safeFavouriteSpot.x, safeFavouriteSpot.y, safeFavouriteSpot.z),
    [safeFavouriteSpot],
  );

  const spawnPosition = safeFavouriteSpot;

  // Fixed once at spawn, same rationale as `favouriteSpotWorld`/
  // `spawnPosition` above — this fish's `fin`/`sex` never change, so its
  // eventual adult collider box doesn't either. `useFishSteering.ts`'s
  // containment/avoidance margins are built from this fixed size, then
  // projected live onto whichever world axis matters by `getYaw` below —
  // a fry swimming inside a still-larger adult-sized margin is the same
  // deliberately-conservative choice the old radius-based margin made.
  const adultHalfExtents = useMemo(
    () => adultColliderHalfExtentsFor(critter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // The behaviours' live-yaw source. `useFishSteering` (next) runs earlier
  // in this component than the registration effect below that creates
  // `currentHeading`, so `getYaw` can't close over that variable directly —
  // it closes over this ref instead, filled in by that effect. The `?? 0`
  // fallback is unreachable in practice: a fish's vehicle only enters
  // Yuka's `entityManager` (and so only gets `calculate()` invoked on it at
  // all) via that same registration effect.
  const currentHeadingRef = useRef<THREE.Quaternion | null>(null);
  const getYaw = () => (currentHeadingRef.current ? extractYaw(currentHeadingRef.current) : 0);

  // Kept fresh via effect (same pattern as `nightRef` below) so
  // `getColliderHalfExtents` — captured once by `useFishSteering`'s
  // memoized rig — always reads this fish's *current*, life-stage-scaled
  // size (grows as it ages), not whatever it was at mount. This is what a
  // fry's avoidance margin actually shrinks to match: `adultHalfExtents`
  // above stays fixed for the one place a scalar worst-case is still
  // required (`useFishSteering.ts`'s `physicalTouchDistance`), but the
  // containment/castle margins themselves are recomputed fresh every
  // frame anyway (alongside `getYaw`), so there's no staleness risk in
  // using the fish's real current size for them instead of its eventual
  // adult one — a fry gets a proportionally small, honest margin from
  // birth, growing in step with its actual collider.
  const critterRef = useRef(critter);
  useEffect(() => {
    critterRef.current = critter;
  }, [critter]);
  const getColliderHalfExtents = () => colliderHalfExtentsFor(critterRef.current);

  const steering = useFishSteering(
    critter.id,
    critter.personality,
    livingPopulation,
    favouriteSpotWorld,
    adultHalfExtents,
    getColliderHalfExtents,
    getYaw,
  );

  // Authoritative — pushed by the sim core on every `TickUpdate`
  // (`jarClient.ts`'s `isNight` store field) rather than re-derived here.
  const simNight = useJarStore((s) => s.isNight);
  // Dev-only override (`windows/TankMonitor/TankMonitorWindow.tsx`) to pin
  // day, night, or "always active" on demand rather than wait out a real
  // day/night cycle — `'auto'` (the real jar clock) in production builds,
  // where the toggle can't be set.
  const dayNightOverride = useDayNightOverride();
  const night = isAsleep('Fish', dayNightOverride, simNight);
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

  // Chase-burst state (`docs/architecture/3d-engine.md` §4.1's chase-bursts
  // paragraph) — `chaseTargetIdRef` is the fish currently being chased (if
  // any), `lastChasedIdRef` is who it chased last (so `selectChaseTarget`
  // doesn't immediately ping-pong back onto the same fish), and
  // `burstMulRef` is the current multiplier on top of `maxSpeedFor(energy)`.
  const chaseTargetIdRef = useRef<CritterId | null>(null);
  const lastChasedIdRef = useRef<CritterId | null>(null);
  // Time since `lastChasedIdRef` was last set — once it passes
  // `CHASE_EXCLUSION_COOLDOWN_SEC`, the exclusion clears (see that
  // constant's own comment for why this can't be permanent).
  const lastChasedElapsedRef = useRef(0);
  const chaseElapsedRef = useRef(0);
  const burstMulRef = useRef(1);
  // The ceiling multiplier the *current* burst (chase or spontaneous) is
  // ramping toward — rolled fresh by `startChase`/`startSpontaneousBurst`
  // each time one starts (`burstMultiplierFor` is random per call), not a
  // fixed per-fish value.
  const burstMulTargetRef = useRef(1);
  // A short, untargeted burst of speed during ordinary active wandering —
  // independent of `modeRef`/chasing entirely (no steering-behaviour change,
  // just a temporary lift on the same speed ceiling), so a fish can burst
  // while still just wandering, not only while pursuing a tankmate.
  const spontaneousBurstActiveRef = useRef(false);
  const spontaneousBurstElapsedRef = useRef(0);

  // A slow, per-fish ripple on the speed ceiling so an ordinary cruise
  // doesn't read as pinned at a flat number (`steeringParams.ts`'s
  // `breathingMultiplier`) — independent of, and stacks with, `burstMulRef`.
  const breathPhaseSeed = useMemo(() => Math.random() * Math.PI * 2, []);
  const clockElapsedRef = useRef(0);

  // Shared by the registry's `maxSpeed()` closure below and `FishModel`'s
  // `getSpeedCeiling` prop — the one place the raised-during-a-chase speed
  // ceiling flows from.
  const getSpeedCeiling = () =>
    steering.maxSpeedFor(critter.energy) *
    burstMulRef.current *
    breathingMultiplier(clockElapsedRef.current, breathPhaseSeed);

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
    // `SteeringSystem.tsx` mutates this exact object in place every frame
    // via `.slerp()` — assigning it here is what keeps `getYaw` (above)
    // live, with no further wiring needed.
    currentHeadingRef.current = currentHeading;
    registry.set(critter.id, {
      vehicle: steering.vehicle,
      getBody: () => rigidBodyRef.current,
      maxSpeed: getSpeedCeiling,
      getMode: () => modeRef.current,
      currentHeading,
      targetHeading: currentHeading.clone(),
      isHeadingActive: false,
      getDebugAnim: () => debugAnimRef.current,
      hue: critter.hue,
      getColliderRadius: () => colliderHalfExtentsFor(critter).z,
      getThrustEnvelope: () => thrustMultiplierFor(debugAnimRef.current?.phase ?? 0),
    });
    return () => {
      currentHeadingRef.current = null;
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
  useFrame((state, delta) => {
    clockElapsedRef.current = state.clock.elapsedTime;

    // Fades wander/separation/arrive/pursuit toward whatever `setMode` last
    // targeted, every frame and every mode — not just while settling. See
    // `useFishSteering.ts`'s `BEHAVIOUR_WEIGHT_RAMP_RATE` comment for why an
    // instant behaviour-set flip was the actual cause of fish visibly
    // "shaking" for a moment at every night settle/wake transition.
    steering.rampWeights(delta);

    // Same ramp treatment for the speed ceiling itself — an instant drop
    // back to normal while still moving at burst speed would shear velocity
    // in one frame (`chaseParams.ts`'s `BURST_RAMP_DOWN_RATE` comment). A
    // burst is "active" — i.e. `burstMulRef` has somewhere to ramp toward —
    // whenever either trigger says so; chasing always wins the target value
    // (set fresh in `startChase`) since it's the more deliberate of the two.
    const burstActive = modeRef.current === 'chasing' || spontaneousBurstActiveRef.current;
    burstMulRef.current = rampBurstMultiplier(
      burstMulRef.current,
      burstActive ? burstMulTargetRef.current : 1,
      delta,
    );

    if (spontaneousBurstActiveRef.current && modeRef.current !== 'chasing') {
      spontaneousBurstElapsedRef.current += delta;
      if (spontaneousBurstElapsedRef.current > SPONTANEOUS_BURST_SEC) {
        spontaneousBurstActiveRef.current = false;
      }
    }

    if (lastChasedIdRef.current !== null) {
      lastChasedElapsedRef.current += delta;
      if (lastChasedElapsedRef.current > CHASE_EXCLUSION_COOLDOWN_SEC) {
        lastChasedIdRef.current = null;
      }
    }

    if (modeRef.current === 'chasing') {
      chaseElapsedRef.current += delta;
      const target =
        chaseTargetIdRef.current !== null ? registry.get(chaseTargetIdRef.current) : undefined;
      // Surface gap, not raw centre distance — two adult colliders
      // physically can't get their centres closer than the sum of both
      // radii (`CHASE_CAUGHT_SURFACE_GAP`'s own comment), so subtracting
      // both out first is what makes "caught" reachable at every fish size.
      const caught =
        target !== undefined &&
        steering.vehicle.position.distanceTo(target.vehicle.position) -
          colliderHalfExtentsFor(critter).z -
          target.getColliderRadius() <
          CHASE_CAUGHT_SURFACE_GAP;
      const targetInvalid = target === undefined || target.getMode() !== 'active';
      if (caught || targetInvalid || chaseElapsedRef.current > CHASE_MAX_SEC) {
        // The evader is deliberately left assigned — `pursuit.weight` is
        // still fading toward 0 over the same ramp, and an inert pursuit
        // behaviour with a stale evader is harmless; it's just overwritten
        // the next time this fish starts a chase.
        lastChasedIdRef.current = chaseTargetIdRef.current;
        lastChasedElapsedRef.current = 0;
        chaseTargetIdRef.current = null;
        setMode('active');
      }
      return;
    }

    if (modeRef.current !== 'settling') return;
    settleElapsedRef.current += delta;
    const distance = steering.vehicle.position.distanceTo(favouriteSpotWorld);
    const timeout = nightRef.current ? NIGHT_SETTLE_TIMEOUT_SEC : ARRIVE_TIMEOUT_SEC;
    if (distance < ARRIVE_TOLERANCE || settleElapsedRef.current > timeout) {
      setMode(nightRef.current ? 'settled' : 'active');
    }
  });

  // Builds the candidate list for `selectChaseTarget` from every other
  // registered fish and, if one qualifies, starts the chase — assigning the
  // pursuit evader and mode together so a fish is never briefly `chasing`
  // with no target. Returns whether a chase actually started, so the roll
  // below can fall through to the arrive roll when nobody qualified.
  const startChase = (): boolean => {
    const candidates: ChaseCandidate[] = [];
    for (const [id, registered] of registry) {
      if (id === critter.id) continue;
      candidates.push({
        id,
        distance: steering.vehicle.position.distanceTo(registered.vehicle.position),
        mode: registered.getMode(),
      });
    }
    const targetId = selectChaseTarget(candidates, lastChasedIdRef.current);
    if (targetId === null) return false;
    const target = registry.get(targetId);
    if (!target) return false;

    steering.pursuit.evader = target.vehicle;
    chaseTargetIdRef.current = targetId;
    chaseElapsedRef.current = 0;
    burstMulTargetRef.current = burstMultiplierFor(critter.personality);
    setMode('chasing');
    return true;
  };

  /** A short, untargeted burst of speed — no steering-behaviour change,
   * just a temporary lift on the same ceiling `startChase` raises. */
  const startSpontaneousBurst = () => {
    burstMulTargetRef.current = burstMultiplierFor(critter.personality);
    spontaneousBurstActiveRef.current = true;
    spontaneousBurstElapsedRef.current = 0;
  };

  useEffect(() => {
    let cancelled = false;
    let pauseTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const scheduleNext = () => {
      const delay = ROLL_MIN_MS + Math.random() * ROLL_MAX_MS;
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        // Only roll while genuinely idle-and-active during the day — a
        // fish already settling/settled/paused/chasing (or mid-night)
        // shouldn't have this roll layer a second transition on top.
        if (!nightRef.current && modeRef.current === 'active') {
          if (Math.random() < steering.params.pauseChance) {
            setMode('paused');
            const pauseDuration = PAUSE_MIN_MS + Math.random() * PAUSE_MAX_MS;
            pauseTimeoutId = setTimeout(() => {
              if (!cancelled && modeRef.current === 'paused') setMode('active');
            }, pauseDuration);
          } else {
            // A chase roll that finds no eligible target falls through to
            // the spontaneous-burst roll, which itself falls through to the
            // arrive roll — same turn, in order.
            const chased =
              Math.random() < chaseChanceFor(critter.personality, critter.mood) && startChase();
            if (!chased) {
              if (Math.random() < burstChanceFor(critter.personality, critter.mood)) {
                startSpontaneousBurst();
              } else if (Math.random() < ARRIVE_CHANCE) {
                settleElapsedRef.current = 0;
                setMode('settling');
              }
            }
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

  // Computed once per render, not per JSX reference below.
  const he = colliderHalfExtentsFor(critter);

  return (
    <RigidBody
      ref={rigidBodyRef}
      position={[spawnPosition.x, spawnPosition.y, spawnPosition.z]}
      colliders={false}
      gravityScale={0}
      linearDamping={2.5}
      // The first `userData` tag in the codebase (`Snail.tsx`'s own
      // `RigidBody` carries the `snail` counterpart) — lets the snail's
      // `onCollisionEnter` tell a fish contact apart from anything else it
      // might touch, for the fish-knocks-a-snail-loose mechanic
      // (`snailBehaviour.ts`'s `detached` state).
      userData={{ kind: 'fish', critterId: critter.id }}
      // Rotation is exclusively script-authored (`SteeringSystem.tsx`'s
      // `setRotation` every frame) — locking all three axes here stops
      // wall/fish collisions from injecting spin between those writes.
      // `angularDamping` doesn't apply now: it only damps physics-driven
      // spin, and there is none once rotation is locked (this is also what
      // makes a hand-sized, flat `CuboidCollider` safe below: it rotates in
      // lock-step with whatever `SteeringSystem.tsx` commands, never
      // independently tumbled by physics).
      enabledRotations={[false, false, false]}
    >
      {/* Hand-placed, not `colliders="hull"` — automatic hull generation
       * misreads the model's nested tail-pivot group and produces a
       * malformed, overlapping collider that Rapier's solver resolves with
       * a violent corrective impulse on the very first physics step,
       * ejecting the fish from the tank (`fishCollider.ts`'s own history).
       * Sized to fully contain the model in every orientation it can
       * actually take: `he.z` (length) from the tail tip — the model's
       * farthest point from its own origin — is the fix for an earlier,
       * flatter radius that let a male/Veil tail visibly poke through the
       * glass or the sand; `he.y` (height) from the dorsal crest; `he.x`
       * (thickness) a policy half-thickness with real headroom over the
       * pectoral fins, the widest static part of the model. One documented
       * deviation: the *swimming* tail's lateral sweep at high amplitude can
       * exceed `he.x` — acceptable because the historical glass-poke bug was
       * specifically the rest pose (rest amplitude is tiny), and the
       * anticipatory glass/castle steering margins (`useFishSteering.ts`)
       * stay length-based for a nose-on approach regardless of swim state,
       * so a swimming tail can never actually reach the glass. */}
      <CuboidCollider args={[he.x, he.y, he.z]} />
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
          // the underlying native DOM click — that would still bubble up
          // to any ancestor DOM click handler without also stopping it
          // there. The tank background itself has none today
          // (TankWindow.tsx's `.tankInterior` only listens for
          // `contextmenu`/`mousedown`, not `click`), but this guards
          // against a future one firing on a click that was actually a
          // critter selection.
          e.stopPropagation();
          e.nativeEvent.stopPropagation();
          void selectCritter(critter.id);
        }}
      >
        <FishModel
          critter={critter}
          vehicle={steering.vehicle}
          getMode={() => modeRef.current}
          getSpeed={() => {
            const linvel = rigidBodyRef.current?.linvel();
            return linvel ? Math.hypot(linvel.x, linvel.y, linvel.z) : steering.vehicle.getSpeed();
          }}
          getSpeedCeiling={getSpeedCeiling}
          isPiloted={() => isActivelyPiloted(critter.id)}
          onDebugFrame={(anim) => {
            debugAnimRef.current = anim;
          }}
        />
      </group>
    </RigidBody>
  );
}
