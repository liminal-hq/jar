// Per-fish Yuka vehicle + behaviors — `docs/architecture/3d-engine.md`
// §4.1: `WanderBehavior` + `SeparationBehavior` active by default
// (deliberately not Cohesion/Alignment — individual pets, not a school),
// plus an `ArriveBehavior` toward the favourite spot that
// `useArriveRoll` (in `Fish.tsx`) switches on ~30% of the time a wander
// cycle resolves.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useMemo } from 'react';
import * as YUKA from 'yuka';

import type { Personality } from '../../domain/protocol/generated/Personality';
import { entityManager } from './entityManager';
import type { FishMotionMode } from './motionState';
import { maxSpeedFor, steeringParamsFor } from './steeringParams';
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

    const separation = new YUKA.SeparationBehavior();
    const containment = new TankContainmentBehaviour();

    const arrive = new YUKA.ArriveBehavior(favouriteSpotWorld, 3, 0.3);
    arrive.active = false;

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

  // `containment` is never toggled here — it stays active in every mode,
  // paused/settled fish included, since even a resting fish shouldn't be
  // able to drift into the glass.
  const setMode = (mode: FishMotionMode) => {
    switch (mode) {
      case 'active':
        rig.wander.active = true;
        rig.separation.active = true;
        rig.arrive.active = false;
        break;
      case 'paused':
        // Separation stays on — a paused fish still yields space rather
        // than becoming an obstacle for its neighbours.
        rig.wander.active = false;
        rig.separation.active = true;
        rig.arrive.active = false;
        break;
      case 'settling':
        // §4.1: night cancels active steering except arrival — no wander,
        // no separation, until settled.
        rig.wander.active = false;
        rig.separation.active = false;
        rig.arrive.active = true;
        break;
      case 'settled':
        rig.wander.active = false;
        rig.separation.active = false;
        rig.arrive.active = false;
        break;
    }
  };

  return { ...rig, params, setMode, maxSpeedFor };
}
