// Tests for `snailSeparation.ts` — the per-neighbour arithmetic on its own,
// and then the property the whole thing exists for, measured the only way
// that actually settles it: two snails driven at each other over the real
// crawl-surface graph, frame by frame, at the real crawl speed.
//
// The unit cases can't settle it alone, because the sign that matters is
// the one connecting this module's world-space "which side is it on" to
// `crawlSurfaces.turn()`'s face-local heading angle. Get that backwards and
// every unit assertion still passes while both snails steer *into* each
// other.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import {
  advance,
  poseToWorld,
  turn,
  type CrawlPose,
  type Vec3,
} from '../environment/crawlSurfaces';
import {
  snailSeparationResponse,
  SNAIL_SEPARATION_RADIUS,
  SNAIL_SEPARATION_TURN_RATE,
} from './snailSeparation';

/** A snail crawling along the floor's own `+u` axis, at the origin of this
 * little frame, so a neighbour's coordinates read as "ahead" (`forward`)
 * and "to its right" (`forward × up`). */
const FLOOR_CRAWLER = {
  position: { x: 0, y: 0, z: 0 },
  forward: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
};
/** `forward × up` for `FLOOR_CRAWLER` — its right-hand side. */
const RIGHT: Vec3 = { x: 0, y: 0, z: 1 };

function at(ahead: number, toTheRight: number): Vec3 {
  return { x: ahead, y: 0, z: toTheRight * RIGHT.z };
}

describe('snailSeparationResponse', () => {
  it('leaves a snail alone when nothing is near it', () => {
    expect(snailSeparationResponse(FLOOR_CRAWLER, [])).toEqual({ turn: 0, speedScale: 1 });
    expect(snailSeparationResponse(FLOOR_CRAWLER, [at(SNAIL_SEPARATION_RADIUS * 1.5, 0)])).toEqual({
      turn: 0,
      speedScale: 1,
    });
  });

  it('does not brake for a snail behind it, but still edges away from one', () => {
    const behind = snailSeparationResponse(FLOOR_CRAWLER, [at(-0.1, 0.02)]);
    expect(behind.speedScale).toBe(1);
    expect(behind.turn).toBeLessThan(0);
  });

  it('turns away from the side the other snail is on', () => {
    const onTheRight = snailSeparationResponse(FLOOR_CRAWLER, [at(0.15, 0.1)]);
    const onTheLeft = snailSeparationResponse(FLOOR_CRAWLER, [at(0.15, -0.1)]);
    expect(onTheRight.turn).toBeLessThan(0);
    expect(onTheLeft.turn).toBeGreaterThan(0);
    expect(onTheRight.turn).toBeCloseTo(-onTheLeft.turn, 10);
  });

  it('turns away from one right alongside it, not just one ahead', () => {
    // Gating the turn on "is it in front of me" is what lets a converging
    // pair coast the last few centimetres into each other: by the time they
    // are level, neither is ahead of the other any more.
    expect(snailSeparationResponse(FLOOR_CRAWLER, [at(0.01, 0.12)]).turn).toBeLessThan(-0.3);
  });

  it('still picks a side for one squarely dead ahead', () => {
    const response = snailSeparationResponse(FLOOR_CRAWLER, [at(0.1, 0)]);
    expect(Math.abs(response.turn)).toBeGreaterThan(0.5);
  });

  it('slows hardest for the one most squarely in the way', () => {
    const deadAhead = snailSeparationResponse(FLOOR_CRAWLER, [at(0.06, 0)]);
    const offToTheSide = snailSeparationResponse(FLOOR_CRAWLER, [at(0.06, 0.2)]);
    const farAhead = snailSeparationResponse(FLOOR_CRAWLER, [at(0.6, 0)]);
    expect(deadAhead.speedScale).toBeLessThan(0.2);
    expect(deadAhead.speedScale).toBeLessThan(offToTheSide.speedScale);
    expect(deadAhead.speedScale).toBeLessThan(farAhead.speedScale);
    expect(farAhead.speedScale).toBeLessThan(1);
  });

  it('reacts to the nearest obstacle when several are near', () => {
    const one = snailSeparationResponse(FLOOR_CRAWLER, [at(0.3, 0.02)]);
    const both = snailSeparationResponse(FLOOR_CRAWLER, [at(0.3, 0.02), at(0.06, 0.02)]);
    expect(both.speedScale).toBeLessThan(one.speedScale);
  });
});

/** `Snail.tsx`'s own constants, for driving a realistic pair. */
const CRAWL_SPEED = 0.12;
const DELTA = 1 / 60;

interface Walker {
  pose: CrawlPose;
}

/** Steps a whole population one frame, exactly the way `Snail.tsx` does:
 * every walker reads the others' current head positions, then advances its
 * own by the separation's own turn and speed scale. */
function step(walkers: Walker[], separate: boolean): void {
  const heads = walkers.map((w) => poseToWorld(w.pose));
  walkers.forEach((walker, i) => {
    const others = heads.filter((_, j) => j !== i).map((h) => h.position);
    const crowding = separate
      ? snailSeparationResponse(heads[i]!, others)
      : { turn: 0, speedScale: 1 };
    walker.pose = advance(
      turn(walker.pose, crowding.turn * SNAIL_SEPARATION_TURN_RATE * DELTA),
      CRAWL_SPEED * crowding.speedScale * DELTA,
    );
  });
}

function closestApproach(walkers: Walker[], separate: boolean, frames: number): number {
  let closest = Infinity;
  for (let frame = 0; frame < frames; frame++) {
    step(walkers, separate);
    const heads = walkers.map((w) => poseToWorld(w.pose).position);
    for (let i = 0; i < heads.length; i++) {
      for (let j = i + 1; j < heads.length; j++) {
        const a = heads[i]!;
        const b = heads[j]!;
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
      }
    }
  }
  return closest;
}

/** An adult snail's whole body, in world units — `snailGeometry.ts`'s
 * measured toe-to-tail span against the same `SVG_SCALE ×
 * SNAIL_BODY_SCALE` chain. Every threshold below is a fraction of this,
 * since what "too close" means scales with the animal. */
const BODY_LENGTH = (96 - -125) * 0.004 * 0.6;

describe('two snails meeting', () => {
  const pair = (headingA: number, headingB: number, gap: number): Walker[] => [
    { pose: { faceId: 'floor', u: 2.3, v: 0.6, heading: headingA } },
    { pose: { faceId: 'floor', u: 2.3 + gap, v: 0.6, heading: headingB } },
  ];

  /** These are *head* distances, and a head is the very front of an animal
   * that reaches most of a body length back behind it — so holding heads
   * this far apart is what keeps the bodies from overlapping at all. */
  const CLEAR = BODY_LENGTH * 0.45;

  it('crawl straight through each other without separation', () => {
    expect(closestApproach(pair(0, Math.PI, 0.9), false, 400)).toBeLessThan(BODY_LENGTH * 0.05);
  });

  it('do not, with it — head-on', () => {
    // Nothing distinguishes the two sides here, so each falls back on
    // `HEAD_ON_FRACTION`'s tie-break — and because "the same hand" points
    // opposite ways for two snails facing each other, they peel apart
    // rather than both swerving into the same gap.
    expect(closestApproach(pair(0, Math.PI, 0.9), true, 400)).toBeGreaterThan(CLEAR);
  });

  it('do not, with it — converging at an angle', () => {
    expect(closestApproach(pair(0.6, Math.PI - 0.6, 0.8), true, 400)).toBeGreaterThan(CLEAR);
  });

  it('do not, with it — one crossing the other\u2019s path', () => {
    const crossing: Walker[] = [
      { pose: { faceId: 'floor', u: 2.3, v: 0.6, heading: 0 } },
      { pose: { faceId: 'floor', u: 2.9, v: 0.05, heading: Math.PI / 2 } },
    ];
    expect(closestApproach(crossing, true, 400)).toBeGreaterThan(CLEAR);
  });

  it('do not, with it — one closing on another from behind and to one side', () => {
    const chasing: Walker[] = [
      { pose: { faceId: 'floor', u: 2.3, v: 0.6, heading: 0 } },
      { pose: { faceId: 'floor', u: 1.95, v: 0.35, heading: 0.45 } },
    ];
    expect(closestApproach(chasing, true, 400)).toBeGreaterThan(CLEAR);
  });

  it('keeps a whole tankful of them apart', () => {
    // Five — the snail population cap — started deliberately on top of one
    // another, which is far worse than anything the tank produces.
    const crowd: Walker[] = [
      { pose: { faceId: 'floor', u: 2.0, v: 0.6, heading: 0 } },
      { pose: { faceId: 'floor', u: 2.9, v: 0.6, heading: Math.PI } },
      { pose: { faceId: 'floor', u: 2.45, v: 0.2, heading: Math.PI / 2 } },
      { pose: { faceId: 'floor', u: 2.45, v: 1.0, heading: -Math.PI / 2 } },
      { pose: { faceId: 'floor', u: 2.1, v: 0.25, heading: Math.PI / 4 } },
    ];
    expect(closestApproach(crowd, false, 600)).toBeLessThan(BODY_LENGTH * 0.05);
    expect(closestApproach(crowd, true, 600)).toBeGreaterThan(BODY_LENGTH * 0.35);
  });
});
