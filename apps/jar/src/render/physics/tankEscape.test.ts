// Tests for the escape detection threshold and the recovered position it
// hands back — including that a legally contained fish is never mistaken for
// an escaped one.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { TANK_INNER_BOUNDS, WALL_THICKNESS } from './coordinates';
import { hasEscapedTank, recoveredTankPosition, TANK_ESCAPE_BOUNDS } from './tankEscape';

/** A male Veil adult's length half-extent (`fishCollider.ts`'s
 * `adultColliderHalfExtentsFor`) plus the wall collider's half-thickness —
 * the widest clearance any critter in the tank asks for. */
const CLEARANCE = WALL_THICKNESS / 2 + 0.725;

describe('TANK_ESCAPE_BOUNDS', () => {
  it('sits on the outer face of each wall collider', () => {
    expect(TANK_ESCAPE_BOUNDS.x).toBeCloseTo(TANK_INNER_BOUNDS.x + WALL_THICKNESS / 2, 10);
    expect(TANK_ESCAPE_BOUNDS.y).toBeCloseTo(TANK_INNER_BOUNDS.y + WALL_THICKNESS / 2, 10);
    expect(TANK_ESCAPE_BOUNDS.z).toBeCloseTo(TANK_INNER_BOUNDS.z + WALL_THICKNESS / 2, 10);
  });
});

describe('hasEscapedTank', () => {
  it('is false in the middle of the tank', () => {
    expect(hasEscapedTank({ x: 0, y: 0, z: 0 })).toBe(false);
  });

  it('is false for a fish pressed right up against the glass from inside', () => {
    // The furthest in any direction a contained fish's *centre* can get: the
    // wall collider's inner face, which only a fish with a zero-width
    // collider could actually reach.
    expect(hasEscapedTank({ x: TANK_INNER_BOUNDS.x - WALL_THICKNESS / 2, y: 0, z: 0 })).toBe(false);
    expect(hasEscapedTank({ x: 0, y: -(TANK_INNER_BOUNDS.y - WALL_THICKNESS / 2), z: 0 })).toBe(
      false,
    );
  });

  it('is false on a wall collider centre plane, inside its own bulk', () => {
    expect(hasEscapedTank({ x: TANK_INNER_BOUNDS.x, y: 0, z: 0 })).toBe(false);
  });

  it('is true just past a wall collider outer face, on every axis and sign', () => {
    const past = TANK_ESCAPE_BOUNDS.x + 1e-6;
    expect(hasEscapedTank({ x: past, y: 0, z: 0 })).toBe(true);
    expect(hasEscapedTank({ x: -past, y: 0, z: 0 })).toBe(true);
    expect(hasEscapedTank({ x: 0, y: TANK_ESCAPE_BOUNDS.y + 1e-6, z: 0 })).toBe(true);
    expect(hasEscapedTank({ x: 0, y: -(TANK_ESCAPE_BOUNDS.y + 1e-6), z: 0 })).toBe(true);
    expect(hasEscapedTank({ x: 0, y: 0, z: TANK_ESCAPE_BOUNDS.z + 1e-6 })).toBe(true);
    expect(hasEscapedTank({ x: 0, y: 0, z: -(TANK_ESCAPE_BOUNDS.z + 1e-6) })).toBe(true);
  });

  it('is true at the position a fish stuck against the outside of the +x glass settles at', () => {
    // Rapier pushes an escaped fish's overlap out along the cheapest axis,
    // which parks its centre exactly its own length half-extent beyond the
    // wall collider's outer face — the "drifting slowly further out and never
    // coming back" state this whole module exists for.
    const settled = TANK_INNER_BOUNDS.x + WALL_THICKNESS / 2 + 0.725;
    expect(hasEscapedTank({ x: settled, y: 0, z: 0 })).toBe(true);
  });
});

describe('recoveredTankPosition', () => {
  it('returns null for a position that has not escaped', () => {
    expect(recoveredTankPosition({ x: 1, y: 0.5, z: -0.5 }, CLEARANCE)).toBeNull();
  });

  it('brings an escaped fish back inside, with its whole collider clear of the glass', () => {
    const recovered = recoveredTankPosition({ x: 3.63, y: 0, z: 0 }, CLEARANCE);
    expect(recovered).not.toBeNull();
    expect(recovered!.x).toBeCloseTo(TANK_INNER_BOUNDS.x - CLEARANCE, 10);
    expect(recovered!.y).toBe(0);
    expect(recovered!.z).toBe(0);
    expect(hasEscapedTank(recovered!)).toBe(false);
  });

  it('keeps the recovered position stable — one rescue, not a cycle', () => {
    const recovered = recoveredTankPosition({ x: 3.63, y: 0, z: 0 }, CLEARANCE)!;
    expect(recoveredTankPosition(recovered, CLEARANCE)).toBeNull();
  });

  it('clamps every axis, not just the one that triggered the escape', () => {
    // A fish out through the +x glass is in unbounded space and free to drift
    // anywhere out there before it's noticed.
    const recovered = recoveredTankPosition({ x: 5, y: -9, z: 12 }, CLEARANCE)!;
    expect(recovered.x).toBeCloseTo(TANK_INNER_BOUNDS.x - CLEARANCE, 10);
    expect(recovered.y).toBeCloseTo(-(TANK_INNER_BOUNDS.y - CLEARANCE), 10);
    expect(recovered.z).toBeCloseTo(TANK_INNER_BOUNDS.z - CLEARANCE, 10);
    expect(hasEscapedTank(recovered)).toBe(false);
  });

  it('preserves the sign of the axis it clamps', () => {
    const recovered = recoveredTankPosition({ x: -4, y: 0, z: 0 }, CLEARANCE)!;
    expect(recovered.x).toBeCloseTo(-(TANK_INNER_BOUNDS.x - CLEARANCE), 10);
  });

  it('falls back to the tank centre line for a clearance wider than the axis', () => {
    const recovered = recoveredTankPosition({ x: 5, y: 0, z: 4 }, 99)!;
    expect(recovered.x).toBe(0);
    expect(recovered.z).toBe(0);
  });

  it('leaves the whole recovered volume inside the tank for every real clearance', () => {
    for (const clearance of [WALL_THICKNESS / 2 + 0.456, CLEARANCE]) {
      for (const escaped of [
        { x: 3.4, y: 0, z: 0 },
        { x: 0, y: 2.6, z: 0 },
        { x: 0, y: 0, z: -2.1 },
        { x: 7, y: -7, z: 7 },
      ]) {
        const recovered = recoveredTankPosition(escaped, clearance)!;
        expect(Math.abs(recovered.x) + clearance).toBeLessThanOrEqual(TANK_INNER_BOUNDS.x + 1e-9);
        expect(Math.abs(recovered.y) + clearance).toBeLessThanOrEqual(TANK_INNER_BOUNDS.y + 1e-9);
        expect(Math.abs(recovered.z) + clearance).toBeLessThanOrEqual(TANK_INNER_BOUNDS.z + 1e-9);
      }
    }
  });
});
