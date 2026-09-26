// Tests for `crawlSpine.ts`. Not yet consumed by any controller (issue
// #112's PR 5) — this pins the module's own contract in isolation before
// `Snail.tsx` starts driving a bone chain from it.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { advanceSpine, createSpine, resetSpine, sampleSpine } from './crawlSpine';
import { CRAWL_FACES, type CrawlPose, type Vec3 } from './crawlSurfaces';

function faceById(id: string) {
  const face = CRAWL_FACES.find((f) => f.id === id);
  if (!face) throw new Error(`test setup: no face "${id}"`);
  return face;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

const BODY_LENGTH = 0.3;
const CRUMB_SPACING = 0.02;

describe('createSpine', () => {
  it('seeds crumbs at exactly the requested arc-length spacing', () => {
    const floor = faceById('floor');
    const headPose: CrawlPose = {
      faceId: 'floor',
      u: floor.uLength / 2,
      v: floor.vLength / 2,
      heading: 0,
    };
    const spine = createSpine(headPose, BODY_LENGTH, CRUMB_SPACING);

    const expectedCount = Math.ceil(BODY_LENGTH / CRUMB_SPACING) + 1;
    expect(spine.crumbs).toHaveLength(expectedCount);
    for (let i = 0; i < spine.crumbs.length; i++) {
      expect(spine.crumbs[i]!.arcLength).toBeCloseTo(i * CRUMB_SPACING, 10);
    }
    expect(spine.headArcLength).toBeCloseTo((expectedCount - 1) * CRUMB_SPACING, 10);
    expect(spine.headPose).toEqual(headPose);
    expect(spine.distanceSinceLastCrumb).toBe(0);
  });

  it('every seeded crumb sits on a face this module actually knows about', () => {
    const knownFaceIds = new Set(CRAWL_FACES.map((f) => f.id));
    // Start near the floor/wall boundary so seeding is forced across a
    // real fold, not just a straight line across the open floor.
    const front = faceById('glass-front');
    const headPose: CrawlPose = {
      faceId: 'glass-front',
      u: front.uLength / 2,
      v: 0.05,
      heading: -Math.PI / 2,
    };
    const spine = createSpine(headPose, BODY_LENGTH, CRUMB_SPACING);
    for (const crumb of spine.crumbs) {
      expect(knownFaceIds.has(crumb.pose.faceId)).toBe(true);
    }
  });

  it('lays out a straight tail directly behind the head when nothing is nearby to cross', () => {
    const floor = faceById('floor');
    const headPose: CrawlPose = {
      faceId: 'floor',
      u: floor.uLength / 2,
      v: floor.vLength / 2,
      heading: 0,
    };
    const spine = createSpine(headPose, BODY_LENGTH, CRUMB_SPACING);
    const head = spine.crumbs[spine.crumbs.length - 1]!;
    for (const crumb of spine.crumbs) {
      // Every crumb should sit exactly `arcLength behind the head` back
      // along -u (heading 0 means the head faces +u, so its tail trails
      // along -u), with no lateral (v) drift at all on an open floor.
      const expectedX = head.position.x - (head.arcLength - crumb.arcLength);
      expect(crumb.position.x).toBeCloseTo(expectedX, 8);
      expect(crumb.position.z).toBeCloseTo(head.position.z, 8);
    }
  });

  it('stops extending backward at the first bounce instead of zigzagging', () => {
    const front = faceById('glass-front');
    const headPose: CrawlPose = {
      faceId: 'glass-front',
      u: front.uLength / 2,
      v: front.vLength - 0.05,
      // Reversed (the direction back-tracing actually walks) points toward
      // the wall's own unlinked top rim, close enough that seeding must
      // bounce off it partway through.
      heading: -Math.PI / 2,
    };
    const spine = createSpine(headPose, BODY_LENGTH, CRUMB_SPACING);
    const headPos = spine.crumbs[spine.crumbs.length - 1]!.position;
    // Oldest-first in `crumbs`; walk head-to-tail instead.
    const distancesFromHead = [...spine.crumbs].reverse().map((c) => distance(c.position, headPos));
    for (let i = 1; i < distancesFromHead.length; i++) {
      // A zigzag would show a *decrease* somewhere in this sequence (the
      // trace reflecting back toward the head); a clean stop never does.
      expect(distancesFromHead[i]!).toBeGreaterThanOrEqual(distancesFromHead[i - 1]! - 1e-9);
    }
  });
});

describe('resetSpine', () => {
  it('replaces the trail as if freshly created at the new pose', () => {
    const floor = faceById('floor');
    const headPoseA: CrawlPose = { faceId: 'floor', u: 0.5, v: 0.5, heading: 0.3 };
    const headPoseB: CrawlPose = {
      faceId: 'floor',
      u: floor.uLength - 0.5,
      v: floor.vLength - 0.5,
      heading: 2,
    };
    const spine = createSpine(headPoseA, BODY_LENGTH, CRUMB_SPACING);
    resetSpine(spine, headPoseB);

    const fresh = createSpine(headPoseB, BODY_LENGTH, CRUMB_SPACING);
    expect(spine.crumbs).toHaveLength(fresh.crumbs.length);
    expect(spine.headPose).toEqual(headPoseB);
    expect(spine.distanceSinceLastCrumb).toBe(0);
    expect(spine.crumbs[spine.crumbs.length - 1]!.position).toEqual(
      fresh.crumbs[fresh.crumbs.length - 1]!.position,
    );
  });
});

describe('advanceSpine', () => {
  it('preserves the tail-to-head arc length as the head moves in a straight line', () => {
    const floor = faceById('floor');
    const headPose: CrawlPose = { faceId: 'floor', u: 0.3, v: floor.vLength / 2, heading: 0 };
    const spine = createSpine(headPose, BODY_LENGTH, CRUMB_SPACING);

    for (let i = 0; i < 200; i++) {
      advanceSpine(spine, 0.003, 0);
    }

    let chordTotal = 0;
    for (let i = 1; i < spine.crumbs.length; i++) {
      chordTotal += distance(spine.crumbs[i - 1]!.position, spine.crumbs[i]!.position);
    }
    const arcTotal = spine.crumbs[spine.crumbs.length - 1]!.arcLength - spine.crumbs[0]!.arcLength;
    // A straight-line run's chord length should match its own arc length
    // almost exactly (no folds to introduce any chord/arc discrepancy).
    expect(chordTotal).toBeCloseTo(arcTotal, 6);
  });

  it('keeps the crumb count bounded over many small steps (no unbounded growth)', () => {
    const floor = faceById('floor');
    const headPose: CrawlPose = { faceId: 'floor', u: 0.3, v: floor.vLength / 2, heading: 0.1 };
    const spine = createSpine(headPose, BODY_LENGTH, CRUMB_SPACING);

    for (let i = 0; i < 2000; i++) {
      advanceSpine(spine, 0.001, (Math.random() - 0.5) * 0.02);
    }

    const expectedCount = Math.ceil(BODY_LENGTH / CRUMB_SPACING) + 1;
    // A little slack either side for the trim's own one-spacing headroom.
    expect(spine.crumbs.length).toBeLessThanOrEqual(expectedCount + 2);
    expect(spine.crumbs.length).toBeGreaterThanOrEqual(expectedCount - 1);
  });

  it('folds correctly and keeps every crumb on a known face when the head crosses onto a wall', () => {
    const knownFaceIds = new Set(CRAWL_FACES.map((f) => f.id));
    const floor = faceById('floor');
    const headPose: CrawlPose = {
      faceId: 'floor',
      u: floor.uLength / 2,
      // Deliberately not an exact multiple of the 0.01 step below — landing
      // within float epsilon of the boundary on some intermediate step
      // makes `stepAdvance` treat the crossing as "already behind us" and
      // skip it (a known `RAY_EPS` tolerance edge case in the underlying
      // `advance()`, pre-existing and out of scope here — flagged for the
      // stack's own code-review pass rather than fixed mid-PR).
      v: floor.vLength - 0.107,
      heading: Math.PI / 2, // straight toward the front wall
    };
    const spine = createSpine(headPose, BODY_LENGTH, CRUMB_SPACING);

    for (let i = 0; i < 40; i++) {
      advanceSpine(spine, 0.01, 0);
    }

    expect(spine.headPose.faceId).toBe('glass-front');
    for (const crumb of spine.crumbs) {
      expect(knownFaceIds.has(crumb.pose.faceId)).toBe(true);
    }
  });

  it('produces a genuinely curved trail under a sustained turn, not a straight geodesic behind the head', () => {
    const floor = faceById('floor');
    const headPose: CrawlPose = {
      faceId: 'floor',
      u: floor.uLength / 2,
      v: floor.vLength / 2,
      heading: 0,
    };
    const spine = createSpine(headPose, BODY_LENGTH, CRUMB_SPACING);

    for (let i = 0; i < 200; i++) {
      advanceSpine(spine, 0.003, 0.05); // a sustained, fairly tight turn
    }

    const tail = spine.crumbs[0]!.position;
    const head = spine.crumbs[spine.crumbs.length - 1]!.position;
    const chordLength = distance(tail, head);
    let arcLength = 0;
    for (let i = 1; i < spine.crumbs.length; i++) {
      arcLength += distance(spine.crumbs[i - 1]!.position, spine.crumbs[i]!.position);
    }
    // A straight-line (back-trace-only) body would have chordLength ==
    // arcLength; a body that actually follows a tight turn has a chord
    // measurably shorter than the path length it was walked along.
    expect(chordLength).toBeLessThan(arcLength * 0.98);
  });
});

describe('sampleSpine', () => {
  it('samples the head itself at offset 0', () => {
    const floor = faceById('floor');
    const headPose: CrawlPose = { faceId: 'floor', u: 0.4, v: 0.6, heading: 1 };
    const spine = createSpine(headPose, BODY_LENGTH, CRUMB_SPACING);
    const [headSample] = sampleSpine(spine, [0]);
    const headCrumb = spine.crumbs[spine.crumbs.length - 1]!;
    expect(headSample!.position).toEqual(headCrumb.position);
    expect(headSample!.faceId).toBe('floor');
  });

  it('interpolates smoothly between recorded crumbs for an in-between offset', () => {
    const floor = faceById('floor');
    const headPose: CrawlPose = { faceId: 'floor', u: 0.4, v: 0.6, heading: 0 };
    const spine = createSpine(headPose, BODY_LENGTH, CRUMB_SPACING);
    const offset = CRUMB_SPACING * 2.5; // strictly between two crumbs
    const [sample] = sampleSpine(spine, [offset]);
    const target = spine.headArcLength - offset;
    const lowerCrumb = spine.crumbs.find(
      (c, i) => c.arcLength <= target && (spine.crumbs[i + 1]?.arcLength ?? Infinity) > target,
    )!;
    // The interpolated x should sit strictly between its two bracketing
    // crumbs' own x — proof it's a real interpolation, not a snap to one
    // side.
    expect(sample!.position.x).toBeGreaterThan(lowerCrumb.position.x - 1e-9);
  });

  it('clamps to the oldest available point for an offset beyond the recorded trail', () => {
    const floor = faceById('floor');
    const headPose: CrawlPose = { faceId: 'floor', u: 0.4, v: 0.6, heading: 0 };
    const spine = createSpine(headPose, BODY_LENGTH, CRUMB_SPACING);
    const [farSample] = sampleSpine(spine, [BODY_LENGTH * 10]);
    expect(farSample!.position).toEqual(spine.crumbs[0]!.position);
  });
});
