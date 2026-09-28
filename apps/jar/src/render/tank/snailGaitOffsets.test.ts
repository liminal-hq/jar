// Tests for the gait's accordion sampling — the two invariants a controller
// can't assert about itself, checked against the live constants at every life
// stage rather than against hand-picked numbers: the wave never reorders two
// bones, and the spine it samples always holds trail deep enough to answer it.
//
// The trail test drives a real `CrawlSpine` over the real crawl surfaces,
// because the failure it guards against is silent by construction:
// `sampleSpine` clamps a too-deep query instead of throwing, so an
// under-provisioned spine reads as a tail that simply stops moving.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { lifeStageScale } from '../../domain/simConstants';
import type { LifeStage } from '../../domain/protocol/generated/LifeStage';
import { advanceSpine, createSpine, sampleSpine } from '../environment/crawlSpine';
import { randomFloorPose } from '../environment/crawlSurfaces';
import {
  FOOT_BONE_XS,
  FOOT_TAIL_TIP_X,
  FOOT_TOE_X,
  SNAIL_BODY_SCALE,
  SVG_SCALE,
} from '../models/snailGeometry';
import {
  accordionAmplitude,
  accordionKeepsBonesOrdered,
  accordionWavenumber,
  gaitBoneOffsets,
  sampledBodyLength,
  withAccordionWave,
} from './snailGaitOffsets';

/** `Snail.tsx`'s own `CRUMB_SAMPLES_PER_BODY`. */
const CRUMB_SAMPLES_PER_BODY = 24;

const STAGES: LifeStage[] = ['Fry', 'Juvenile', 'Adult', 'Elder'];

/** Everything `Snail.tsx` derives per render, for one life stage. */
function dimensionsFor(stage: LifeStage) {
  const scale = lifeStageScale(stage) * SVG_SCALE * SNAIL_BODY_SCALE;
  const bodyLength = (FOOT_TOE_X - FOOT_TAIL_TIP_X) * scale;
  const crumbSpacing = bodyLength / CRUMB_SAMPLES_PER_BODY;
  return {
    scale,
    bodyLength,
    crumbSpacing,
    boneOffsets: FOOT_BONE_XS.map((x) => (FOOT_TOE_X - x) * scale),
    amplitude: accordionAmplitude(crumbSpacing),
    k: accordionWavenumber(bodyLength),
    spineLength: sampledBodyLength(bodyLength, crumbSpacing),
  };
}

const PHASES = Array.from({ length: 240 }, (_, i) => (i * 2 * Math.PI) / 240);

describe('withAccordionWave', () => {
  it('is a pure offset perturbation, zero-mean over a cycle', () => {
    const { k, amplitude } = dimensionsFor('Adult');
    const offset = 0.2;
    const mean =
      PHASES.reduce((sum, phase) => sum + withAccordionWave(offset, phase, k, amplitude), 0) /
      PHASES.length;
    expect(mean).toBeCloseTo(offset, 6);
  });

  it('never moves an offset by more than the amplitude', () => {
    const { k, amplitude, boneOffsets } = dimensionsFor('Adult');
    for (const phase of PHASES) {
      for (const offset of boneOffsets) {
        expect(
          Math.abs(withAccordionWave(offset, phase, k, amplitude) - offset),
        ).toBeLessThanOrEqual(amplitude + 1e-12);
      }
    }
  });
});

describe('the accordion wave', () => {
  it('keeps the bones in order at every life stage and phase', () => {
    for (const stage of STAGES) {
      const { boneOffsets, k, amplitude } = dimensionsFor(stage);
      expect(accordionKeepsBonesOrdered(k, amplitude)).toBe(true);
      for (const phase of PHASES) {
        const offsets = gaitBoneOffsets(boneOffsets, phase, k, amplitude);
        for (let i = 1; i < offsets.length; i++) {
          // `FOOT_BONE_XS` runs tail-to-toe, so the offsets behind the head
          // run deepest-first — a strictly decreasing run is what
          // `computeBoneFrames`'s own sort must never have to reorder.
          expect(offsets[i]!).toBeLessThan(offsets[i - 1]!);
        }
      }
    }
  });

  it('is bounded by the ordering criterion it is tuned against', () => {
    // The criterion itself, so a retune that crosses it fails here rather than
    // in a body that reads its own neighbours' tangents.
    expect(accordionKeepsBonesOrdered(1, 0.99)).toBe(true);
    expect(accordionKeepsBonesOrdered(1, 1.01)).toBe(false);
    expect(accordionKeepsBonesOrdered(2, 0.6)).toBe(false);
  });
});

describe('sampledBodyLength', () => {
  it('covers the deepest offset the gait can ask for, at every life stage', () => {
    for (const stage of STAGES) {
      const { boneOffsets, k, amplitude, spineLength } = dimensionsFor(stage);
      const deepest = Math.max(
        ...PHASES.flatMap((phase) => gaitBoneOffsets(boneOffsets, phase, k, amplitude)),
      );
      expect(spineLength).toBeGreaterThanOrEqual(deepest - 1e-12);
    }
  });

  it('is longer than the body itself — the whole point of it', () => {
    const { bodyLength, spineLength } = dimensionsFor('Adult');
    expect(spineLength).toBeGreaterThan(bodyLength);
  });
});

/** A deterministic generator, so a failure is reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** `Snail.tsx`'s base crawl speed and gait rate, per simulated 60Hz frame. */
const STEP = 0.12 / 60;
const PHASE_STEP = 1.4 / 60;

/** Walks a fresh spine of `spineBodyLength` well past its steady state, then
 * reports how often the gait's deepest offset falls past the recorded trail,
 * and how far the tail-most sample's world position travels over a full gait
 * cycle at a frozen spine. */
function walk(spineBodyLength: number, stage: LifeStage = 'Adult') {
  const { boneOffsets, k, amplitude, crumbSpacing } = dimensionsFor(stage);
  const spine = createSpine(randomFloorPose(seededRandom(20260927)), spineBodyLength, crumbSpacing);
  for (let i = 0; i < 2000; i++) advanceSpine(spine, STEP, 0);

  let clamped = 0;
  for (let i = 0; i < 2000; i++) {
    advanceSpine(spine, STEP, 0);
    const deepest = gaitBoneOffsets(boneOffsets, i * PHASE_STEP, k, amplitude)[0]!;
    if (deepest > spine.headArcLength - spine.crumbs[0]!.arcLength + 1e-9) clamped++;
  }

  // Frozen spine, one full gait cycle: how much ground does the tail-most
  // sample actually cover? A clamped sample stops at the oldest crumb and
  // stops contributing, flattening the compression wave at the tail.
  const tailPositions = PHASES.map(
    (phase) => sampleSpine(spine, [gaitBoneOffsets(boneOffsets, phase, k, amplitude)[0]!])[0]!,
  );
  let tailTravel = 0;
  for (let i = 1; i < tailPositions.length; i++) {
    const a = tailPositions[i - 1]!.position;
    const b = tailPositions[i]!.position;
    tailTravel += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }

  return { clamped, tailTravel, amplitude };
}

describe('a spine sized for the gait', () => {
  it('never asks for trail it does not hold', () => {
    const { spineLength } = dimensionsFor('Adult');
    expect(walk(spineLength).clamped).toBe(0);
  });

  it('lets the tail-most sample sweep the full excursion of the wave', () => {
    const { spineLength } = dimensionsFor('Adult');
    const { tailTravel, amplitude } = walk(spineLength);
    // One cycle sweeps the offset from +amplitude to -amplitude and back, so a
    // fully-answered sample travels about 4x the amplitude along the trail.
    expect(tailTravel).toBeGreaterThan(3.5 * amplitude);
  });

  it('would clamp and flatten the tail if sized to the body alone', () => {
    // The control: the gap this sizing closes is real, not a theoretical
    // margin. `sampleSpine` clamps rather than throwing, so nothing else in the
    // system would ever have reported it.
    const { bodyLength, spineLength } = dimensionsFor('Adult');
    const short = walk(bodyLength);
    expect(short.clamped).toBeGreaterThan(0);
    expect(short.tailTravel).toBeLessThan(walk(spineLength).tailTravel);
  });
});
