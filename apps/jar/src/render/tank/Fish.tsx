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
import * as YUKA from 'yuka';

import { lifeStageScale } from '../../domain/simConstants';
import type { Critter } from '../../domain/protocol/generated/Critter';
import { selectCritter } from '../../domain/selection';
import { FishModel } from '../models/FishModel';
import { simPercentToWorld } from '../physics/coordinates';
import { useSteeringRegistry } from '../steering/SteeringSystem';
import { useFishSteering } from '../steering/useFishSteering';

/** A loose bounding sphere around `FishModel`'s combined body/tail/eye
 * geometry at scale 1, hand-picked rather than derived from the mesh —
 * collision doesn't need to trace the model precisely for a creature this
 * small, and a manual sphere sidesteps `colliders="hull"` entirely: its
 * automatic hull generation was producing a malformed collider from the
 * model's nested tail-pivot group, launching fish out of the tank on their
 * very first physics step. */
const COLLIDER_RADIUS = 0.32;

interface FishProps {
  critter: Critter;
  livingPopulation: number;
}

/** SPEC.md §5 / `docs/architecture/3d-engine.md` §4.1: ~30% of the time a
 * wander cycle resolves, redirect to the favourite spot instead. Simplified
 * here as a periodic roll (every 8-15s) rather than hooking Yuka's
 * per-cycle wander-circle-update event directly. */
const ARRIVE_ROLL_MIN_MS = 8000;
const ARRIVE_ROLL_MAX_MS = 7000;
const ARRIVE_CHANCE = 0.3;
const ARRIVE_TOLERANCE = 0.3;
const ARRIVE_TIMEOUT_SEC = 20;

export function Fish({ critter, livingPopulation }: FishProps) {
  const rigidBodyRef = useRef<RapierRigidBody>(null);
  const registry = useSteeringRegistry();

  const favouriteSpotWorld = useMemo(() => {
    const p = simPercentToWorld(
      critter.favourite_spot.x,
      critter.favourite_spot.y,
      critter.favourite_spot.z,
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
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const steering = useFishSteering(critter.personality, livingPopulation, favouriteSpotWorld);

  useEffect(() => {
    registry.set(critter.id, {
      vehicle: steering.vehicle,
      getBody: () => rigidBodyRef.current,
      maxSpeed: () => steering.maxSpeedFor(critter.energy),
    });
    return () => {
      registry.delete(critter.id);
    };
    // `critter.energy` is read imperatively via the closure below on every
    // frame `SteeringSystem` calls `maxSpeed()` — no need to re-register
    // when it ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, critter.id, steering]);

  const arrivingRef = useRef(false);
  const arriveElapsedRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const scheduleNext = () => {
      const delay = ARRIVE_ROLL_MIN_MS + Math.random() * ARRIVE_ROLL_MAX_MS;
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        if (!arrivingRef.current && Math.random() < ARRIVE_CHANCE) {
          arrivingRef.current = true;
          arriveElapsedRef.current = 0;
          steering.setArriving(true);
        }
        scheduleNext();
      }, delay);
    };
    let timeoutId = setTimeout(scheduleNext, 0);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [steering]);

  // Ends arrive-mode once close enough to the favourite spot, or after a
  // timeout so a fish can never get stuck "arriving" forever. Ordinary
  // default-priority `useFrame` — safe alongside `SteeringSystem`'s own,
  // since neither passes a render-priority argument (see that file's
  // header for why that distinction matters with R3F v8).
  useFrame((_, delta) => {
    if (!arrivingRef.current) return;
    arriveElapsedRef.current += delta;
    const distance = steering.vehicle.position.distanceTo(favouriteSpotWorld);
    if (distance < ARRIVE_TOLERANCE || arriveElapsedRef.current > ARRIVE_TIMEOUT_SEC) {
      arrivingRef.current = false;
      steering.setArriving(false);
    }
  });

  return (
    <RigidBody
      ref={rigidBodyRef}
      position={[spawnPosition.x, spawnPosition.y, spawnPosition.z]}
      colliders={false}
      gravityScale={0}
      linearDamping={2.5}
      angularDamping={5}
    >
      <BallCollider args={[COLLIDER_RADIUS * lifeStageScale(critter.age_sec)]} />
      <group
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
        <FishModel critter={critter} vehicle={steering.vehicle} />
      </group>
    </RigidBody>
  );
}
