// Per-fish Yuka vehicle + behaviors — `docs/architecture/3d-engine.md`
// §4.1: `WanderBehavior` + `SeparationBehavior` active by default
// (deliberately not Cohesion/Alignment — individual pets, not a school),
// an `ArriveBehavior` toward the favourite spot that `Fish.tsx`'s periodic
// roll switches on ~30% of the time a wander cycle resolves, and a
// `ChasePursuitBehaviour` toward a chase target that same roll occasionally
// assigns instead (§4.1's chase-bursts paragraph).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useMemo, useRef } from 'react';
import * as YUKA from 'yuka';

import type { Personality } from '../../domain/protocol/generated/Personality';
import { CastleAvoidanceBehaviour } from './castleAvoidanceBehaviour';
import { ChasePursuitBehaviour } from './chasePursuitBehaviour';
import { entityManager } from './entityManager';
import type { FishMotionMode } from './motionState';
import { BASE_SEPARATION_RADIUS, maxSpeedFor, steeringParamsFor } from './steeringParams';
import {
  MODE_WEIGHTS,
  rampWeights as computeRampedWeights,
  type ModeWeights,
} from './steeringWeights';
import { TankContainmentBehaviour } from './tankContainmentBehaviour';

/** Yuka's `WanderBehavior` projects its wander target this many units
 * directly in front of the vehicle before adding the `radius`/`jitter`
 * noise — that projection distance, not the circle radius, is what
 * dominates the steering force's magnitude. Left unset, it defaults to 5:
 * bigger than the entire tank (6x4x3, `coordinates.ts`), which made wander
 * an effective beeline toward/through a wall rather than a gentle local
 * drift. 1.6 keeps the widest single-update turn (with
 * `BASE_WANDER_RADIUS`, `steeringParams.ts`) to roughly `atan(0.8/1.6) ≈
 * 27°`. */
const WANDER_DISTANCE = 1.6;

/** Yuka's own default (100) is effectively unclamped at this tank's scale —
 * bounding it keeps the worst-case combined wander+separation+containment
 * force from producing a visible snap in one step; the orientation slerp
 * (`SteeringSystem.tsx`) then smooths whatever's left. */
const MAX_STEERING_FORCE = 3;

/** Extra room beyond a fish's own collider radius before the containment
 * push starts — not just enough to clear the glass at zero margin
 * remaining, but enough that the fish has room to actually complete the
 * turn away from the wall before its collider would reach it. Trimmed from
 * an original `0.2`, which (stacked on `maxColliderRadius` already being
 * sized to the tail tip, the model's single farthest point) kept every
 * fish turning away from the glass and the castle well before its actual
 * body silhouette was anywhere near either — a visibly empty buffer band
 * all the way around the tank. */
const CONTAINMENT_BUFFER = 0.1;

/** Same "room to actually turn away" rationale as `CONTAINMENT_BUFFER`,
 * applied to the separation floor below. */
const SEPARATION_CLEARANCE_BUFFER = 0.1;

export function useFishSteering(
  personality: Personality,
  livingPopulation: number,
  favouriteSpotWorld: YUKA.Vector3,
  maxColliderRadius: number,
  getColliderRadius: () => number,
) {
  const params = useMemo(
    () => steeringParamsFor(personality, livingPopulation),
    [personality, livingPopulation],
  );

  const rig = useMemo(() => {
    const vehicle = new YUKA.Vehicle();
    vehicle.updateNeighborhood = true;
    // `neighborhoodRadius` is a *centre-to-centre* distance, so it can never
    // go below `physicalTouchDistance` — a fish's own two-body clearance
    // (this radius, doubled, approximating "if the other fish is about my
    // size") — or two `BallCollider`s are already deeply overlapping before
    // either is even considered a neighbour, and `SeparationBehavior` never
    // gets a chance to push them apart; Rapier's own hard collision
    // response takes over instead (contact jitter, not a graceful
    // turn-away). But that floor alone (a flat `+ SEPARATION_CLEARANCE_
    // BUFFER`) swamps `params.separationRadius`'s whole personality range —
    // Shy/Curious/Default all clamp to the exact same value for any
    // ordinary adult collider size, silently erasing §4.1's documented
    // trait differentiation. Applying personality as a *delta from
    // baseline* on top of the physical floor instead keeps both true: the
    // floor itself is never violated (Curious's negative delta can only
    // shrink the buffer back down to zero, never past the physical
    // minimum), while Shy's positive delta still visibly grows the radius,
    // and Curious's negative one still visibly shrinks it relative to
    // Default and Shy, just from a physically-safe baseline instead of an
    // arbitrary one.
    const physicalTouchDistance = maxColliderRadius * 2;
    const separationTraitDelta = params.separationRadius - BASE_SEPARATION_RADIUS;
    vehicle.neighborhoodRadius = Math.max(
      physicalTouchDistance,
      physicalTouchDistance + SEPARATION_CLEARANCE_BUFFER + separationTraitDelta,
    );
    vehicle.maxForce = MAX_STEERING_FORCE;

    const wander = new YUKA.WanderBehavior();
    wander.radius = params.wanderRadius;
    wander.jitter = params.wanderJitter;
    wander.distance = WANDER_DISTANCE;
    wander.weight = MODE_WEIGHTS.active.wander;

    const separation = new YUKA.SeparationBehavior();
    separation.weight = MODE_WEIGHTS.active.separation;
    const containment = new TankContainmentBehaviour(maxColliderRadius + CONTAINMENT_BUFFER);
    const castleAvoidance = new CastleAvoidanceBehaviour(
      maxColliderRadius + CONTAINMENT_BUFFER,
      getColliderRadius,
    );

    // Added after `containment` deliberately — Yuka's priority-budget
    // accumulation (`SteeringManager`'s calculate order) gives earlier-added
    // behaviors first claim on `vehicle.maxForce`, so containment keeps its
    // share even while a chase's pursuit force is large. No evader yet
    // (`ChasePursuitBehaviour`'s own null guard covers that until `Fish.tsx`
    // assigns one).
    const pursuit = new ChasePursuitBehaviour();
    pursuit.weight = MODE_WEIGHTS.active.pursuit;

    const arrive = new YUKA.ArriveBehavior(favouriteSpotWorld, 3, 0.3);
    arrive.weight = MODE_WEIGHTS.active.arrive;
    // `active` stays permanently `true` (Yuka's own default) on all four —
    // `setMode`/`rampWeights` below only ever move `.weight`, never flip
    // `active`, which is what turns a mode change into a fade instead of a
    // snap. `calculate()` still runs every frame regardless of weight
    // (cheap for a handful of fish); see `rampWeights`'s comment for why
    // that's the point.

    // `containment`/`castleAvoidance` go first: Yuka's `SteeringManager`
    // accumulates each behaviour's force in insertion order and stops once
    // the running total already reaches `vehicle.maxForce` — added last, a
    // fish committed to wandering straight at an obstacle could exhaust the
    // whole force budget on `wander`/`separation` before either avoidance
    // behaviour ever got a chance to contribute, letting it collide and
    // jitter against the glass or the castle despite their own strength
    // nominally out-voting the others.
    vehicle.steering.add(containment);
    vehicle.steering.add(castleAvoidance);
    vehicle.steering.add(wander);
    vehicle.steering.add(separation);
    vehicle.steering.add(pursuit);
    vehicle.steering.add(arrive);

    return { vehicle, wander, separation, containment, castleAvoidance, pursuit, arrive };
    // Created once per mounted fish instance; personality/params/
    // maxColliderRadius changes mid-life aren't expected (a critter's
    // personality/fin/sex never change after spawn per SPEC.md §5), so this
    // intentionally doesn't react to any of them changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    entityManager.add(rig.vehicle);
    return () => {
      entityManager.remove(rig.vehicle);
    };
  }, [rig.vehicle]);

  // `containment`/`castleAvoidance` are never targeted here — both stay at
  // weight 1 in every mode, paused/settled fish included, since even a
  // resting fish shouldn't be able to drift into the glass or the castle.
  const targetWeightsRef = useRef<ModeWeights>(MODE_WEIGHTS.active);

  const setMode = (mode: FishMotionMode) => {
    targetWeightsRef.current = MODE_WEIGHTS[mode];
  };

  /** Called every frame (`Fish.tsx`) to fade each behavior's `.weight`
   * toward whatever `setMode` last targeted — see `steeringWeights.ts`'s
   * `BEHAVIOR_WEIGHT_RAMP_RATE` comment for why this exists instead of
   * `setMode` changing weights directly. */
  const rampWeights = (delta: number) => {
    const next = computeRampedWeights(
      {
        wander: rig.wander.weight,
        separation: rig.separation.weight,
        arrive: rig.arrive.weight,
        pursuit: rig.pursuit.weight,
      },
      targetWeightsRef.current,
      delta,
    );
    rig.wander.weight = next.wander;
    rig.separation.weight = next.separation;
    rig.arrive.weight = next.arrive;
    rig.pursuit.weight = next.pursuit;
  };

  return { ...rig, params, setMode, rampWeights, maxSpeedFor };
}
