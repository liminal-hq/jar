// Per-fish Yuka vehicle + behaviors — `docs/architecture/3d-engine.md`
// §4.1: `WanderBehavior` + `SeparationBehavior` active by default
// (deliberately not Cohesion/Alignment — individual pets, not a school),
// plus an `ArriveBehavior` toward the favourite spot that
// `useArriveRoll` (in `Fish.tsx`) switches on ~30% of the time a wander
// cycle resolves.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useMemo, useRef } from 'react';
import * as YUKA from 'yuka';

import type { Personality } from '../../domain/protocol/generated/Personality';
import { entityManager } from './entityManager';
import type { FishMotionMode } from './motionState';
import { maxSpeedFor, steeringParamsFor } from './steeringParams';
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

export function useFishSteering(
  personality: Personality,
  livingPopulation: number,
  favouriteSpotWorld: YUKA.Vector3,
) {
  const params = useMemo(
    () => steeringParamsFor(personality, livingPopulation),
    [personality, livingPopulation],
  );

  const rig = useMemo(() => {
    const vehicle = new YUKA.Vehicle();
    vehicle.updateNeighborhood = true;
    vehicle.neighborhoodRadius = params.separationRadius;
    vehicle.maxForce = MAX_STEERING_FORCE;

    const wander = new YUKA.WanderBehavior();
    wander.radius = params.wanderRadius;
    wander.jitter = params.wanderJitter;
    wander.distance = WANDER_DISTANCE;
    wander.weight = MODE_WEIGHTS.active.wander;

    const separation = new YUKA.SeparationBehavior();
    separation.weight = MODE_WEIGHTS.active.separation;
    const containment = new TankContainmentBehaviour();

    const arrive = new YUKA.ArriveBehavior(favouriteSpotWorld, 3, 0.3);
    arrive.weight = MODE_WEIGHTS.active.arrive;
    // `active` stays permanently `true` (Yuka's own default) on all three —
    // `setMode`/`rampWeights` below only ever move `.weight`, never flip
    // `active`, which is what turns a mode change into a fade instead of a
    // snap. `calculate()` still runs every frame regardless of weight
    // (cheap for a handful of fish); see `rampWeights`'s comment for why
    // that's the point.

    vehicle.steering.add(wander);
    vehicle.steering.add(separation);
    vehicle.steering.add(containment);
    vehicle.steering.add(arrive);

    return { vehicle, wander, separation, containment, arrive };
    // Created once per mounted fish instance; personality/params changes
    // mid-life aren't expected (a critter's personality never changes
    // after spawn per SPEC.md §5), so this intentionally doesn't react to
    // `params` changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    entityManager.add(rig.vehicle);
    return () => {
      entityManager.remove(rig.vehicle);
    };
  }, [rig.vehicle]);

  // `containment` is never targeted here — it stays at weight 1 in every
  // mode, paused/settled fish included, since even a resting fish shouldn't
  // be able to drift into the glass.
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
      { wander: rig.wander.weight, separation: rig.separation.weight, arrive: rig.arrive.weight },
      targetWeightsRef.current,
      delta,
    );
    rig.wander.weight = next.wander;
    rig.separation.weight = next.separation;
    rig.arrive.weight = next.arrive;
  };

  return { ...rig, params, setMode, rampWeights, maxSpeedFor };
}
