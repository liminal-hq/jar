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
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { TANK_INNER_BOUNDS } from '../physics/coordinates';

/** Sand floor's top surface — `AquariumEnvironment.tsx` centres the floor
 * box at `-halfH` with height `0.2`, so its top face sits `0.1` above
 * that centre. Duplicated here (not imported) since the floor box itself
 * is a plain inline mesh, not a shared constant. */
export const FLOOR_TOP_Y = -TANK_INNER_BOUNDS.y + 0.1;

/** World-unit half-size of the keep body alone (door and merlons
 * excluded) — `decor-svg/castle.svg`'s `keep-body` path is 480×300 SVG
 * units, times `DECOR_SVG_SCALE` (`decorGeometry.ts`). */
export const CASTLE_KEEP_HALF_WIDTH = 1.2;
export const CASTLE_KEEP_HEIGHT = 1.5;

/** The doorway's own clear opening — a real cut-through hole
 * (`castle.svg`), sized to comfortably clear most fish (the biggest, a
 * male Veil, occasionally brushes the frame; see this file's header). */
export const CASTLE_DOOR_HALF_WIDTH = 0.5;
export const CASTLE_DOOR_HEIGHT = 1.15;

/** Tower half-size and how far each sits from the keep's own centre —
 * `decorGeometry.ts`'s `towerBody`/`towerRoof` are authored at their own
 * local origin and positioned twice here (`±CASTLE_TOWER_OFFSET`), the
 * same "one shared shape, two placed instances" pattern
 * `fishGeometry.ts` uses for the mirrored pectoral fin. */
export const CASTLE_TOWER_HALF_WIDTH = 0.275;
export const CASTLE_TOWER_HEIGHT = 1.1;
export const CASTLE_TOWER_OFFSET = 1.45;
export const CASTLE_ROOF_HALF_WIDTH = 0.325;

/** Where the castle sits — `x` pushed right of centre but pulled back in
 * from the original design's `1.7` once the castle grew to fit a
 * fish-sized door (a `1.7` centre would push the tower+roof footprint
 * past the tank's own wall); `z` toward the back plane, clear of the
 * airstone (~66% x, `docs/architecture/3d-engine.md` §8.1). */
export const CASTLE_POSITION = { x: 1.0, y: FLOOR_TOP_Y, z: -0.8 };

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

/** Plant cluster positions — left-weighted, clear of the castle's visual
 * footprint (towers + roof overhang reach roughly `x = -0.78` on the
 * castle's own left side) and the airstone (~66% x per §8.1, ≈ +0.96
 * world). All at floor height. */
export const PLANT_TALL_KELP_POSITION = { x: -2.3, y: FLOOR_TOP_Y, z: -0.9 };
export const PLANT_BROADLEAF_POSITION = { x: -1.6, y: FLOOR_TOP_Y, z: 0.4 };
export const PLANT_SMALL_KELP_POSITION = { x: -1.0, y: FLOOR_TOP_Y, z: -0.5 };
