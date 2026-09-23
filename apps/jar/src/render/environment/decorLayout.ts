// Pure position/size constants for the aquarium decor — no three.js imports,
// so this is directly unit-testable (`decorLayout.test.ts`) without a
// renderer. See `decorGeometry.ts` for the geometry these positions place.
//
// Castle sizing note: a fish's own collider reaches ~1.45 world units
// across at its biggest (`Fish.tsx`'s `colliderRadiusFor`, a male Veil at
// full size) — a castle proportioned like a real (tall, narrow) building
// can't fit a door that wide without becoming taller than the tank itself.
// The castle here is deliberately flatter and wider than realistic
// architecture to make room for a genuinely fish-sized doorway; see
// `decor-svg/castle.svg`'s own header comment for the geometry this maps
// onto ground truth for.
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
 * (`castle.svg`), sized to comfortably clear most fish (the biggest, a
 * male Veil, occasionally brushes the frame; see this file's header). At
 * 0.65, 5 of the 6 fin/sex adult-collider combinations `Fish.tsx`'s
 * `colliderRadiusFor` produces (diameters 0.91-1.45) fit through; only a
 * male Veil, the single biggest at 1.45, still occasionally brushes the
 * frame. */
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
 * clearance) still clears the tank wall; `z` pulled forward from an
 * original `-0.8`, which read as pressed against the back glass. */
export const CASTLE_POSITION = { x: 0.5, y: FLOOR_TOP_Y, z: -0.3 };

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

/** A safe corridor through the doorway opening — `CastleAvoidanceBehaviour`
 * exempts a fish inside this volume from the flanking wall-segment/lintel
 * push entirely, rather than merely reducing it. Without this, the
 * anticipatory margin those boxes expand by (up to ~0.8 world units for a
 * large fish, `useFishSteering.ts`'s `maxColliderRadius + CONTAINMENT_BUFFER`)
 * comfortably exceeds `CASTLE_DOOR_HALF_WIDTH` (0.65), so the two walls'
 * expanded zones overlap *past the doorway's own centre* — a fish
 * approaching head-on would get deflected sideways before ever reaching
 * the opening the door was specifically sized to let it through. Matches
 * the door's real clear opening in x/y; z is generous enough to cover both
 * the approach from outside and `HIDE_POINT` behind it. */
export const CASTLE_DOORWAY_CORRIDOR = {
  position: { x: 0, y: CASTLE_DOOR_HEIGHT / 2, z: 0 },
  halfExtents: { x: CASTLE_DOOR_HALF_WIDTH, y: CASTLE_DOOR_HEIGHT / 2, z: 1.2 },
};

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
// z) the right tower, clear of the airstone (~66% x per §8.1, ≈ +0.96
// world).
export const PLANT_FRONT_RIGHT_POSITION = { x: 2.3, y: FLOOR_TOP_Y, z: 0.6 };
// New: in the gap between the left tower and the keep's own left edge,
// pulled forward of the castle's front face — reads as sitting just left
// of the keep, in front of it.
export const PLANT_LEFT_OF_KEEP_POSITION = { x: -0.9, y: FLOOR_TOP_Y, z: 0.25 };

/** Pushes a point clear of `CASTLE_COLLIDER_BOXES` (each box expanded by
 * `margin` on every side) if it falls inside one, along whichever axis
 * needs the smallest push (the standard AABB minimum-translation
 * approach), and keeps it within `TANK_INNER_BOUNDS` (also shrunk by
 * `margin`) throughout — otherwise returns the point unchanged. Exists
 * because a critter's `favourite_spot` (`Fish.tsx`) is rolled in
 * `jar-core`, which has no knowledge of decor (`docs/architecture/rust-core.md`'s
 * own "no I/O, no render knowledge" boundary for the sim core) — nothing
 * upstream of the frontend can already avoid the castle, so a fish
 * spawning (or returning to rest) at a percent-rolled point that happens
 * to land inside one of these boxes would otherwise mount its RigidBody
 * already interpenetrating a fixed collider, which Rapier resolves with
 * an immediate pop/launch on the very first physics step rather than a
 * normal approach and stop. The tank-bounds clamp runs every pass, not
 * just at the end — a castle box near the tank wall (a tower sits close
 * to the back wall) can push a point past that wall on its own, and a
 * clamp applied only afterward could then walk it straight back into the
 * castle box it was just pushed out of; alternating the two constraints
 * across a few passes converges on a point that satisfies both. */
export function keepClearOfCastle(
  point: { x: number; y: number; z: number },
  margin: number,
): { x: number; y: number; z: number } {
  let result = point;
  for (let pass = 0; pass < 4; pass++) {
    result = {
      x: clamp(result.x, -(TANK_INNER_BOUNDS.x - margin), TANK_INNER_BOUNDS.x - margin),
      y: clamp(result.y, -(TANK_INNER_BOUNDS.y - margin), TANK_INNER_BOUNDS.y - margin),
      z: clamp(result.z, -(TANK_INNER_BOUNDS.z - margin), TANK_INNER_BOUNDS.z - margin),
    };

    let pushedThisPass = false;
    for (const box of CASTLE_COLLIDER_BOXES) {
      const boxWorld = {
        x: CASTLE_POSITION.x + box.position.x,
        y: CASTLE_POSITION.y + box.position.y,
        z: CASTLE_POSITION.z + box.position.z,
      };
      const expanded = {
        x: box.halfExtents.x + margin,
        y: box.halfExtents.y + margin,
        z: box.halfExtents.z + margin,
      };
      const dx = result.x - boxWorld.x;
      const dy = result.y - boxWorld.y;
      const dz = result.z - boxWorld.z;
      const inside =
        Math.abs(dx) < expanded.x && Math.abs(dy) < expanded.y && Math.abs(dz) < expanded.z;
      if (!inside) continue;

      const sign = (n: number) => (n < 0 ? -1 : 1); // never 0 — a point exactly on the box's own centre plane still needs a direction to push
      // A push landing exactly on the expanded boundary can still read as
      // "inside" on the next pass's strict `<` check once floating-point
      // rounding is involved, oscillating rather than converging — nudge
      // past it by a hair so the next check is unambiguous.
      const clearanceEpsilon = 1e-6;
      const axisBound = {
        x: TANK_INNER_BOUNDS.x - margin,
        y: TANK_INNER_BOUNDS.y - margin,
        z: TANK_INNER_BOUNDS.z - margin,
      };
      const candidates = [
        {
          axis: 'x' as const,
          penetration: expanded.x - Math.abs(dx),
          target: boxWorld.x + sign(dx) * (expanded.x + clearanceEpsilon),
          bound: axisBound.x,
        },
        {
          axis: 'y' as const,
          penetration: expanded.y - Math.abs(dy),
          target: boxWorld.y + sign(dy) * (expanded.y + clearanceEpsilon),
          bound: axisBound.y,
        },
        {
          axis: 'z' as const,
          penetration: expanded.z - Math.abs(dz),
          target: boxWorld.z + sign(dz) * (expanded.z + clearanceEpsilon),
          bound: axisBound.z,
        },
      ];
      // The cheapest (min-penetration) axis to push along isn't necessarily
      // one whose destination actually fits inside the shrunken tank bounds
      // — a box sitting close to a wall can make the "cheap" axis land past
      // that wall, which the next pass's clamp then pulls straight back
      // into the box, oscillating between the two constraints forever.
      // Restrict the choice to axes whose push target is actually in-bounds
      // first, and only fall back to the unrestricted minimum if none of
      // the three qualify (a box too large for the tank to clear at all).
      const feasible = candidates.filter((c) => Math.abs(c.target) <= c.bound);
      const pool = feasible.length > 0 ? feasible : candidates;
      const chosen = pool.reduce((best, c) => (c.penetration < best.penetration ? c : best));
      result = { ...result, [chosen.axis]: chosen.target };
      pushedThisPass = true;
    }
    if (!pushedThisPass) break;
  }
  return result;
}

/** `THREE.MathUtils.clamp`, without a three.js import — this file is
 * deliberately three.js-free (see the header comment) so `decorLayout.test.ts`
 * can unit-test it without a renderer. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
