// How a crawler keeps out of another crawler's way — the pure geometry of
// it. Where each snail currently *is* lives next door, in
// `snailRegistry.ts`, so this file stays a plain function of its inputs.
//
// Two `kinematicPosition` Rapier bodies generate no collision response
// against each other at all: Rapier's solver only resolves a pair where at
// least one side is dynamic, so the kinematic collider that stops a *fish*
// from overlapping a snail does nothing whatsoever snail-to-snail. Two
// snails simply crawl through one another. Making them dynamic is not the
// answer — `Snail.tsx` derives its whole transform from an analytic crawl
// surface and would spend every frame fighting a solver trying to push it
// off that surface — so the separation has to happen a level up, in the
// steering, the way a fish's own `SeparationBehavior` does.
//
// A snail steers differently from a fish, though: it can only turn along
// the surface it is stuck to, so this returns a *heading* nudge and a
// speed scale rather than a free 3D steering force. Turning alone can't
// stop a head-on pair in time, and braking alone leaves two snails nose to
// nose forever; together they read as one snail noticing another, slowing,
// and going around.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { Vec3 } from '../environment/crawlSurfaces';

/** How far away another snail starts to matter, in world units — about
 * 1.3 adult body lengths (`snailGeometry.ts`'s foot span × its scale chain
 * puts an adult at ≈0.53). It has to be comfortably more than a body:
 * these are *head* positions, so a snail whose head is one body length
 * from another's head may already be lying across its shell, and at this
 * crawl speed a snail needs the better part of a second to turn out of a
 * line it is committed to. One constant rather than a per-life-stage
 * radius: a fry is small enough that the extra margin reads as it being
 * politely cautious, not as a bug. Tune by eye, like every other
 * snail-motion constant. */
export const SNAIL_SEPARATION_RADIUS = 0.7;

/** Radians/sec of turn at full crowding — twice `Snail.tsx`'s
 * `EDGE_AVOIDANCE_TURN_RATE`, since a wall stays put and another snail is
 * also closing. Tune by eye. */
export const SNAIL_SEPARATION_TURN_RATE = 3;

/** A dead-ahead neighbour puts `sideways` at (or near) zero, which carries
 * no sign to steer away from. Below this fraction of the separation the
 * turn direction is decided by a fixed tie-break instead, so two snails
 * meeting exactly nose to nose still each pick a side rather than driving
 * straight into each other. Both of a head-on pair read the other as being
 * to the same hand as themselves, and each one's "same hand" points the
 * opposite way in the world — so they peel off to opposite sides and
 * pass. */
const HEAD_ON_FRACTION = 0.05;

export interface CrawlerFrame {
  position: Vec3;
  /** The direction of travel along the surface. */
  forward: Vec3;
  /** The surface normal — `forward × up` gives the in-surface sideways
   * axis (`poseToWorld`'s own `right`) a crawler can actually turn
   * within. */
  up: Vec3;
}

export interface SeparationResponse {
  /** Signed, in `[-1, 1]`: a fraction of `SNAIL_SEPARATION_TURN_RATE` to
   * add to the heading this frame. Positive turns the same way a positive
   * `turn()` delta does. */
  turn: number;
  /** In `[0, 1]`: what fraction of its normal crawl speed the snail should
   * cover this frame. Reaches 0 only with another snail squarely in
   * contact directly ahead — and a stopped snail still turns, so it eases
   * around rather than deadlocking. */
  speedScale: number;
}

const NO_CROWDING: SeparationResponse = { turn: 0, speedScale: 1 };

/**
 * What `self` should do about the other crawlers at `others`.
 *
 * The two halves answer different questions, and gating them the same way
 * doesn't work. *Turning* away is about proximity alone: a snail alongside
 * another is exactly the one that needs to veer, and gating the turn on
 * "is it in front of me" lets a pair converge until neither is ahead of the
 * other any more and both stop steering — they drift together and touch.
 * *Slowing down* is about the path ahead: stopping for something beside or
 * behind you achieves nothing, and a pair that both brake while still
 * closing simply meets more slowly.
 *
 * Pure and allocation-free — this runs per snail per frame against every
 * other snail, which at this tank's population (a handful) is far cheaper
 * than any spatial index would be to maintain.
 */
export function snailSeparationResponse(
  self: CrawlerFrame,
  others: readonly Vec3[],
  radius: number = SNAIL_SEPARATION_RADIUS,
): SeparationResponse {
  if (others.length === 0) return NO_CROWDING;

  // `forward × up` — `poseToWorld`'s own `right`. Which of the two possible
  // lateral axes this is matters: `crawlSurfaces.turn()` takes a *heading*
  // delta in the face's own `(u, v)` frame, and a positive delta rotates
  // `forward` toward `right`. So steering away from something on the right
  // is a negative turn, and getting the axis the other way round steers
  // every snail straight into its neighbour.
  const rightX = self.forward.y * self.up.z - self.forward.z * self.up.y;
  const rightY = self.forward.z * self.up.x - self.forward.x * self.up.z;
  const rightZ = self.forward.x * self.up.y - self.forward.y * self.up.x;

  let turn = 0;
  let worstObstruction = 0;

  for (const other of others) {
    const ox = other.x - self.position.x;
    const oy = other.y - self.position.y;
    const oz = other.z - self.position.z;
    const distance = Math.hypot(ox, oy, oz);
    if (distance >= radius || distance < 1e-9) continue;

    // Squared, so a neighbour at the edge of the radius barely registers
    // and one about to be touched dominates everything else.
    const nearness = (1 - distance / radius) ** 2;

    let sideways = (ox * rightX + oy * rightY + oz * rightZ) / distance;
    if (Math.abs(sideways) < HEAD_ON_FRACTION) sideways = HEAD_ON_FRACTION;
    // Full-strength turn whichever side the neighbour is on: how far off
    // the axis it sits decides the *direction* to peel away, not how hard.
    turn -= Math.sign(sideways) * nearness;

    const aheadness = (ox * self.forward.x + oy * self.forward.y + oz * self.forward.z) / distance;
    if (aheadness > 0) worstObstruction = Math.max(worstObstruction, nearness * aheadness);
  }

  if (turn === 0 && worstObstruction === 0) return NO_CROWDING;
  return {
    turn: Math.max(-1, Math.min(1, turn)),
    speedScale: Math.max(0, 1 - worstObstruction),
  };
}
