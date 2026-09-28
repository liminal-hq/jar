// Pure position/size constants for the aquarium decor — no three.js imports,
// so this is directly unit-testable (`decorLayout.test.ts`) without a
// renderer. See `decorGeometry.ts` for the geometry these positions place.
//
// Castle sizing note: a fish's own *length* reaches ~1.45 world units
// tip-to-tail at its biggest (`fishCollider.ts`'s `adultColliderHalfExtentsFor`,
// a male Veil at full size) — a castle proportioned like a real (tall,
// narrow) building can't fit a door that wide without becoming taller than
// the tank itself. The castle here is deliberately flatter and wider than
// realistic architecture to make room for a genuinely fish-sized doorway;
// see `decor-svg/castle.svg`'s own header comment for the geometry this
// maps onto ground truth for. Its physics *box*, though, is only ~0.19-0.24
// world units thick — and `castleAvoidanceBehaviour.ts`'s anticipatory
// margin is yaw-projected from that box, not a fixed length-sized value —
// so in practice a fish approaching this doorway nose-on only ever needs
// clearance close to its own thickness, not its full length.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { TANK_INNER_BOUNDS } from '../physics/coordinates';

/** Sand floor's top surface — `AquariumEnvironment.tsx` centres the floor
 * box at `-halfH` with height `0.2`, so its top face sits `0.1` above
 * that centre. Duplicated here (not imported) since the floor box itself
 * is a plain inline mesh, not a shared constant. */
export const FLOOR_TOP_Y = -TANK_INNER_BOUNDS.y + 0.1;

/** World-unit half-size of the keep body alone (door and merlons
 * excluded) — `decor-svg/castle.svg`'s `keep-body` path is 480×340 SVG
 * units, times `DECOR_SVG_SCALE` (`decorGeometry.ts`). Taller than the
 * flanking towers on purpose — a first pass had the keep+merlon crown
 * reading level with or below the tower roofs, inverting the intended
 * "keep rises above its towers" silhouette. */
export const CASTLE_KEEP_HALF_WIDTH = 1.2;
export const CASTLE_KEEP_HEIGHT = 1.7;

/** The doorway's own clear opening — a real cut-through hole
 * (`castle.svg`). At 0.65, the opening clears every fin/sex adult
 * combination's physics-box *thickness* (≤0.24, `fishCollider.ts`) with
 * room to spare — and since `castleAvoidanceBehaviour.ts`'s anticipatory
 * margin is yaw-projected from that same box, a nose-on fish's live
 * margin here (thickness plus a small buffer, ~0.2) never reaches this
 * half-width from the doorway's own centreline, so no fish stalls or
 * needs a dedicated exemption to enter. */
export const CASTLE_DOOR_HALF_WIDTH = 0.65;
export const CASTLE_DOOR_HEIGHT = 1.15;

/** Tower half-size and how far each sits from the keep's own centre —
 * `decorGeometry.ts`'s `towerBody`/`towerRoof` are authored at their own
 * local origin and positioned twice here (`±CASTLE_TOWER_OFFSET`), the
 * same "one shared shape, two placed instances" pattern
 * `fishGeometry.ts` uses for the mirrored pectoral fin. */
export const CASTLE_TOWER_HALF_WIDTH = 0.275;
export const CASTLE_TOWER_HEIGHT = 0.9;
/** Real clearance from the keep's own edge (`CASTLE_KEEP_HALF_WIDTH`), not
 * flush against it — a first pass with the towers nearly touching the
 * keep read as one fused blob rather than a keep with two flanking
 * towers. */
export const CASTLE_TOWER_OFFSET = 1.8;
export const CASTLE_ROOF_HALF_WIDTH = 0.325;

/** Where the castle sits — `x` pulled toward centre so the wider
 * tower-to-tower span (`CASTLE_TOWER_OFFSET` grew for real tower
 * clearance) still leaves real room between the right tower and the tank
 * wall: at an original `0.5`, that gap was only 0.225 world units — just
 * *under* even the widest fish's own physical thickness (a Veil's
 * collider box is 0.24 wide, the widest of the three fin types,
 * `fishCollider.ts`), so no orientation could actually fit through there
 * no matter how avoidance margins were tuned. `0.375` reopens it to 0.35,
 * matching the keep-to-tower gap's own clearance. The left tower's own
 * gap to the opposite wall starts far more generous (~1.1) and stays
 * comfortably so after the same shift — `z` pulled forward from an
 * original `-0.8`, which read as pressed against the back glass. */
export const CASTLE_POSITION = { x: 0.375, y: FLOOR_TOP_Y, z: -0.3 };

/** Static collider footprint — left wall segment, right wall segment, and
 * a lintel above the door opening (leaving the door itself clear), plus
 * one box per tower. Deliberately *not* one solid box over the whole
 * footprint (§5.1's usual pattern for tank furniture) — that would leave
 * no gap for the doorway to actually be a doorway. Each box's `position`
 * is local to `CASTLE_POSITION` (added to it, not absolute), `y` measured
 * from the floor. */
export const CASTLE_COLLIDER_BOXES: Array<{
  position: { x: number; y: number; z: number };
  halfExtents: { x: number; y: number; z: number };
}> = [
  // Left wall segment, door edge to keep edge.
  {
    position: {
      x: -(CASTLE_DOOR_HALF_WIDTH + (CASTLE_KEEP_HALF_WIDTH - CASTLE_DOOR_HALF_WIDTH) / 2),
      y: CASTLE_KEEP_HEIGHT / 2,
      z: 0,
    },
    halfExtents: {
      x: (CASTLE_KEEP_HALF_WIDTH - CASTLE_DOOR_HALF_WIDTH) / 2,
      y: CASTLE_KEEP_HEIGHT / 2,
      z: 0.275,
    },
  },
  // Right wall segment, mirrored.
  {
    position: {
      x: CASTLE_DOOR_HALF_WIDTH + (CASTLE_KEEP_HALF_WIDTH - CASTLE_DOOR_HALF_WIDTH) / 2,
      y: CASTLE_KEEP_HEIGHT / 2,
      z: 0,
    },
    halfExtents: {
      x: (CASTLE_KEEP_HALF_WIDTH - CASTLE_DOOR_HALF_WIDTH) / 2,
      y: CASTLE_KEEP_HEIGHT / 2,
      z: 0.275,
    },
  },
  // Lintel: the wall above the door's arch, spanning the full keep width.
  {
    position: {
      x: 0,
      y: CASTLE_DOOR_HEIGHT + (CASTLE_KEEP_HEIGHT - CASTLE_DOOR_HEIGHT) / 2,
      z: 0,
    },
    halfExtents: {
      x: CASTLE_KEEP_HALF_WIDTH,
      y: (CASTLE_KEEP_HEIGHT - CASTLE_DOOR_HEIGHT) / 2,
      z: 0.275,
    },
  },
  // Two towers.
  {
    position: { x: -CASTLE_TOWER_OFFSET, y: CASTLE_TOWER_HEIGHT / 2, z: 0 },
    halfExtents: { x: CASTLE_TOWER_HALF_WIDTH, y: CASTLE_TOWER_HEIGHT / 2, z: 0.225 },
  },
  {
    position: { x: CASTLE_TOWER_OFFSET, y: CASTLE_TOWER_HEIGHT / 2, z: 0 },
    halfExtents: { x: CASTLE_TOWER_HALF_WIDTH, y: CASTLE_TOWER_HEIGHT / 2, z: 0.225 },
  },
];

/** Where a hiding fish paths to — inside the doorway's own footprint, well
 * behind the keep's front face, so reaching it means genuinely passing
 * through the opening (or around the castle's shallow sides — the
 * colliders above aren't a sealed box). Jittered per-hide by
 * `HIDE_JITTER` (`Fish.tsx`'s `rollHideTarget`, `hideParams.ts`). */
export const HIDE_POINT = {
  x: CASTLE_POSITION.x,
  y: FLOOR_TOP_Y + CASTLE_DOOR_HEIGHT / 2,
  z: CASTLE_POSITION.z - 0.35,
};
export const HIDE_JITTER = { x: 0.2, y: 0.1, z: 0.1 };

/** Plant cluster positions — five now, not three: the original three plus
 * two new ones added around the castle rather than relocating any of the
 * originals. All clear of the castle's collider footprint, all at floor
 * height. */
// Back-left anchor.
export const PLANT_TALL_KELP_POSITION = { x: -2.5, y: FLOOR_TOP_Y, z: -0.9 };
// Original spot — nudged from `-1.6` to `-2.0` so it still clears the
// castle's roof overhang now that the castle itself grew wider.
export const PLANT_BROADLEAF_POSITION = { x: -2.0, y: FLOOR_TOP_Y, z: 0.5 };
// Original spot — nudged from `-1.0` to `-1.9` for the same reason.
export const PLANT_SMALL_KELP_POSITION = { x: -1.9, y: FLOOR_TOP_Y, z: -0.3 };
// New: front-right, standing in front of (not overlapping — separated in
// z) the right tower — x tracks the tower's own world x
// (`CASTLE_POSITION.x + CASTLE_TOWER_OFFSET`) so it stays aligned with it
// regardless of where the castle sits — clear of the airstone (~66% x per
// §8.1, ≈ +0.96 world).
export const PLANT_FRONT_RIGHT_POSITION = {
  x: CASTLE_POSITION.x + CASTLE_TOWER_OFFSET,
  y: FLOOR_TOP_Y,
  z: 0.6,
};
// New: in the gap between the left tower and the keep's own left edge,
// pulled forward of the castle's front face — reads as sitting just left
// of the keep, in front of it.
export const PLANT_LEFT_OF_KEEP_POSITION = { x: -0.9, y: FLOOR_TOP_Y, z: 0.25 };

type Vec3 = { x: number; y: number; z: number };
type Axis = 'x' | 'y' | 'z';
const AXES: readonly Axis[] = ['x', 'y', 'z'];

/** An axis-aligned box in world space, as a centre and half-extents. */
export interface WorldBox {
  centre: Vec3;
  half: Vec3;
}

/** How far past a box's expanded face a pushed point lands, so a point
 * resting on a face reads as clear under the strict `<` containment test
 * even after floating-point rounding. */
export const CLEARANCE_EPSILON = 1e-6;

/** `CASTLE_COLLIDER_BOXES` in world space, computed once. */
const CASTLE_WORLD_BOXES: readonly WorldBox[] = CASTLE_COLLIDER_BOXES.map((box) => ({
  centre: {
    x: CASTLE_POSITION.x + box.position.x,
    y: CASTLE_POSITION.y + box.position.y,
    z: CASTLE_POSITION.z + box.position.z,
  },
  half: { ...box.halfExtents },
}));

/** The legal range for a critter centre whose collider reaches `margin`
 * from it: `TANK_INNER_BOUNDS` shrunk by `margin` on every axis. */
function tankBoundsFor(margin: number): Vec3 {
  return {
    x: Math.max(0, TANK_INNER_BOUNDS.x - margin),
    y: Math.max(0, TANK_INNER_BOUNDS.y - margin),
    z: Math.max(0, TANK_INNER_BOUNDS.z - margin),
  };
}

function isInsideAnyBox(
  x: number,
  y: number,
  z: number,
  boxes: readonly WorldBox[],
  margin: number,
) {
  for (const box of boxes) {
    if (
      Math.abs(x - box.centre.x) < box.half.x + margin &&
      Math.abs(y - box.centre.y) < box.half.y + margin &&
      Math.abs(z - box.centre.z) < box.half.z + margin
    ) {
      return true;
    }
  }
  return false;
}

/** The candidate coordinates on one axis, cheapest first: `values[i]` at
 * squared distance `costs[i]` from the start coordinate. */
interface AxisGrid {
  values: Float64Array;
  costs: Float64Array;
}

function buildAxisGrid(
  axis: Axis,
  start: number,
  boxes: readonly WorldBox[],
  margin: number,
  bound: number,
  held: boolean,
): AxisGrid {
  const candidates: number[] = [start];
  if (!held) {
    for (const box of boxes) {
      const reach = box.half[axis] + margin + CLEARANCE_EPSILON;
      candidates.push(box.centre[axis] + reach, box.centre[axis] - reach);
    }
    candidates.push(bound, -bound);
  }
  const kept = candidates.filter((value, index) => index === 0 || Math.abs(value) <= bound);
  const order = kept.map((_, index) => index);
  const cost = (index: number) => (kept[index]! - start) * (kept[index]! - start);
  order.sort((a, b) => cost(a) - cost(b) || a - b);
  return {
    values: Float64Array.from(order, (index) => kept[index]!),
    costs: Float64Array.from(order, cost),
  };
}

/** The point nearest `start` (Euclidean) that lies outside every box
 * expanded by `margin` and inside `±bounds`, or `null` if there is none.
 * The nearest such point's coordinate on each axis is either the start
 * coordinate or sits on a constraint plane — an expanded box face or a
 * tank bound — because otherwise sliding it toward the start would
 * shorten the distance without changing which boxes contain it. So
 * searching the grid of those coordinates per axis is complete and exact,
 * and needs no separate edge or corner candidates. */
function searchNearestClear(
  start: Vec3,
  boxes: readonly WorldBox[],
  bounds: Vec3,
  margin: number,
  held: readonly Axis[],
): Vec3 | null {
  const gx = buildAxisGrid('x', start.x, boxes, margin, bounds.x, held.includes('x'));
  const gy = buildAxisGrid('y', start.y, boxes, margin, bounds.y, held.includes('y'));
  const gz = buildAxisGrid('z', start.z, boxes, margin, bounds.z, held.includes('z'));

  // z outermost and x innermost: the inner axis takes the first clear
  // candidate it meets, so on an exact tie the earlier-scanned candidate
  // wins, and this order makes that the +x face.
  let best = Infinity;
  let bestX = 0;
  let bestY = 0;
  let bestZ = 0;
  for (let k = 0; k < gz.values.length; k++) {
    const costZ = gz.costs[k]!;
    if (costZ >= best) break;
    for (let j = 0; j < gy.values.length; j++) {
      const costZY = costZ + gy.costs[j]!;
      if (costZY >= best) break;
      for (let i = 0; i < gx.values.length; i++) {
        const total = costZY + gx.costs[i]!;
        if (total >= best) break;
        if (!isInsideAnyBox(gx.values[i]!, gy.values[j]!, gz.values[k]!, boxes, margin)) {
          best = total;
          bestX = gx.values[i]!;
          bestY = gy.values[j]!;
          bestZ = gz.values[k]!;
          break;
        }
      }
    }
  }
  return best === Infinity ? null : { x: bestX, y: bestY, z: bestZ };
}

/** Moves `point` to the nearest point that is inside `±bounds` on every
 * axis not in `heldAxes` (held axes are copied unchanged and never
 * searched) and outside every box in `boxes` expanded by `margin`. Falls
 * back through three tiers, each giving up the previous one's guarantee:
 * clear of the expanded boxes; clear of the raw boxes; and finally just
 * inside the bounds — tank containment is never given up. A point already
 * clear of the expanded boxes is only clamped. An exact tie between
 * candidates resolves to the +x face, so the result is deterministic.
 * Boundary semantics match the physics: containment in a box is strict
 * (`<`), containment in the bounds is inclusive (`<=`). */
export function nearestClearPoint(
  point: Vec3,
  boxes: readonly WorldBox[],
  bounds: Vec3,
  margin: number,
  heldAxes: readonly Axis[] = [],
): Vec3 {
  const clamped: Vec3 = { ...point };
  for (const axis of AXES) {
    if (!heldAxes.includes(axis)) clamped[axis] = clamp(point[axis], -bounds[axis], bounds[axis]);
  }
  if (!isInsideAnyBox(clamped.x, clamped.y, clamped.z, boxes, margin)) return clamped;

  return (
    searchNearestClear(clamped, boxes, bounds, margin, heldAxes) ??
    searchNearestClear(clamped, boxes, bounds, 0, heldAxes) ??
    clamped
  );
}

/** Moves a critter's rolled spawn/favourite spot clear of the castle: the
 * nearest point inside the tank bounds (shrunk by `margin`) and outside
 * every `CASTLE_COLLIDER_BOXES` box expanded by `margin`, or `point`
 * itself (clamped into the tank) if it is already clear.
 *
 * `favourite_spot` is rolled in `jar-core`, which has no knowledge of
 * decor (`docs/architecture/rust-core.md`'s "no I/O, no render knowledge"
 * boundary for the sim core), so nothing upstream can have avoided the
 * castle. A spot left inside a collider box would mount the fish's
 * `RigidBody` interpenetrating a fixed collider, which Rapier resolves
 * with a visible pop on the first physics step.
 *
 * The expanded boxes overlap one another: a wall segment's box and its
 * tower's box share space whenever `2 * margin` exceeds the keep-to-tower
 * gap (0.325), which is true for every fish margin. Clearing one box at a
 * time therefore ping-pongs between the two, so all the boxes are
 * cleared jointly, by an exact nearest-point search (`nearestClearPoint`).
 * Fallback order when no point clears the expanded boxes within the tank:
 * clear of the raw boxes, then merely inside the tank. */
export function keepClearOfCastle(point: Vec3, margin: number): Vec3 {
  return nearestClearPoint(point, CASTLE_WORLD_BOXES, tankBoundsFor(margin), margin);
}

/** `keepClearOfCastle` for a crawler standing on the sand: only `x` and
 * `z` move, so the footprint slides along the floor rather than being
 * lifted onto the top of a wall. The probe sits one epsilon above the sand
 * so that the boxes standing on the floor register as containing it. */
export function keepFloorPointClearOfCastle(
  point: { x: number; z: number },
  margin: number,
): { x: number; z: number } {
  const clear = nearestClearPoint(
    { x: point.x, y: FLOOR_TOP_Y + CLEARANCE_EPSILON, z: point.z },
    CASTLE_WORLD_BOXES,
    tankBoundsFor(margin),
    margin,
    ['y'],
  );
  return { x: clear.x, z: clear.z };
}

/** `THREE.MathUtils.clamp`, without a three.js import — this file is
 * deliberately three.js-free (see the header comment) so `decorLayout.test.ts`
 * can unit-test it without a renderer. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
