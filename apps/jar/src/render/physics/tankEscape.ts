// Last-resort containment: detects a critter whose RigidBody centre has
// ended up on the far side of a wall collider and works out where to put it
// back. Pure module — plain numbers in, plain numbers out, no Rapier or
// three.js objects — so the whole rule is directly unit-testable.
//
// Steering cannot recover this state on its own, which is why it needs
// handling at all. `TankContainmentBehaviour` (`render/steering`) does keep
// commanding a full-strength push back toward centre for a fish outside the
// glass — the push is correct and saturated, it just aims straight into the
// wall collider standing between that fish and the water, so the body never
// moves an inch of it. Worse, at full penetration that one behaviour claims
// the whole of `vehicle.maxForce`, leaving `wander` no budget to ever turn
// the fish sideways and around the wall's edge: the commanded direction is
// constant, so the heading freezes too, and the fish hangs outside the tank
// with a frozen pose for as long as the app runs. Nothing about that state
// decays on its own, so something has to break it.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { TANK_INNER_BOUNDS, WALL_THICKNESS } from './coordinates';

/** A vector of plain numbers — what Rapier's `translation()` hands back and
 * what `setTranslation` accepts, without this module needing either type. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** How far a critter's centre has to be past `TANK_INNER_BOUNDS` on any axis
 * before it counts as escaped: the wall collider's *outer* face
 * (`TANK_INNER_BOUNDS` is its centre plane — see `WALL_THICKNESS`). Nothing
 * legally contained can reach this. A contained critter's own collider box
 * stops its centre well short of even the wall's *inner* face, so anything
 * out here has already crossed the full thickness of the glass and is
 * unambiguously on the wrong side of it — no false positives to trade
 * against, and no need for a tolerance on top. */
export const TANK_ESCAPE_BOUNDS = {
  x: TANK_INNER_BOUNDS.x + WALL_THICKNESS / 2,
  y: TANK_INNER_BOUNDS.y + WALL_THICKNESS / 2,
  z: TANK_INNER_BOUNDS.z + WALL_THICKNESS / 2,
};

/** Whether this centre is on the far side of a wall collider on any axis. */
export function hasEscapedTank(position: Vec3): boolean {
  return (
    Math.abs(position.x) > TANK_ESCAPE_BOUNDS.x ||
    Math.abs(position.y) > TANK_ESCAPE_BOUNDS.y ||
    Math.abs(position.z) > TANK_ESCAPE_BOUNDS.z
  );
}

/** Where to put an escaped critter back, or `null` if it is where it should
 * be and nothing needs doing.
 *
 * Every axis is clamped, not just the offending one: a critter out through
 * the `+x` glass is free to drift anywhere in the unbounded space outside the
 * tank, so by the time it's noticed its other two axes may well be out of
 * range too. `clearance` is the same reservation a spawn point makes
 * (`simPercentToWorld`'s own parameter — the critter's collider extent plus
 * the wall collider's half-thickness), so the recovered position leaves the
 * body's whole collider box clear of the glass in any orientation rather
 * than parked half inside it, which would just hand Rapier a fresh overlap
 * to resolve.
 *
 * The result is a jump, not a path — deliberately. The glass is a solid
 * collider sitting between the critter and the water, so there is no
 * continuous route back in for any amount of steering force to follow; the
 * only way home is across. Getting out there is the bug (see this module's
 * header), and a single frame of teleport is a far better outcome than a
 * critter lost behind the glass for the rest of the session. */
export function recoveredTankPosition(position: Vec3, clearance: number): Vec3 | null {
  if (!hasEscapedTank(position)) return null;
  return {
    x: clampAxis(position.x, TANK_INNER_BOUNDS.x, clearance),
    y: clampAxis(position.y, TANK_INNER_BOUNDS.y, clearance),
    z: clampAxis(position.z, TANK_INNER_BOUNDS.z, clearance),
  };
}

/** `Math.max(0, ...)` on the limit, so a clearance wider than the axis itself
 * (nothing today: the tank's tightest axis leaves ~0.57 units of room for
 * even the longest adult fish) lands the critter on the tank's centre line
 * for that axis instead of inverting the clamp. */
function clampAxis(value: number, bound: number, clearance: number): number {
  const limit = Math.max(0, bound - clearance);
  return Math.min(Math.max(value, -limit), limit);
}
