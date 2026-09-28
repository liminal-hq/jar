// An arc-length "spine" over `crawlSurfaces.ts`'s crawl-surface graph — a
// breadcrumb trail of poses along a crawler's own travelled path, resampled
// at even spacing, so a body can be sampled at several points along its
// length rather than treated as a single rigid transform. Pure math, no
// three.js import (the same `crawlSurfaces.ts` discipline): critter-agnostic
// by design, built for the snail (issue #112) but reusable by any future
// second crawler.
//
// Every sample this module ever produces is either an exact `CrawlPose`
// (a real point `advance()` visited) or a straight-line interpolation
// between two of them — never a synthesized point off the crawl-surface
// graph. That's the whole reason a breadcrumb trail was chosen over an
// independent-pose-per-segment approach: a rope of real, on-surface points
// can only ever sag onto the surface it's actually resting on, not off it.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import {
  advance,
  advanceTracking,
  poseToWorld,
  turn,
  type CrawlPose,
  type Vec3,
} from './crawlSurfaces';

/** One recorded point along the trail — always the result of a real
 * `advance()` (or the seeding back-trace's equivalent), never synthesized.
 * `arcLength` is measured from an arbitrary but fixed zero point chosen at
 * `createSpine` time (the *tail's* starting position, per that function's
 * own doc comment) and only ever increases as the head advances. */
export interface Breadcrumb {
  pose: CrawlPose;
  position: Vec3;
  arcLength: number;
}

export interface CrawlSpine {
  /** Ascending by `arcLength`, oldest (most tail-ward) first. Always holds
   * at least two entries. The most recent entry may lag the live head by
   * up to `crumbSpacing` — see `distanceSinceLastCrumb`. */
  crumbs: Breadcrumb[];
  /** The crawler's actual current pose — advanced every call, independent
   * of whether it happened to land on a spacing-aligned crumb boundary. */
  headPose: CrawlPose;
  headArcLength: number;
  /** Distance travelled since the most recent entry in `crumbs` was
   * recorded — always in `[0, crumbSpacing)`. `sampleSpine` treats
   * `headPose` as one further, not-yet-committed sample point past
   * `crumbs[crumbs.length - 1]` by this much, so a caller can always query
   * all the way up to the head itself. */
  distanceSinceLastCrumb: number;
  bodyLength: number;
  crumbSpacing: number;
}

export interface SpineSample {
  position: Vec3;
  faceId: string;
  u: number;
  v: number;
}

function toSample(crumb: Breadcrumb): SpineSample {
  return { position: crumb.position, faceId: crumb.pose.faceId, u: crumb.pose.u, v: crumb.pose.v };
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** Seeds a spine by tracing backward from `headPose` — `turn(pose, π)` then
 * `advance()` then `turn(π)` again, `crawlSurfaces.ts`'s own API needing no
 * new primitive to march in reverse. This is what gives every spine a
 * correctly laid-out body from frame one, with no warm-up pop: a spine
 * built by only ever advancing forward from a single point would need
 * `bodyLength` worth of real travel before its tail caught up to a
 * sensible position.
 *
 * If the back-trace hits a genuinely unlinked edge (a wall's rim, the
 * lintel's underside) partway through seeding, tracing stops there rather
 * than reflecting further back — a snail spawned right next to a dead end
 * gets a tail that piles up at that edge, not one that zigzags behind it.
 * `advanceTracking`'s own `bounced` flag is what makes this detectable at
 * all: an ordinary fold crossing during back-tracing is expected and fine
 * (the tail crossing back over a wall/floor seam it just came from), only
 * a genuine reflection needs this clamp. */
export function createSpine(
  headPose: CrawlPose,
  bodyLength: number,
  crumbSpacing: number,
): CrawlSpine {
  const crumbCount = Math.max(2, Math.ceil(bodyLength / crumbSpacing) + 1);
  const crumbs: Breadcrumb[] = [];
  let tracePose = headPose;
  let bounced = false;

  for (let i = crumbCount - 1; i >= 0; i--) {
    const arcLength = i * crumbSpacing;
    const frame = poseToWorld(tracePose);
    crumbs.unshift({ pose: tracePose, position: frame.position, arcLength });
    if (i === 0 || bounced) continue;

    const reversed = turn(tracePose, Math.PI);
    const { pose: steppedReversed, bounced: hitBounce } = advanceTracking(reversed, crumbSpacing);
    if (hitBounce) {
      bounced = true;
      continue;
    }
    tracePose = turn(steppedReversed, Math.PI);
  }

  return {
    crumbs,
    headPose,
    headArcLength: (crumbCount - 1) * crumbSpacing,
    distanceSinceLastCrumb: 0,
    bodyLength,
    crumbSpacing,
  };
}

/** Re-seeds `spine` in place from a fresh `headPose` — the same back-trace
 * `createSpine` does, for a snail that just landed after a detach (a wall
 * sleeper falling at dawn, or a fish knocking it loose): the body should
 * lay out correctly around the landing spot immediately, not carry over
 * breadcrumbs from wherever it detached. */
export function resetSpine(spine: CrawlSpine, headPose: CrawlPose): void {
  const fresh = createSpine(headPose, spine.bodyLength, spine.crumbSpacing);
  spine.crumbs = fresh.crumbs;
  spine.headPose = fresh.headPose;
  spine.headArcLength = fresh.headArcLength;
  spine.distanceSinceLastCrumb = 0;
}

/** A generous safety valve, not a value normal crawling ever approaches —
 * this caller's own render loop clamps its frame delta well below one
 * `crumbSpacing` per call in practice, so the loop below only ever runs a
 * handful of iterations. It exists for the same reason `crawlSurfaces.ts`'s
 * own `MAX_FOLD_STEPS` does: this module is deliberately reusable by a
 * future second crawling critter (this file's own header), and a future
 * caller that hands this an extreme one-shot `distance` (a render loop with
 * no delta clamp of its own, recovering from a long stall) shouldn't be
 * able to force thousands of synchronous crumb-sized sub-steps in one
 * call. */
const MAX_ADVANCE_STEPS = 256;

/** Advances the spine's head by `distance` along its current heading
 * turned first by `turnDelta` (mirroring `Snail.tsx`'s own
 * `advance(turn(pose, delta), distance)` pattern), recording a new
 * breadcrumb every time `crumbSpacing` worth of travel accumulates and
 * trimming crumbs the body no longer reaches.
 *
 * Steps in `crumbSpacing`-sized increments (via repeated `advance()` calls)
 * rather than one big jump, so a crumb is recorded at its own correct
 * intermediate pose even when `distance` spans more than one spacing in a
 * single call (a large frame delta) — the alternative, stamping every due
 * crumb at the final head pose, would collapse several breadcrumbs onto
 * one point. Each individual `advance()` sub-step still folds across
 * however many links it needs to on its own, exactly as a single big call
 * would. */
export function advanceSpine(spine: CrawlSpine, distance: number, turnDelta: number): void {
  let pose = turn(spine.headPose, turnDelta);
  let remaining = distance;

  for (let step = 0; remaining > 0 && step < MAX_ADVANCE_STEPS; step++) {
    const toNextCrumb = spine.crumbSpacing - spine.distanceSinceLastCrumb;
    const stepDistance = Math.min(remaining, toNextCrumb);
    pose = advance(pose, stepDistance);
    spine.headArcLength += stepDistance;
    spine.distanceSinceLastCrumb += stepDistance;
    remaining -= stepDistance;

    if (spine.distanceSinceLastCrumb >= spine.crumbSpacing - 1e-9) {
      spine.distanceSinceLastCrumb = 0;
      const frame = poseToWorld(pose);
      spine.crumbs.push({ pose, position: frame.position, arcLength: spine.headArcLength });
    }
  }

  if (remaining > 0) {
    // The safety valve above tripped — cover whatever's left in a single
    // jump rather than continuing to stall on crumb-sized sub-steps. This
    // trades fine-grained crumb resolution across that one extreme jump
    // for a call that's guaranteed to return, which is the right side of
    // that trade for a caller that's already catching up from a stall.
    pose = advance(pose, remaining);
    spine.headArcLength += remaining;
    spine.distanceSinceLastCrumb = 0;
    const frame = poseToWorld(pose);
    spine.crumbs.push({ pose, position: frame.position, arcLength: spine.headArcLength });
  }

  spine.headPose = pose;

  const minArcLength = spine.headArcLength - spine.bodyLength - spine.crumbSpacing;
  while (spine.crumbs.length > 2 && spine.crumbs[0]!.arcLength < minArcLength) {
    spine.crumbs.shift();
  }
}

/** The sample at a given arc length behind the head — a straight-line
 * (chord) interpolation between the two bracketing recorded points for
 * `position` (the chord error at typical crumb spacing/turn radii is
 * invisible — `docs/architecture/3d-engine.md`'s own note on this), but
 * `faceId`/`u`/`v` come from whichever bracketing point is *nearer* rather
 * than being interpolated themselves: two adjacent points either side of a
 * fold live in different faces' own local coordinates, so their `u`/`v`
 * values aren't meaningfully lerpable, only their shared world-space
 * `position` is. */
function sampleAt(spine: CrawlSpine, targetArcLength: number): SpineSample {
  const lastCrumb = spine.crumbs[spine.crumbs.length - 1];
  if (!lastCrumb) throw new Error('crawlSpine: cannot sample an empty spine');

  const headIsPastLastCrumb = spine.headArcLength > lastCrumb.arcLength + 1e-9;
  const points = headIsPastLastCrumb
    ? [
        ...spine.crumbs,
        {
          pose: spine.headPose,
          position: poseToWorld(spine.headPose).position,
          arcLength: spine.headArcLength,
        },
      ]
    : spine.crumbs;

  const first = points[0]!;
  if (targetArcLength <= first.arcLength) return toSample(first);

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (targetArcLength > b.arcLength) continue;

    const span = b.arcLength - a.arcLength;
    const t = span > 1e-9 ? (targetArcLength - a.arcLength) / span : 0;
    const nearer = targetArcLength - a.arcLength <= b.arcLength - targetArcLength ? a : b;
    return {
      position: lerpVec3(a.position, b.position, t),
      faceId: nearer.pose.faceId,
      u: nearer.pose.u,
      v: nearer.pose.v,
    };
  }

  return toSample(points[points.length - 1]!);
}

/** Samples the spine at each of `offsetsBehindHead` (world units behind the
 * live head; `0` is the head itself), clamped to the oldest point still on
 * record rather than throwing if a caller asks further back than the
 * spine currently holds (e.g. right after `resetSpine`, before the trail
 * has grown to `bodyLength` again). */
export function sampleSpine(spine: CrawlSpine, offsetsBehindHead: number[]): SpineSample[] {
  return offsetsBehindHead.map((offset) => sampleAt(spine, spine.headArcLength - offset));
}
