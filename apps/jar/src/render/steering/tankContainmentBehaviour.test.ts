// Tests for pushAxis's gating/direction/graded magnitude, for the
// square-on-approach fix (a wall push mirrored onto a different axis so
// it's never purely antiparallel to a fish's heading), and for
// TankContainmentBehaviour's yaw-aware anisotropic margins.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';
import * as YUKA from 'yuka';

import { TANK_INNER_BOUNDS } from '../physics/coordinates';
import { verticalExtent, type ColliderHalfExtents } from '../tank/fishCollider';
import {
  pushAxis,
  TankContainmentBehaviour,
  withTangentialNudge,
} from './tankContainmentBehaviour';

const BOUND = 3;
const MARGIN = 0.5;
const STRENGTH = 4;

describe('pushAxis', () => {
  it('is zero comfortably clear of the wall', () => {
    expect(pushAxis(0, BOUND, MARGIN, STRENGTH)).toBe(0);
  });

  it('is zero exactly at the margin boundary', () => {
    expect(pushAxis(BOUND - MARGIN, BOUND, MARGIN, STRENGTH)).toBeCloseTo(0, 5);
    expect(pushAxis(-(BOUND - MARGIN), BOUND, MARGIN, STRENGTH)).toBeCloseTo(0, 5);
  });

  it('pushes back toward the centre near the positive wall', () => {
    expect(pushAxis(BOUND - MARGIN / 2, BOUND, MARGIN, STRENGTH)).toBeLessThan(0);
  });

  it('pushes back toward the centre near the negative wall', () => {
    expect(pushAxis(-(BOUND - MARGIN / 2), BOUND, MARGIN, STRENGTH)).toBeGreaterThan(0);
  });

  it('ramps to full strength right at the wall', () => {
    expect(pushAxis(BOUND, BOUND, MARGIN, STRENGTH)).toBeCloseTo(-STRENGTH, 5);
  });

  it('clamps at full strength past the wall rather than growing further', () => {
    expect(pushAxis(BOUND + 10, BOUND, MARGIN, STRENGTH)).toBeCloseTo(-STRENGTH, 5);
  });
});

describe('withTangentialNudge', () => {
  it('applies the nudge directly when the axis has no push of its own', () => {
    expect(withTangentialNudge(0, -4, 1, 0.2)).toBeCloseTo(0.8, 10);
    expect(withTangentialNudge(0, -4, -1, 0.2)).toBeCloseTo(-0.8, 10);
  });

  it('never produces a signed zero when the axis and source are both clear', () => {
    expect(Object.is(withTangentialNudge(0, 0, 1, 0.2), 0)).toBe(true);
    expect(Object.is(withTangentialNudge(0, 0, -1, 0.2), 0)).toBe(true);
  });

  it('never flips a shallow own push toward the wall it is already pushing away from', () => {
    // A fish deep in the +x wall's margin (pushX = -4, this axis's *source*)
    // sitting only barely inside the +y margin (a small, genuinely-correct
    // pushY of its own) — a raw, unclamped nudge this large (handedness=1
    // pushes +0.8) would overwhelm and flip a -0.2 own push positive,
    // steering back toward a wall this axis is actually still clear of.
    const shallowOwnPush = -0.2;
    const deepSourcePush = -4;
    expect(withTangentialNudge(shallowOwnPush, deepSourcePush, 1, 0.2)).toBeLessThanOrEqual(0);
    expect(withTangentialNudge(shallowOwnPush, deepSourcePush, -1, 0.2)).toBeLessThanOrEqual(0);
  });

  it('still resizes (without reversing) a same-sign own push', () => {
    // The nudge should still be free to make a push *stronger*, just never
    // flip its sign — magnitude changes are the whole point of the nudge.
    // handedness=-1 here makes the nudge itself negative (same sign as the
    // -2 own push), so it strengthens rather than weakens it.
    const result = withTangentialNudge(-2, -4, -1, 0.2);
    expect(result).toBeLessThan(-2);
  });

  it('discards the nudge entirely right at the boundary where it would reach exactly zero', () => {
    // own=-0.8, nudge=+0.8 sums to exactly 0 — same-sign check must treat a
    // reversal-to-exactly-zero as "flipped" (discard), not "still negative
    // enough" or "still fine to keep," since `Math.sign(0) === 0` never
    // equals `Math.sign(-0.8) === -1` either way, but this pins the exact
    // boundary explicitly rather than leaving it to fall out unasserted.
    expect(withTangentialNudge(-0.8, -4, 1, 0.2)).toBe(-0.8);
  });
});

describe('TankContainmentBehaviour', () => {
  // Half-extents for the ported (yaw-independent) test cases below — at
  // yaw 0, worldExtentX/worldExtentZ reduce exactly to HE.x/HE.z, so
  // choosing HE.x === HE.z === MARGIN reproduces the old scalar-margin
  // behaviour on those two axes exactly. `verticalExtent(HE)` (used for
  // the Y margin) doesn't reduce to MARGIN in general — tests that need
  // an exact Y offset compute it from `verticalExtent(HE)` directly
  // rather than reusing the old scalar, since that's what the real
  // production margin now is.
  const HE: ColliderHalfExtents = { x: MARGIN, y: 0.4, z: MARGIN };
  const BUFFER = 0;
  const marginY = verticalExtent(HE) + BUFFER;

  function makeBehaviour(yaw = 0): TankContainmentBehaviour {
    return new TankContainmentBehaviour(
      () => HE,
      BUFFER,
      () => yaw,
    );
  }

  it('produces zero force in the middle of the tank', () => {
    const behaviour = makeBehaviour();
    const vehicle = new YUKA.Vehicle();
    vehicle.position.set(0, 0, 0);
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force.x).toBe(0);
    expect(force.y).toBe(0);
    expect(force.z).toBe(0);
  });

  it('gives a square-on approach to a wall a nonzero sideways component', () => {
    // Centred on x and y (the degenerate case: a naive push here is purely
    // antiparallel to a fish heading straight at the +z wall, with nothing
    // to turn it aside).
    const behaviour = makeBehaviour();
    const vehicle = new YUKA.Vehicle();
    vehicle.position.set(0, 0, TANK_INNER_BOUNDS.z);
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force.z).toBeLessThan(0); // still pushes back off the wall
    expect(force.x).not.toBe(0); // but no longer a pure straight line
  });

  it('keeps the sideways nudge small relative to the main push', () => {
    const behaviour = makeBehaviour();
    const vehicle = new YUKA.Vehicle();
    vehicle.position.set(0, 0, TANK_INNER_BOUNDS.z);
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(Math.abs(force.x)).toBeLessThan(Math.abs(force.z));
  });

  it('gives the same fish a consistent turn direction across repeated calls', () => {
    const behaviour = makeBehaviour();
    const vehicle = new YUKA.Vehicle();
    vehicle.position.set(0, 0, TANK_INNER_BOUNDS.z);

    const first = new YUKA.Vector3();
    behaviour.calculate(vehicle, first);
    const second = new YUKA.Vector3();
    behaviour.calculate(vehicle, second);

    expect(Math.sign(second.x)).toBe(Math.sign(first.x));
  });

  it('still resolves toward the centre from a corner, on every axis at once', () => {
    const behaviour = makeBehaviour();
    const vehicle = new YUKA.Vehicle();
    vehicle.position.set(TANK_INNER_BOUNDS.x, TANK_INNER_BOUNDS.y, TANK_INNER_BOUNDS.z);
    const force = new YUKA.Vector3();

    behaviour.calculate(vehicle, force);

    expect(force.x).toBeLessThan(0);
    expect(force.y).toBeLessThan(0);
    expect(force.z).toBeLessThan(0);
  });

  it('never flips a shallow-penetration axis toward the wall it is still clear of, regardless of handedness', () => {
    // Full penetration on x (pushX = -4, the tangential *source* for y's
    // nudge), only barely inside the margin on y (a small, genuinely
    // correct pushY of its own) — the exact corner/edge shape that used to
    // let a large nudge from one wall override a smaller, unrelated axis's
    // own signal. Run several fresh instances (each rolls its own random
    // per-axis handedness at construction) so this can't pass by luck on
    // whichever sign happened to get rolled once.
    for (let i = 0; i < 20; i++) {
      const behaviour = makeBehaviour();
      const vehicle = new YUKA.Vehicle();
      const shallowY = TANK_INNER_BOUNDS.y - marginY * 0.95; // ~5% into the y margin
      vehicle.position.set(TANK_INNER_BOUNDS.x, shallowY, 0);
      const force = new YUKA.Vector3();

      behaviour.calculate(vehicle, force);

      expect(force.y).toBeLessThanOrEqual(0);
    }
  });

  it('never collapses to a pure scalar multiple of the heading at an exact symmetric corner', () => {
    // At a dead-centre corner approach, all three raw walls push equally —
    // mirroring an equal nudge onto every axis with the same sign (a single
    // shared handedness, or three independent signs that happen to land the
    // same by chance) just rescales that same, still-antiparallel vector,
    // reproducing the original stall for corners instead of flat walls.
    // Distinct per-axis fractions make the three post-nudge forces
    // *provably* unequal for any handedness draw, not just probably —
    // asserted here across enough fresh (randomly-handed) instances to
    // rule out a construction-time fluke rather than relying on the math
    // alone.
    for (let i = 0; i < 20; i++) {
      const behaviour = makeBehaviour();
      const vehicle = new YUKA.Vehicle();
      vehicle.position.set(TANK_INNER_BOUNDS.x, TANK_INNER_BOUNDS.y, TANK_INNER_BOUNDS.z);
      const force = new YUKA.Vector3();

      behaviour.calculate(vehicle, force);

      expect(force.x).not.toBeCloseTo(force.y, 5);
      expect(force.y).not.toBeCloseTo(force.z, 5);
      expect(force.x).not.toBeCloseTo(force.z, 5);
    }
  });

  describe('yaw-aware horizontal margins', () => {
    // A visibly asymmetric box — thin on x, long on z — so nose-on vs.
    // broadside approaches produce clearly different margins to assert on.
    const THIN_LONG: ColliderHalfExtents = { x: 0.05, y: 0.2, z: 0.5 };
    const buffer = 0.05;

    it('a nose-on approach to the x wall (length facing x) still gets pushed', () => {
      // yaw = π/2: heading.ts's forward = (sin yaw, 0, cos yaw) = (1,0,0),
      // so the fish's length axis faces world x — the same geometry as
      // heading straight at that wall.
      const behaviour = new TankContainmentBehaviour(
        () => THIN_LONG,
        buffer,
        () => Math.PI / 2,
      );
      const vehicle = new YUKA.Vehicle();
      const marginX = THIN_LONG.z + buffer; // worldExtentX(π/2) === z
      vehicle.position.set(TANK_INNER_BOUNDS.x - marginX * 0.5, 0, 0);
      const force = new YUKA.Vector3();

      behaviour.calculate(vehicle, force);

      expect(force.x).toBeLessThan(0);
    });

    it('the same position broadside to the x wall (thin side facing it) is not pushed', () => {
      // yaw = 0: length faces world z, thickness faces world x — the same
      // position that triggered a push nose-on now sits outside the much
      // smaller thickness-based margin.
      const behaviour = new TankContainmentBehaviour(
        () => THIN_LONG,
        buffer,
        () => 0,
      );
      const vehicle = new YUKA.Vehicle();
      const noseOnMarginX = THIN_LONG.z + buffer;
      vehicle.position.set(TANK_INNER_BOUNDS.x - noseOnMarginX * 0.5, 0, 0);
      const force = new YUKA.Vector3();

      behaviour.calculate(vehicle, force);

      expect(force.x).toBe(0);
    });

    it('push magnitude at a fixed near-wall position grows monotonically from broadside to nose-on', () => {
      const behaviour0 = new TankContainmentBehaviour(
        () => THIN_LONG,
        buffer,
        () => 0,
      );
      const behaviour45 = new TankContainmentBehaviour(
        () => THIN_LONG,
        buffer,
        () => Math.PI / 4,
      );
      const behaviour90 = new TankContainmentBehaviour(
        () => THIN_LONG,
        buffer,
        () => Math.PI / 2,
      );
      const vehicle = new YUKA.Vehicle();
      vehicle.position.set(TANK_INNER_BOUNDS.x, 0, 0);

      const f0 = new YUKA.Vector3();
      behaviour0.calculate(vehicle, f0);
      const f45 = new YUKA.Vector3();
      behaviour45.calculate(vehicle, f45);
      const f90 = new YUKA.Vector3();
      behaviour90.calculate(vehicle, f90);

      expect(Math.abs(f0.x)).toBeLessThanOrEqual(Math.abs(f45.x));
      expect(Math.abs(f45.x)).toBeLessThanOrEqual(Math.abs(f90.x));
    });

    it('the vertical margin does not change with yaw', () => {
      const vehicle = new YUKA.Vehicle();
      vehicle.position.set(0, TANK_INNER_BOUNDS.y, 0);

      const behaviourA = new TankContainmentBehaviour(
        () => THIN_LONG,
        buffer,
        () => 0.3,
      );
      const forceA = new YUKA.Vector3();
      behaviourA.calculate(vehicle, forceA);

      const behaviourB = new TankContainmentBehaviour(
        () => THIN_LONG,
        buffer,
        () => 2.1,
      );
      const forceB = new YUKA.Vector3();
      behaviourB.calculate(vehicle, forceB);

      expect(forceB.y).toBeCloseTo(forceA.y, 10);
    });
  });
});
