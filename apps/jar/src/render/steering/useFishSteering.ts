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
import { steeringParamsFor } from './steeringParams';

const BASE_MAX_SPEED = 1.0;
const ENERGY_MAX_SPEED_BONUS = 1.0;

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

    const wander = new YUKA.WanderBehavior();
    wander.radius = params.wanderRadius;
    wander.jitter = params.wanderJitter;

    const separation = new YUKA.SeparationBehavior();

    const arrive = new YUKA.ArriveBehavior(favouriteSpotWorld, 3, 0.3);
    arrive.active = false;

    vehicle.steering.add(wander);
    vehicle.steering.add(separation);
    vehicle.steering.add(arrive);

    return { vehicle, wander, separation, arrive };
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

  const setArriving = (arriving: boolean) => {
    rig.arrive.active = arriving;
    rig.wander.active = !arriving;
  };

  const maxSpeedFor = (energyPercent: number) =>
    BASE_MAX_SPEED + (energyPercent / 100) * ENERGY_MAX_SPEED_BONUS;

  return { ...rig, params, setArriving, maxSpeedFor };
}
