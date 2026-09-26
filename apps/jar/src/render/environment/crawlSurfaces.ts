// Shared analytic "crawl surface" model for critters that move across the
// tank's solid surfaces rather than swim through open water — floor, glass
// walls, and decor. Pure math, no three.js import (the `decorLayout.ts`
// discipline): critter-agnostic by design, so a future second crawling
// critter can reuse this verbatim.
//
// A `CrawlFace` is a flat rectangle in world space (origin corner + two
// unit in-plane axes with their own extents + an outward unit normal). A
// `CrawlPose` places a crawler on one face via in-plane `(u, v)` coordinates
// (in world units, not normalized) plus a `heading` — an angle in that
// face's own `(uAxis, vAxis)` plane, measured from `uAxis` toward `vAxis`.
// A `FaceLink` records a real, physically-shared edge between two faces
// (as the edge's own two world-space endpoints, not a symbolic name) —
// `advance()` uses that shared edge directly to re-parameterize a crossing
// pose continuously into the neighbour, however the two faces' own axes
// happen to be oriented relative to each other. Where no link exists (e.g.
// the top of a glass wall, with nothing above it), a crawler reaching that
// edge clamps in place and reflects its heading (a bounce) rather than
// falling off the world.
//
// **Face inventory, deliberately v1-scoped**: the sand floor; the four
// glass walls, from the floor up to a capped height comfortably below the
// light strip near the rim (`WALL_RIM_CLEARANCE`); and, for each of
// `decorLayout.ts`'s five `CASTLE_COLLIDER_BOXES`, that box's top face plus
// its four vertical side faces. This is built from the avoidance-tuned
// *collider* boxes, not the visible castle silhouette (`decor-svg/castle.svg`
// / `decorGeometry.ts`) — those already differ from the collider boxes by
// up to ~0.22 world units (`decorLayout.ts`'s own header comment on the
// castle's flattened-for-doorway proportions), so a crawling critter's feet
// can sit slightly proud of or sunk into the visible geometry in places.
// Accepted for v1, not fixed here.
//
// Links: floor↔each wall's bottom edge, wall↔wall at the four vertical
// corners, floor↔each castle side's base (except the lintel — see
// `buildCastleFacesAndLinks`'s own comment, it floats above the doorway and
// isn't actually touching the floor), and each castle side↔its own top.
// Adjacent castle side faces are *not* linked to each other (a crawler
// reaching a side face's left/right edge bounces rather than wrapping
// around the box) — out of scope for v1, per the plan.
//
// `roundedNormalAt`/`poseToWorldRounded` give a *continuous* frame near a
// crease, on top of the instantaneous-fold model above: a face's normal
// blends toward a linked neighbour's within `FILLET_RADIUS` of the shared
// edge (exact everywhere else), so a caller deriving both position and
// orientation from the same rounded frame gets a fold that visibly bends
// rather than snapping — see those functions' own doc comments for the
// exact blend and its continuity properties. `advance()`/`poseToWorld()`
// above are untouched and still describe the crawler's true, sharp-cornered
// position; only the *frame* used to orient a rendered body is rounded.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { TANK_INNER_BOUNDS, WALL_THICKNESS } from '../physics/coordinates';
import {
  CASTLE_COLLIDER_BOXES,
  CASTLE_POSITION,
  FLOOR_TOP_Y,
  keepClearOfCastle,
} from './decorLayout';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A flat rectangular patch of crawlable surface. `origin` is one corner
 * (not the centre); a point on the face is `origin + u*uAxis + v*vAxis` for
 * `u` in `[0, uLength]` and `v` in `[0, vLength]`. `uAxis`/`vAxis`/`normal`
 * must form a right-handed orthonormal frame — `normal` points away from
 * the solid the face sits on (up off the floor, into the tank off the
 * glass, outward off a castle box). */
export interface CrawlFace {
  id: string;
  origin: Vec3;
  uAxis: Vec3;
  uLength: number;
  vAxis: Vec3;
  vLength: number;
  normal: Vec3;
}

/** A traversable fold between two faces, recorded as the real world-space
 * edge they physically share (not a symbolic edge name) — `advance()`
 * re-derives each face's own local coordinates along this edge itself, so
 * the fold is correct regardless of how either face's `uAxis`/`vAxis`
 * happen to be oriented, and regardless of whether the edge is a full
 * boundary of both faces (a wall's bottom against the floor's own edge) or
 * only of one (a castle side's base, which is only an interior strip of
 * the much larger floor). */
export interface FaceLink {
  faceA: string;
  faceB: string;
  edgeStart: Vec3;
  edgeEnd: Vec3;
}

/** A crawler's placement: which face it's on, its in-plane position (world
 * units, not normalized), and its heading — measured in that face's own
 * `(uAxis, vAxis)` plane, from `uAxis` toward `vAxis`. */
export interface CrawlPose {
  faceId: string;
  u: number;
  v: number;
  heading: number;
}

/** `poseToWorld`'s result — a world position plus an orthonormal frame,
 * as plain vectors (this module stays three.js-free) — `Snail.tsx` builds
 * a `THREE.Quaternion` from `forward`/`up`. */
export interface CrawlFrame {
  position: Vec3;
  forward: Vec3;
  up: Vec3;
  right: Vec3;
}

// --- Vector helpers (no three.js — see header) -----------------------------

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}
function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len > 0 ? scale(a, 1 / len) : { x: 0, y: 0, z: 0 };
}
/** `THREE.MathUtils.clamp`, without a three.js import — same rationale as
 * `decorLayout.ts`'s own copy. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
function facePoint(face: CrawlFace, u: number, v: number): Vec3 {
  return add(add(face.origin, scale(face.uAxis, u)), scale(face.vAxis, v));
}
function projectPointToFace(face: CrawlFace, point: Vec3): { u: number; v: number } {
  const rel = sub(point, face.origin);
  return { u: dot(rel, face.uAxis), v: dot(rel, face.vAxis) };
}

// --- Face inventory ---------------------------------------------------------

const FLOOR_FACE_ID = 'floor';

/** The wall colliders' *centre* plane is `TANK_INNER_BOUNDS`
 * (`coordinates.ts`'s own doc comment); their actual inner (glass) face —
 * where a crawler's feet sit — is inset a further half-thickness. Floor and
 * wall faces are all built from this same inset so their shared edges line
 * up exactly (see `BASE_LINKS` below). */
const WALL_INNER_X = TANK_INNER_BOUNDS.x - WALL_THICKNESS / 2;
const WALL_INNER_Z = TANK_INNER_BOUNDS.z - WALL_THICKNESS / 2;

/** How far below the tank's rim a wall's crawl surface is capped —
 * `AquariumEnvironment.tsx`'s surface-highlight band occupies roughly the
 * top 0.3 world units when the light is on; this keeps a climbing critter
 * clear of it with a little headroom. Tune by eye. */
const WALL_RIM_CLEARANCE = 0.4;
const WALL_TOP_Y = TANK_INNER_BOUNDS.y - WALL_RIM_CLEARANCE;
const WALL_CRAWL_HEIGHT = WALL_TOP_Y - FLOOR_TOP_Y;

const FLOOR_FACE: CrawlFace = {
  id: FLOOR_FACE_ID,
  origin: { x: -WALL_INNER_X, y: FLOOR_TOP_Y, z: -WALL_INNER_Z },
  uAxis: { x: 1, y: 0, z: 0 },
  uLength: 2 * WALL_INNER_X,
  vAxis: { x: 0, y: 0, z: 1 },
  vLength: 2 * WALL_INNER_Z,
  normal: { x: 0, y: 1, z: 0 },
};

const GLASS_FRONT: CrawlFace = {
  id: 'glass-front',
  origin: { x: -WALL_INNER_X, y: FLOOR_TOP_Y, z: WALL_INNER_Z },
  uAxis: { x: 1, y: 0, z: 0 },
  uLength: 2 * WALL_INNER_X,
  vAxis: { x: 0, y: 1, z: 0 },
  vLength: WALL_CRAWL_HEIGHT,
  normal: { x: 0, y: 0, z: -1 },
};

const GLASS_BACK: CrawlFace = {
  id: 'glass-back',
  origin: { x: -WALL_INNER_X, y: FLOOR_TOP_Y, z: -WALL_INNER_Z },
  uAxis: { x: 1, y: 0, z: 0 },
  uLength: 2 * WALL_INNER_X,
  vAxis: { x: 0, y: 1, z: 0 },
  vLength: WALL_CRAWL_HEIGHT,
  normal: { x: 0, y: 0, z: 1 },
};

const GLASS_LEFT: CrawlFace = {
  id: 'glass-left',
  origin: { x: -WALL_INNER_X, y: FLOOR_TOP_Y, z: -WALL_INNER_Z },
  uAxis: { x: 0, y: 0, z: 1 },
  uLength: 2 * WALL_INNER_Z,
  vAxis: { x: 0, y: 1, z: 0 },
  vLength: WALL_CRAWL_HEIGHT,
  normal: { x: 1, y: 0, z: 0 },
};

const GLASS_RIGHT: CrawlFace = {
  id: 'glass-right',
  origin: { x: WALL_INNER_X, y: FLOOR_TOP_Y, z: -WALL_INNER_Z },
  uAxis: { x: 0, y: 0, z: 1 },
  uLength: 2 * WALL_INNER_Z,
  vAxis: { x: 0, y: 1, z: 0 },
  vLength: WALL_CRAWL_HEIGHT,
  normal: { x: -1, y: 0, z: 0 },
};

/** Floor↔wall bottoms and wall↔wall corners — every one of these is a full
 * boundary edge of *both* faces it links (unlike the castle-floor links
 * below), by construction: floor and walls are both built from
 * `WALL_INNER_X`/`WALL_INNER_Z`. */
const BASE_LINKS: FaceLink[] = [
  {
    faceA: FLOOR_FACE_ID,
    faceB: 'glass-front',
    edgeStart: { x: -WALL_INNER_X, y: FLOOR_TOP_Y, z: WALL_INNER_Z },
    edgeEnd: { x: WALL_INNER_X, y: FLOOR_TOP_Y, z: WALL_INNER_Z },
  },
  {
    faceA: FLOOR_FACE_ID,
    faceB: 'glass-back',
    edgeStart: { x: -WALL_INNER_X, y: FLOOR_TOP_Y, z: -WALL_INNER_Z },
    edgeEnd: { x: WALL_INNER_X, y: FLOOR_TOP_Y, z: -WALL_INNER_Z },
  },
  {
    faceA: FLOOR_FACE_ID,
    faceB: 'glass-left',
    edgeStart: { x: -WALL_INNER_X, y: FLOOR_TOP_Y, z: -WALL_INNER_Z },
    edgeEnd: { x: -WALL_INNER_X, y: FLOOR_TOP_Y, z: WALL_INNER_Z },
  },
  {
    faceA: FLOOR_FACE_ID,
    faceB: 'glass-right',
    edgeStart: { x: WALL_INNER_X, y: FLOOR_TOP_Y, z: -WALL_INNER_Z },
    edgeEnd: { x: WALL_INNER_X, y: FLOOR_TOP_Y, z: WALL_INNER_Z },
  },
  {
    faceA: 'glass-front',
    faceB: 'glass-left',
    edgeStart: { x: -WALL_INNER_X, y: FLOOR_TOP_Y, z: WALL_INNER_Z },
    edgeEnd: { x: -WALL_INNER_X, y: WALL_TOP_Y, z: WALL_INNER_Z },
  },
  {
    faceA: 'glass-front',
    faceB: 'glass-right',
    edgeStart: { x: WALL_INNER_X, y: FLOOR_TOP_Y, z: WALL_INNER_Z },
    edgeEnd: { x: WALL_INNER_X, y: WALL_TOP_Y, z: WALL_INNER_Z },
  },
  {
    faceA: 'glass-back',
    faceB: 'glass-left',
    edgeStart: { x: -WALL_INNER_X, y: FLOOR_TOP_Y, z: -WALL_INNER_Z },
    edgeEnd: { x: -WALL_INNER_X, y: WALL_TOP_Y, z: -WALL_INNER_Z },
  },
  {
    faceA: 'glass-back',
    faceB: 'glass-right',
    edgeStart: { x: WALL_INNER_X, y: FLOOR_TOP_Y, z: -WALL_INNER_Z },
    edgeEnd: { x: WALL_INNER_X, y: WALL_TOP_Y, z: -WALL_INNER_Z },
  },
];

/** Stable id prefixes for `CASTLE_COLLIDER_BOXES`, by index — order matches
 * that array's own comments (left wall segment, right wall segment,
 * lintel, left tower, right tower). Purely a naming convenience; if
 * `decorLayout.ts` ever changes the box count, `buildCastleFacesAndLinks`
 * throws immediately rather than silently misnaming a face. */
const CASTLE_BOX_SLUGS = [
  'castle-left-wall',
  'castle-right-wall',
  'castle-lintel',
  'castle-left-tower',
  'castle-right-tower',
] as const;

/** Builds the 5 faces (top + 4 sides) and their links for one castle
 * collider box, in world space. */
function buildCastleFacesAndLinks(): { faces: CrawlFace[]; links: FaceLink[] } {
  const faces: CrawlFace[] = [];
  const links: FaceLink[] = [];
  const FLOOR_TOUCH_EPS = 1e-9;

  CASTLE_COLLIDER_BOXES.forEach((box, index) => {
    const slug = CASTLE_BOX_SLUGS[index];
    if (!slug) {
      throw new Error(`crawlSurfaces: no id slug configured for castle box index ${index}`);
    }

    const centre = {
      x: CASTLE_POSITION.x + box.position.x,
      y: CASTLE_POSITION.y + box.position.y,
      z: CASTLE_POSITION.z + box.position.z,
    };
    const half = box.halfExtents;
    const bottomY = centre.y - half.y;
    const topY = centre.y + half.y;
    const minX = centre.x - half.x;
    const maxX = centre.x + half.x;
    const minZ = centre.z - half.z;
    const maxZ = centre.z + half.z;

    const top: CrawlFace = {
      id: `${slug}-top`,
      origin: { x: minX, y: topY, z: minZ },
      uAxis: { x: 1, y: 0, z: 0 },
      uLength: 2 * half.x,
      vAxis: { x: 0, y: 0, z: 1 },
      vLength: 2 * half.z,
      normal: { x: 0, y: 1, z: 0 },
    };
    const px: CrawlFace = {
      id: `${slug}-side-px`,
      origin: { x: maxX, y: bottomY, z: minZ },
      uAxis: { x: 0, y: 0, z: 1 },
      uLength: 2 * half.z,
      vAxis: { x: 0, y: 1, z: 0 },
      vLength: 2 * half.y,
      normal: { x: 1, y: 0, z: 0 },
    };
    const nx: CrawlFace = {
      id: `${slug}-side-nx`,
      origin: { x: minX, y: bottomY, z: minZ },
      uAxis: { x: 0, y: 0, z: 1 },
      uLength: 2 * half.z,
      vAxis: { x: 0, y: 1, z: 0 },
      vLength: 2 * half.y,
      normal: { x: -1, y: 0, z: 0 },
    };
    const pz: CrawlFace = {
      id: `${slug}-side-pz`,
      origin: { x: minX, y: bottomY, z: maxZ },
      uAxis: { x: 1, y: 0, z: 0 },
      uLength: 2 * half.x,
      vAxis: { x: 0, y: 1, z: 0 },
      vLength: 2 * half.y,
      normal: { x: 0, y: 0, z: 1 },
    };
    const nz: CrawlFace = {
      id: `${slug}-side-nz`,
      origin: { x: minX, y: bottomY, z: minZ },
      uAxis: { x: 1, y: 0, z: 0 },
      uLength: 2 * half.x,
      vAxis: { x: 0, y: 1, z: 0 },
      vLength: 2 * half.y,
      normal: { x: 0, y: 0, z: -1 },
    };

    faces.push(top, px, nx, pz, nz);

    // Side -> own top: each side's top edge (its own v1) coincides exactly
    // with one edge of the top face.
    links.push(
      {
        faceA: px.id,
        faceB: top.id,
        edgeStart: { x: maxX, y: topY, z: minZ },
        edgeEnd: { x: maxX, y: topY, z: maxZ },
      },
      {
        faceA: nx.id,
        faceB: top.id,
        edgeStart: { x: minX, y: topY, z: minZ },
        edgeEnd: { x: minX, y: topY, z: maxZ },
      },
      {
        faceA: pz.id,
        faceB: top.id,
        edgeStart: { x: minX, y: topY, z: maxZ },
        edgeEnd: { x: maxX, y: topY, z: maxZ },
      },
      {
        faceA: nz.id,
        faceB: top.id,
        edgeStart: { x: minX, y: topY, z: minZ },
        edgeEnd: { x: maxX, y: topY, z: minZ },
      },
    );

    // Side -> floor base: only when this box's own bottom actually sits on
    // the sand floor. The lintel (the wall spanning above the doorway
    // arch) floats above the opening — its bottom is at the door's height,
    // not the floor's — so it deliberately gets no floor link on any side.
    // A snail can still stand on it once there (side<->own-top still
    // links, above); it just can't currently crawl onto it from the floor.
    // An edge with no matching link clamps and reflects, per this module's
    // `advance` contract — never a fall through the world.
    if (Math.abs(bottomY - FLOOR_TOP_Y) < FLOOR_TOUCH_EPS) {
      links.push(
        {
          faceA: px.id,
          faceB: FLOOR_FACE_ID,
          edgeStart: { x: maxX, y: bottomY, z: minZ },
          edgeEnd: { x: maxX, y: bottomY, z: maxZ },
        },
        {
          faceA: nx.id,
          faceB: FLOOR_FACE_ID,
          edgeStart: { x: minX, y: bottomY, z: minZ },
          edgeEnd: { x: minX, y: bottomY, z: maxZ },
        },
        {
          faceA: pz.id,
          faceB: FLOOR_FACE_ID,
          edgeStart: { x: minX, y: bottomY, z: maxZ },
          edgeEnd: { x: maxX, y: bottomY, z: maxZ },
        },
        {
          faceA: nz.id,
          faceB: FLOOR_FACE_ID,
          edgeStart: { x: minX, y: bottomY, z: minZ },
          edgeEnd: { x: maxX, y: bottomY, z: minZ },
        },
      );
    }
  });

  return { faces, links };
}

const { faces: CASTLE_FACES, links: CASTLE_LINKS } = buildCastleFacesAndLinks();

export const CRAWL_FACES: CrawlFace[] = [
  FLOOR_FACE,
  GLASS_FRONT,
  GLASS_BACK,
  GLASS_LEFT,
  GLASS_RIGHT,
  ...CASTLE_FACES,
];

export const CRAWL_LINKS: FaceLink[] = [...BASE_LINKS, ...CASTLE_LINKS];

const FACE_MAP: Map<string, CrawlFace> = new Map(CRAWL_FACES.map((face) => [face.id, face]));

function requireFace(id: string): CrawlFace {
  const face = FACE_MAP.get(id);
  if (!face) throw new Error(`crawlSurfaces: unknown face id "${id}"`);
  return face;
}

// --- Boundary crossing / advance --------------------------------------------

/** One edge of a face's traversal domain, in that face's own local (u, v)
 * coordinates — either the face's own outer rectangle boundary (`link:
 * null` unless a `FaceLink` happens to cover it exactly, e.g. a wall's
 * bottom edge) or a `FaceLink`'s segment projected into this face's frame
 * (which, for a castle side's base on the floor, is a strictly *interior*
 * segment, not one of the floor's own four boundary edges). Always
 * axis-aligned in every face's own frame for this module's whole
 * inventory, since every face and every castle box is itself axis-aligned
 * in world space. */
interface BoundaryCandidate {
  u1: number;
  v1: number;
  u2: number;
  v2: number;
  axis: 'u' | 'v';
  link: FaceLink | null;
  /** The neighbouring face's own normal, for a linked candidate — cached
   * here (rather than re-resolved per lookup) since `roundedNormalAt` reads
   * it on every call. `null` for an unlinked boundary (a wall's top, or a
   * castle side's un-linked left/right edge), which is exactly what tells
   * `roundedNormalAt` there's nothing to blend toward there. */
  neighborNormal: Vec3 | null;
}

function buildBoundaries(face: CrawlFace): BoundaryCandidate[] {
  const candidates: BoundaryCandidate[] = [
    { u1: 0, v1: 0, u2: face.uLength, v2: 0, axis: 'v', link: null, neighborNormal: null },
    {
      u1: 0,
      v1: face.vLength,
      u2: face.uLength,
      v2: face.vLength,
      axis: 'v',
      link: null,
      neighborNormal: null,
    },
    { u1: 0, v1: 0, u2: 0, v2: face.vLength, axis: 'u', link: null, neighborNormal: null },
    {
      u1: face.uLength,
      v1: 0,
      u2: face.uLength,
      v2: face.vLength,
      axis: 'u',
      link: null,
      neighborNormal: null,
    },
  ];
  for (const link of CRAWL_LINKS) {
    if (link.faceA !== face.id && link.faceB !== face.id) continue;
    const p1 = projectPointToFace(face, link.edgeStart);
    const p2 = projectPointToFace(face, link.edgeEnd);
    const isVertical = Math.abs(p1.u - p2.u) < 1e-6;
    const neighborId = link.faceA === face.id ? link.faceB : link.faceA;
    candidates.push({
      u1: p1.u,
      v1: p1.v,
      u2: p2.u,
      v2: p2.v,
      axis: isVertical ? 'u' : 'v',
      link,
      neighborNormal: FACE_MAP.get(neighborId)?.normal ?? null,
    });
  }
  return candidates;
}

const BOUNDARIES: Map<string, BoundaryCandidate[]> = new Map(
  CRAWL_FACES.map((face) => [face.id, buildBoundaries(face)]),
);

const RAY_EPS = 1e-9;
const BOUNDS_EPS = 1e-6;

/** Distance (`t`, along `(du, dv)` from `(u, v)`) to `seg`, or `null` if
 * the ray is parallel to it, already past it, or would cross its
 * containing line outside the segment's own span. */
function raySegmentT(
  u: number,
  v: number,
  du: number,
  dv: number,
  seg: BoundaryCandidate,
): number | null {
  if (seg.axis === 'u') {
    if (Math.abs(du) < RAY_EPS) return null;
    const t = (seg.u1 - u) / du;
    if (t <= RAY_EPS) return null;
    const vAt = v + t * dv;
    const vMin = Math.min(seg.v1, seg.v2) - BOUNDS_EPS;
    const vMax = Math.max(seg.v1, seg.v2) + BOUNDS_EPS;
    if (vAt < vMin || vAt > vMax) return null;
    return t;
  }
  if (Math.abs(dv) < RAY_EPS) return null;
  const t = (seg.v1 - v) / dv;
  if (t <= RAY_EPS) return null;
  const uAt = u + t * du;
  const uMin = Math.min(seg.u1, seg.u2) - BOUNDS_EPS;
  const uMax = Math.max(seg.u1, seg.u2) + BOUNDS_EPS;
  if (uAt < uMin || uAt > uMax) return null;
  return t;
}

/** The direction, within `faceB`'s own plane, that points away from the
 * shared edge and into `faceB`'s interior. When the crossing point sits on
 * one of `faceB`'s own four boundary edges (true for every link here
 * *except* a castle side's base against the floor), that's simply
 * whichever of `faceB`'s axes is fixed there, signed inward. For the one
 * exception — the crossing point is strictly interior to `faceB` (the
 * floor) — `faceA` (always a vertical castle side in that case) has a
 * purely horizontal outward normal, which already lies in the (also
 * horizontal) floor's plane and points away from the box: exactly "into"
 * the floor's open area. */
function inwardDirection(faceA: CrawlFace, faceB: CrawlFace, worldPoint: Vec3): Vec3 {
  const EPS = 1e-6;
  const { u, v } = projectPointToFace(faceB, worldPoint);
  if (u <= EPS) return faceB.uAxis;
  if (u >= faceB.uLength - EPS) return scale(faceB.uAxis, -1);
  if (v <= EPS) return faceB.vAxis;
  if (v >= faceB.vLength - EPS) return scale(faceB.vAxis, -1);
  return faceA.normal;
}

/** Re-parameterizes a pose sitting exactly on `link`'s shared edge (on
 * `faceA`) into the neighbouring face's own coordinates, continuously:
 * position by direct projection of the (identical) world point onto the
 * neighbour's frame, heading by decomposing the incoming direction into a
 * component along the shared edge (preserved exactly — same physical line,
 * same world tangent) and a component perpendicular to it within the
 * plane (same magnitude, redirected to point into the neighbour instead of
 * back into `faceA`). This is what makes crossing *any* link here — a
 * simple wall-floor edge or a castle side's interior floor strip — bend
 * around the fold with no jump in world position. */
function crossLink(faceA: CrawlFace, poseAtEdge: CrawlPose, link: FaceLink): CrawlPose {
  const faceBId = link.faceA === faceA.id ? link.faceB : link.faceA;
  const faceB = requireFace(faceBId);
  const worldPoint = facePoint(faceA, poseAtEdge.u, poseAtEdge.v);

  const tangent = normalize(sub(link.edgeEnd, link.edgeStart));
  const forwardA = add(
    scale(faceA.uAxis, Math.cos(poseAtEdge.heading)),
    scale(faceA.vAxis, Math.sin(poseAtEdge.heading)),
  );
  const tangentComp = dot(forwardA, tangent);
  const perpMag = length(sub(forwardA, scale(tangent, tangentComp)));

  const inward = normalize(inwardDirection(faceA, faceB, worldPoint));
  const forwardB = add(scale(tangent, tangentComp), scale(inward, perpMag));

  const newHeading = Math.atan2(dot(forwardB, faceB.vAxis), dot(forwardB, faceB.uAxis));
  const projected = projectPointToFace(faceB, worldPoint);

  return {
    faceId: faceB.id,
    u: clamp(projected.u, 0, faceB.uLength),
    v: clamp(projected.v, 0, faceB.vLength),
    heading: newHeading,
  };
}

interface StepResult {
  pose: CrawlPose;
  consumed: number;
}

function stepAdvance(pose: CrawlPose, remaining: number): StepResult {
  const face = requireFace(pose.faceId);
  const du = Math.cos(pose.heading);
  const dv = Math.sin(pose.heading);
  const candidates = BOUNDARIES.get(face.id) ?? [];

  let bestT = Infinity;
  let bestCandidate: BoundaryCandidate | null = null;
  for (const candidate of candidates) {
    const t = raySegmentT(pose.u, pose.v, du, dv, candidate);
    if (t === null) continue;
    if (t < bestT - RAY_EPS) {
      bestT = t;
      bestCandidate = candidate;
    } else if (Math.abs(t - bestT) <= RAY_EPS && candidate.link && !bestCandidate?.link) {
      // A tie at the same boundary between an outer-rectangle fallback and
      // a real link (a wall's bottom edge is both) — the link always wins.
      bestT = Math.min(bestT, t);
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate || bestT >= remaining) {
    return {
      pose: { ...pose, u: pose.u + remaining * du, v: pose.v + remaining * dv },
      consumed: remaining,
    };
  }

  const hitU = pose.u + bestT * du;
  const hitV = pose.v + bestT * dv;

  if (bestCandidate.link) {
    return {
      pose: crossLink(face, { ...pose, u: hitU, v: hitV }, bestCandidate.link),
      consumed: bestT,
    };
  }

  // Unlinked edge: clamp onto it and reflect the heading component that
  // was carrying the crawler across it — a bounce along the boundary,
  // never a fall off the face.
  const reflectedHeading = bestCandidate.axis === 'u' ? Math.atan2(dv, -du) : Math.atan2(-dv, du);
  return {
    pose: {
      faceId: face.id,
      u: clamp(hitU, 0, face.uLength),
      v: clamp(hitV, 0, face.vLength),
      heading: reflectedHeading,
    },
    consumed: bestT,
  };
}

const MAX_FOLD_STEPS = 32;

/** Marches `pose` forward by `distance` (world units, along its current
 * heading), folding continuously across any `CRAWL_LINKS` edge it crosses
 * and clamping+reflecting at any unlinked one — possibly several of either
 * in one call, if `distance` is large enough to cross more than one
 * boundary (e.g. floor -> castle side -> castle top in a single step).
 * `distance` should be non-negative; a negative value is a no-op. */
export function advance(pose: CrawlPose, distance: number): CrawlPose {
  let current = pose;
  let remaining = distance;
  for (let step = 0; step < MAX_FOLD_STEPS && remaining > RAY_EPS; step++) {
    const { pose: next, consumed } = stepAdvance(current, remaining);
    current = next;
    remaining -= consumed;
    if (consumed <= RAY_EPS) break;
  }
  return current;
}

function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let result = angle % twoPi;
  if (result > Math.PI) result -= twoPi;
  if (result < -Math.PI) result += twoPi;
  return result;
}

/** Rotates `pose`'s heading in place by `deltaAngle` radians — no movement,
 * no face change. */
export function turn(pose: CrawlPose, deltaAngle: number): CrawlPose {
  return { ...pose, heading: normalizeAngle(pose.heading + deltaAngle) };
}

/** A pose's world-space position and orthonormal frame — `forward` is the
 * in-plane heading direction, `up` is the face's own normal, `right`
 * completes a right-handed frame. `Snail.tsx` builds a `THREE.Quaternion`
 * from `forward`/`up` (this module stays three.js-free, see header). */
export function poseToWorld(pose: CrawlPose): CrawlFrame {
  const face = requireFace(pose.faceId);
  const position = facePoint(face, pose.u, pose.v);
  const forward = normalize(
    add(scale(face.uAxis, Math.cos(pose.heading)), scale(face.vAxis, Math.sin(pose.heading))),
  );
  const up = face.normal;
  const right = normalize(cross(forward, up));
  return { position, forward, up, right };
}

// --- Continuous (rounded) frame near a crease --------------------------------

/** World-space distance a crease's rounding reaches on either side — the
 * frame blends fully to the bisector at the crease itself and is exactly
 * the face's own normal by `FILLET_RADIUS` away from it. One module-level
 * constant, not per-face/per-consumer: every crease in this tank is the
 * same kind of fold (two flat faces at a fixed dihedral angle), so there's
 * no reason yet for one to round differently from another. Tune by eye —
 * this needs to be small enough that ordinary floor/wall crawling reads as
 * "on a flat surface" almost everywhere, and large enough that a fold
 * crossing takes a visually legible fraction of a second at crawl speed to
 * complete. */
export const FILLET_RADIUS = 0.08;

/** Cubic smoothstep on `[0, 1]`, clamping first — `THREE.MathUtils
 * .smoothstep`'s own curve, reimplemented here since this module stays
 * three.js-free (see header). Zero slope at both ends is what makes
 * `roundedNormalAt`'s blend weight meet `0` at `d = FILLET_RADIUS` with no
 * kink, not just no jump. */
function smoothstep01(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/** Shortest distance from `(u, v)` to `seg`, treating it as a genuine
 * segment (clamped to its own span) rather than an infinite line — this is
 * what keeps a castle side's floor-base strip from rounding a point well
 * past where that strip actually ends. */
function pointToSegmentDistance(u: number, v: number, seg: BoundaryCandidate): number {
  if (seg.axis === 'u') {
    const vClamped = clamp(v, Math.min(seg.v1, seg.v2), Math.max(seg.v1, seg.v2));
    return Math.hypot(u - seg.u1, v - vClamped);
  }
  const uClamped = clamp(u, Math.min(seg.u1, seg.u2), Math.max(seg.u1, seg.u2));
  return Math.hypot(u - uClamped, v - seg.v1);
}

/** The face's normal, blended toward each nearby linked neighbour's within
 * `filletRadius` of the shared crease, weighted by distance-to-crease and
 * summed (superposing correctly where two creases are close together, e.g.
 * a corner where three faces meet). Exactly `face.normal` by `filletRadius`
 * away from every crease; exactly the bisector `normalize(nFace + nNeighbor)`
 * at the crease itself (both sides' weight is `0.5` at `d = 0`, so the
 * face's own contribution cancels to a flat `0.5` mix); continuous *and*
 * differentiable across the crease (`smoothstep01`'s zero endpoint slope),
 * so a caller deriving position and orientation from this — not from
 * `poseToWorld`'s flat per-face normal — gets no jump and no kink crossing
 * a fold. An unlinked boundary (no `neighborNormal`) contributes nothing,
 * by construction. */
export function roundedNormalAt(faceId: string, u: number, v: number, filletRadius: number): Vec3 {
  const face = requireFace(faceId);
  if (filletRadius <= 0) return face.normal;

  let blended = face.normal;
  for (const candidate of BOUNDARIES.get(faceId) ?? []) {
    if (!candidate.neighborNormal) continue;
    const d = pointToSegmentDistance(u, v, candidate);
    if (d >= filletRadius) continue;
    const weight = 0.5 * (1 - smoothstep01(d / filletRadius));
    blended = add(blended, scale(sub(candidate.neighborNormal, face.normal), weight));
  }
  return normalize(blended);
}

/** Re-derives (`forward`, `right`) so `forward` stays as close as possible
 * to `primary` while lying exactly in the plane perpendicular to `up`
 * (Gram-Schmidt) — what lets `poseToWorldRounded` keep a pose's in-plane
 * heading direction meaningful once `up` itself has been tilted by
 * `roundedNormalAt`. Falls back to `primary` unrotated in the (never
 * expected in this tank's all-axis-aligned geometry) degenerate case where
 * `primary` is nearly parallel to `up` — better than propagating a
 * zero-length vector into `quaternionFromFrame`'s own basis construction. */
function reorthonormalize(primary: Vec3, up: Vec3): { forward: Vec3; right: Vec3 } {
  const rejected = sub(primary, scale(up, dot(primary, up)));
  const rejectedLength = length(rejected);
  const forward = rejectedLength > 1e-6 ? scale(rejected, 1 / rejectedLength) : primary;
  return { forward, right: normalize(cross(forward, up)) };
}

/** Like `poseToWorld`, except `up` (and so `forward`/`right`) comes from
 * `roundedNormalAt` instead of the pose's own face's flat normal —
 * `position` is deliberately untouched, still the exact, sharp-cornered
 * point `poseToWorld` would give: rounding *where* a body sits would let it
 * sink into (or float clear of) a real surface right after a fold crossing,
 * while rounding only the *frame* it's oriented against means the body
 * always sits exactly on a real surface and simply swings its orientation
 * smoothly as that surface's effective normal tilts near a crease. */
export function poseToWorldRounded(pose: CrawlPose, filletRadius: number): CrawlFrame {
  const face = requireFace(pose.faceId);
  const position = facePoint(face, pose.u, pose.v);
  const up = roundedNormalAt(pose.faceId, pose.u, pose.v, filletRadius);
  const planarForward = add(
    scale(face.uAxis, Math.cos(pose.heading)),
    scale(face.vAxis, Math.sin(pose.heading)),
  );
  const { forward, right } = reorthonormalize(planarForward, up);
  return { position, forward, up, right };
}

/** A plausible small-crawler footprint radius to keep a spawned/landed pose
 * clear of the castle by — tune once `snailCollider.ts` (a later PR) gives
 * a real measured value; deliberately smaller than the ~0.3 a fish uses
 * (`decorLayout.test.ts`), since a snail is a much smaller critter. */
const FLOOR_SPAWN_CASTLE_MARGIN = 0.15;

/** A uniformly random pose on the sand floor, clear of the castle
 * (`keepClearOfCastle` — the same castle-avoidance logic `Fish.tsx` uses
 * for a fish's own favourite spot), facing a random direction. `random`
 * must return a value in `[0, 1)`, e.g. `Math.random`. */
export function randomFloorPose(random: () => number): CrawlPose {
  const floor = requireFace(FLOOR_FACE_ID);
  const worldPoint = facePoint(floor, random() * floor.uLength, random() * floor.vLength);
  const clear = keepClearOfCastle(worldPoint, FLOOR_SPAWN_CASTLE_MARGIN);
  const projected = projectPointToFace(floor, clear);
  return {
    faceId: FLOOR_FACE_ID,
    u: clamp(projected.u, 0, floor.uLength),
    v: clamp(projected.v, 0, floor.vLength),
    heading: random() * Math.PI * 2 - Math.PI,
  };
}

/** Where a detached/floated-down crawler lands — the floor position
 * directly below `worldPoint` (its `y` is ignored), nudged clear of the
 * castle by the same margin `randomFloorPose` uses. Heading is left at 0;
 * a caller that cares can `turn()` it afterward. */
export function dropToFloor(worldPoint: Vec3): CrawlPose {
  const floor = requireFace(FLOOR_FACE_ID);
  const clear = keepClearOfCastle(
    { x: worldPoint.x, y: FLOOR_TOP_Y, z: worldPoint.z },
    FLOOR_SPAWN_CASTLE_MARGIN,
  );
  const projected = projectPointToFace(floor, clear);
  return {
    faceId: FLOOR_FACE_ID,
    u: clamp(projected.u, 0, floor.uLength),
    v: clamp(projected.v, 0, floor.vLength),
    heading: 0,
  };
}
