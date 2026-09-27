// The whole snail rig, driven over the tank's *real* surface graph rather
// than synthetic folds — `crawlSurfaces.ts`'s actual faces and links, a real
// `CrawlSpine` advancing a frame at a time at the real crawl speed, and the
// real `snailFootRig.ts` derivation, for a hundred thousand frames of
// crawling.
//
// This exists because synthetic single folds (`snailFootRig.test.ts`) are
// not the shape of the problem. The tank's castle is a cluster of small
// boxes whose tops, sides and vertical corners meet within a fraction of a
// snail's own body length, so a body routinely spans two or three faces at
// once and its sampling points straddle creases at different moments.
// Everything that has gone wrong with this rig has gone wrong *there*, and
// stayed invisible on a flat floor and a single wall.
//
// Two properties, both of which a person would describe as "the snail looks
// right" and neither of which any per-function test caught:
//
//   - the shell never leaves the foot (measured at the shell's *apex*, not
//     its seat: the seat is a contact point that stays glued even while the
//     shell rotates away about it, which is exactly how a 32%-of-body-length
//     separation hid behind a 2% seat-gap reading);
//   - the body never snaps (the root's orientation changes smoothly from one
//     frame to the next, rather than stepping as sampling points cross
//     breadcrumb boundaries).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  advanceSpine,
  createSpine,
  sampleSpine,
  type CrawlSpine,
  type SpineSample,
} from '../environment/crawlSpine';
import { CRAWL_FACES, type CrawlPose } from '../environment/crawlSurfaces';
import { rootTransformFromFoot, type SampledFrame } from '../models/snailFootRig';
import {
  FOOT_BONE_XS,
  FOOT_TAIL_TIP_X,
  FOOT_TOE_X,
  SHELL_APEX_HEIGHT_ABOVE_SOLE,
  SHELL_SEAT_X,
  SNAIL_BODY_SCALE,
  SOLE_Y,
  SVG_SCALE,
} from '../models/snailGeometry';

/** An adult snail, the largest and so the worst case — a longer body spans
 * more creases at once. */
const SCALE = SVG_SCALE * SNAIL_BODY_SCALE;
const BODY_LENGTH = (FOOT_TOE_X - FOOT_TAIL_TIP_X) * SCALE;
/** `Snail.tsx`'s own `CRUMB_SAMPLES_PER_BODY`. */
const CRUMB_SPACING = BODY_LENGTH / 24;
const BONE_OFFSETS = FOOT_BONE_XS.map((x) => (FOOT_TOE_X - x) * SCALE);
/** `CRAWL_SPEED` for one 60fps frame. */
const STEP = 0.12 / 60;
/** The tallest shell, so the longest lever arm from the seat. */
const APEX_ABOVE_SOLE = Math.max(...Object.values(SHELL_APEX_HEIGHT_ABOVE_SOLE));

const FALLBACK_TANGENTS = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)];

/** `Snail.tsx`'s own `sampledFrameAt`, which is a component-private
 * function — kept in step with it deliberately, since what's under test is
 * the pipeline it sits in, not the function. */
function sampledFrameAt(samples: SpineSample[], index: number): SampledFrame {
  const sample = samples[index]!;
  const position = new THREE.Vector3(sample.position.x, sample.position.y, sample.position.z);
  const up = new THREE.Vector3(sample.normal.x, sample.normal.y, sample.normal.z);
  const prev = samples[index - 1];
  const next = samples[index + 1];
  const tangent = new THREE.Vector3();
  if (prev && next)
    tangent.set(
      prev.position.x - next.position.x,
      prev.position.y - next.position.y,
      prev.position.z - next.position.z,
    );
  else if (next)
    tangent.set(
      sample.position.x - next.position.x,
      sample.position.y - next.position.y,
      sample.position.z - next.position.z,
    );
  else if (prev)
    tangent.set(
      prev.position.x - sample.position.x,
      prev.position.y - sample.position.y,
      prev.position.z - sample.position.z,
    );
  let rejected = tangent.clone().sub(up.clone().multiplyScalar(tangent.dot(up)));
  if (rejected.lengthSq() < 1e-12) {
    for (const fallback of FALLBACK_TANGENTS) {
      rejected = fallback.clone().sub(up.clone().multiplyScalar(fallback.dot(up)));
      if (rejected.lengthSq() >= 1e-12) break;
    }
  }
  return { position, up, forward: rejected.normalize() };
}

function boneFramesOf(spine: CrawlSpine): SampledFrame[] {
  const order = BONE_OFFSETS.map((_, i) => i).sort((a, b) => BONE_OFFSETS[a]! - BONE_OFFSETS[b]!);
  const samples = sampleSpine(
    spine,
    order.map((i) => BONE_OFFSETS[i]!),
  );
  const frames: SampledFrame[] = new Array(BONE_OFFSETS.length);
  order.forEach((original, sorted) => {
    frames[original] = sampledFrameAt(samples, sorted);
  });
  return frames;
}

/** A bone's own world orientation — `forward`→`+X`, `up`→`+Y`, the
 * convention the chain is laid out along. */
function boneQuaternion(frame: SampledFrame): THREE.Quaternion {
  const zAxis = new THREE.Vector3().crossVectors(frame.forward, frame.up).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(frame.forward, frame.up, zAxis),
  );
}

const seatBone = (() => {
  let index = 0;
  while (index < FOOT_BONE_XS.length - 2 && FOOT_BONE_XS[index + 1]! < SHELL_SEAT_X) index++;
  const xa = FOOT_BONE_XS[index]!;
  const xb = FOOT_BONE_XS[index + 1]!;
  return { index, t: (SHELL_SEAT_X - xa) / (xb - xa) };
})();

/** How far the shell's apex renders from where the *foot* carries that same
 * material point — the honest "is the shell still on the animal" number. */
function shellApexOffFoot(frames: SampledFrame[], root: ReturnType<typeof rootTransformFromFoot>) {
  const apex = new THREE.Vector3(SHELL_SEAT_X, SOLE_Y + APEX_ABOVE_SOLE, 0);
  const modelMatrix = new THREE.Matrix4()
    .compose(root.position, root.quaternion, new THREE.Vector3(1, 1, 1))
    .multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2))
    .multiply(new THREE.Matrix4().makeScale(SCALE, SCALE, SCALE));
  const rendered = apex.clone().applyMatrix4(modelMatrix);

  const carried = (i: number) =>
    apex
      .clone()
      .sub(new THREE.Vector3(FOOT_BONE_XS[i]!, SOLE_Y, 0))
      .multiplyScalar(SCALE)
      .applyQuaternion(boneQuaternion(frames[i]!))
      .add(frames[i]!.position);
  const onFoot = carried(seatBone.index).lerp(carried(seatBone.index + 1), seatBone.t);
  return rendered.distanceTo(onFoot);
}

interface Result {
  frames: number;
  worstOffFoot: number;
  worstOffFootWhere: string;
  worstSwingDeg: number;
  worstSwingWhere: string;
}

function crawlEverywhere(): Result {
  const result: Result = {
    frames: 0,
    worstOffFoot: 0,
    worstOffFootWhere: '',
    worstSwingDeg: 0,
    worstSwingWhere: '',
  };
  const headings = [0, Math.PI / 6, Math.PI / 4, Math.PI / 3, Math.PI / 2, -Math.PI / 4];
  const fractions = [0.12, 0.5, 0.88];

  for (const face of CRAWL_FACES) {
    for (const heading of headings) {
      for (const fraction of fractions) {
        const start: CrawlPose = {
          faceId: face.id,
          u: face.uLength * fraction,
          v: face.vLength * 0.5,
          heading,
        };
        const spine = createSpine(start, BODY_LENGTH, CRUMB_SPACING);
        let previous: THREE.Quaternion | null = null;
        for (let step = 0; step < 200; step++) {
          advanceSpine(spine, STEP, 0);
          const frames = boneFramesOf(spine);
          const root = rootTransformFromFoot(frames, FOOT_BONE_XS, SHELL_SEAT_X, SOLE_Y, SCALE);
          result.frames++;

          const where = `${face.id} heading ${((heading * 180) / Math.PI).toFixed(0)}° u=${fraction} step ${step}`;
          const offFoot = shellApexOffFoot(frames, root);
          if (offFoot > result.worstOffFoot) {
            result.worstOffFoot = offFoot;
            result.worstOffFootWhere = where;
          }
          if (previous) {
            const swing = (previous.angleTo(root.quaternion) * 180) / Math.PI;
            if (swing > result.worstSwingDeg) {
              result.worstSwingDeg = swing;
              result.worstSwingWhere = where;
            }
          }
          previous = root.quaternion.clone();
        }
      }
    }
  }
  return result;
}

describe('a snail crawling the real tank', () => {
  const result = crawlEverywhere();

  it('covers every crawl surface, including the castle', () => {
    expect(result.frames).toBeGreaterThan(50_000);
    expect(CRAWL_FACES.filter((f) => f.id.startsWith('castle')).length).toBeGreaterThan(10);
  });

  it('never lets the shell leave the foot', () => {
    // Deriving the root from a spine sample of its own instead of from the
    // foot's own bones put this at 32% of a body length, on the castle's
    // box tops and corners — a shell visibly floating off its own snail.
    // The residue is the difference between slerping two bone frames and the
    // linear blend the skinned mesh does between the same two, which moves
    // the shell *with* the foot rather than away from it.
    expect(result.worstOffFoot / BODY_LENGTH).toBeLessThan(0.08);
  });

  it('never snaps the body from one frame to the next', () => {
    // Re-deriving each sample's normal from the `faceId`/`u`/`v` that
    // `sampleSpine` snaps to the nearer crumb made this step by tens of
    // degrees in a single frame as a sampling point crossed a breadcrumb
    // boundary near a crease — the same class of visible blip issue #112
    // was opened to remove. At this crawl speed a real fold crossing takes
    // most of a second, so no single frame has any business turning the
    // body more than a few degrees.
    expect(result.worstSwingDeg).toBeLessThan(10);
  });
});
