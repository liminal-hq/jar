// Tests for `crawlSurfaces.ts`. Fold continuity across a linked edge is the
// one property this module absolutely cannot get subtly wrong (a snail
// visibly teleporting whenever it walks from the floor onto a wall or a
// castle box) and the hardest to catch by eye — so most of the weight here
// is on `advance()`'s behaviour at every single edge crossing, linked and
// unlinked, over pure function calls with no renderer.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { CASTLE_COLLIDER_BOXES, CASTLE_POSITION, FLOOR_TOP_Y } from './decorLayout';
import { TANK_INNER_BOUNDS } from '../physics/coordinates';
import {
  advance,
  CRAWL_FACES,
  CRAWL_LINKS,
  dropToFloor,
  EDGE_AVOIDANCE_RADIUS,
  FILLET_RADIUS,
  poseToWorld,
  poseToWorldRounded,
  randomFloorPose,
  roundedNormalAt,
  turn,
  unlinkedEdgeAvoidanceBias,
  type CrawlFace,
  type CrawlPose,
  type Vec3,
} from './crawlSurfaces';

// --- shared local helpers (deliberately not imported from the module under
// test, so these tests exercise it purely through its public surface) -----

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
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
function toLocal(face: CrawlFace, point: Vec3): { u: number; v: number } {
  const rel = sub(point, face.origin);
  return { u: dot(rel, face.uAxis), v: dot(rel, face.vAxis) };
}
function faceById(id: string): CrawlFace {
  const face = CRAWL_FACES.find((f) => f.id === id);
  if (!face) throw new Error(`test setup: no face "${id}"`);
  return face;
}

describe('face inventory', () => {
  it('has exactly the floor, four walls, and five faces per castle box', () => {
    expect(CRAWL_FACES.length).toBe(5 + CASTLE_COLLIDER_BOXES.length * 5);
  });

  it('every face has an orthonormal (uAxis, vAxis, normal) frame', () => {
    for (const face of CRAWL_FACES) {
      expect(length(face.uAxis)).toBeCloseTo(1, 9);
      expect(length(face.vAxis)).toBeCloseTo(1, 9);
      expect(length(face.normal)).toBeCloseTo(1, 9);
      expect(dot(face.uAxis, face.vAxis)).toBeCloseTo(0, 9);
      expect(dot(face.uAxis, face.normal)).toBeCloseTo(0, 9);
      expect(dot(face.vAxis, face.normal)).toBeCloseTo(0, 9);
    }
  });

  it('every face has positive extents', () => {
    for (const face of CRAWL_FACES) {
      expect(face.uLength).toBeGreaterThan(0);
      expect(face.vLength).toBeGreaterThan(0);
    }
  });

  it('every face corner sits within the tank (with a hair of float slack)', () => {
    const EPS = 1e-6;
    for (const face of CRAWL_FACES) {
      const corners = [
        face.origin,
        {
          x: face.origin.x + face.uAxis.x * face.uLength,
          y: face.origin.y + face.uAxis.y * face.uLength,
          z: face.origin.z + face.uAxis.z * face.uLength,
        },
        {
          x: face.origin.x + face.vAxis.x * face.vLength,
          y: face.origin.y + face.vAxis.y * face.vLength,
          z: face.origin.z + face.vAxis.z * face.vLength,
        },
      ];
      for (const corner of corners) {
        expect(Math.abs(corner.x)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.x + EPS);
        expect(Math.abs(corner.y)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.y + EPS);
        expect(Math.abs(corner.z)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.z + EPS);
      }
    }
  });

  it("the floor face's y matches FLOOR_TOP_Y exactly", () => {
    const floor = faceById('floor');
    expect(floor.origin.y).toBe(FLOOR_TOP_Y);
    expect(floor.uAxis.y).toBe(0);
    expect(floor.vAxis.y).toBe(0);
  });
});

describe('castle faces track decorLayout directly', () => {
  const slugs = [
    'castle-left-wall',
    'castle-right-wall',
    'castle-lintel',
    'castle-left-tower',
    'castle-right-tower',
  ];

  it.each(CASTLE_COLLIDER_BOXES.map((box, index) => ({ box, index, slug: slugs[index]! })))(
    '$slug top face matches its collider box top exactly',
    ({ box, slug }) => {
      const top = faceById(`${slug}-top`);
      const centre = {
        x: CASTLE_POSITION.x + box.position.x,
        y: CASTLE_POSITION.y + box.position.y,
        z: CASTLE_POSITION.z + box.position.z,
      };
      expect(top.origin.x).toBeCloseTo(centre.x - box.halfExtents.x, 9);
      expect(top.origin.y).toBeCloseTo(centre.y + box.halfExtents.y, 9);
      expect(top.origin.z).toBeCloseTo(centre.z - box.halfExtents.z, 9);
      expect(top.uLength).toBeCloseTo(2 * box.halfExtents.x, 9);
      expect(top.vLength).toBeCloseTo(2 * box.halfExtents.z, 9);
    },
  );

  it('a box whose base is not on the floor (the lintel) gets no floor link', () => {
    const lintelFloorLinks = CRAWL_LINKS.filter(
      (link) =>
        (link.faceA.startsWith('castle-lintel-side') && link.faceB === 'floor') ||
        (link.faceB.startsWith('castle-lintel-side') && link.faceA === 'floor'),
    );
    expect(lintelFloorLinks).toHaveLength(0);
  });

  it('every other box does get all four base-to-floor links', () => {
    for (const slug of [
      'castle-left-wall',
      'castle-right-wall',
      'castle-left-tower',
      'castle-right-tower',
    ]) {
      const floorLinks = CRAWL_LINKS.filter(
        (link) =>
          (link.faceA.startsWith(`${slug}-side`) && link.faceB === 'floor') ||
          (link.faceB.startsWith(`${slug}-side`) && link.faceA === 'floor'),
      );
      expect(floorLinks).toHaveLength(4);
    }
  });

  it('every box gets all four side-to-own-top links', () => {
    for (const slug of slugs) {
      const topLinks = CRAWL_LINKS.filter(
        (link) =>
          (link.faceA.startsWith(`${slug}-side`) && link.faceB === `${slug}-top`) ||
          (link.faceB.startsWith(`${slug}-side`) && link.faceA === `${slug}-top`),
      );
      expect(topLinks).toHaveLength(4);
    }
  });

  it('every box gets all four side-to-adjacent-side corner links, wrapping fully around it', () => {
    for (const slug of slugs) {
      const cornerLinks = CRAWL_LINKS.filter(
        (link) =>
          link.faceA.startsWith(`${slug}-side`) &&
          link.faceB.startsWith(`${slug}-side`) &&
          link.faceA !== link.faceB,
      );
      expect(cornerLinks).toHaveLength(4);
      // Every side face appears in exactly two of this box's corner links
      // (its two actual neighbours) — proof the wrap is complete, not just
      // four links landing lopsidedly on fewer than four distinct sides.
      const sides = ['px', 'nx', 'pz', 'nz'].map((suffix) => `${slug}-side-${suffix}`);
      for (const sideId of sides) {
        const touching = cornerLinks.filter(
          (link) => link.faceA === sideId || link.faceB === sideId,
        );
        expect(touching).toHaveLength(2);
      }
    }
  });

  it('the link count is exactly the base tank links plus each box`s own links', () => {
    const touchingFloor = CASTLE_COLLIDER_BOXES.filter(
      (box) =>
        Math.abs(CASTLE_POSITION.y + box.position.y - box.halfExtents.y - FLOOR_TOP_Y) < 1e-9,
    ).length;
    // Per box: 4 side-to-own-top links + 4 side-to-adjacent-side corner
    // links, plus 4 side-to-floor links for a box that actually touches it.
    const expected = 8 + CASTLE_COLLIDER_BOXES.length * 8 + touchingFloor * 4;
    expect(CRAWL_LINKS.length).toBe(expected);
  });
});

describe('poseToWorld', () => {
  it('returns a genuinely orthonormal frame for a sampling of faces/poses', () => {
    const samples: CrawlPose[] = [
      { faceId: 'floor', u: 1, v: 0.5, heading: 0 },
      { faceId: 'floor', u: 0.3, v: 1.1, heading: 1.234 },
      { faceId: 'glass-front', u: 0.4, v: 0.2, heading: -0.7 },
      { faceId: 'glass-left', u: 0.6, v: 1.0, heading: 2.9 },
      { faceId: 'castle-left-tower-top', u: 0.1, v: 0.1, heading: 0.5 },
    ];
    for (const pose of samples) {
      const frame = poseToWorld(pose);
      expect(length(frame.forward)).toBeCloseTo(1, 9);
      expect(length(frame.up)).toBeCloseTo(1, 9);
      expect(length(frame.right)).toBeCloseTo(1, 9);
      expect(dot(frame.forward, frame.up)).toBeCloseTo(0, 9);
      expect(dot(frame.forward, frame.right)).toBeCloseTo(0, 9);
      expect(dot(frame.up, frame.right)).toBeCloseTo(0, 9);
    }
  });

  it('places a pose at exactly origin + u*uAxis + v*vAxis', () => {
    const floor = faceById('floor');
    const pose: CrawlPose = { faceId: 'floor', u: 1.2, v: 0.4, heading: 0 };
    const { position } = poseToWorld(pose);
    expect(position.x).toBeCloseTo(floor.origin.x + floor.uAxis.x * 1.2 + floor.vAxis.x * 0.4, 9);
    expect(position.y).toBeCloseTo(floor.origin.y + floor.uAxis.y * 1.2 + floor.vAxis.y * 0.4, 9);
    expect(position.z).toBeCloseTo(floor.origin.z + floor.uAxis.z * 1.2 + floor.vAxis.z * 0.4, 9);
  });
});

/** Given a link and the (guaranteed, by construction) face on which its
 * edge is a full boundary, returns which axis is fixed at the boundary
 * ('u' or 'v'), whether it's fixed at that axis's max (vs 0), and the
 * midpoint along the free axis — everything needed to place a pose right
 * next to the edge, heading straight at it. */
function boundaryInfo(
  face: CrawlFace,
  edgeStart: Vec3,
  edgeEnd: Vec3,
): { axis: 'u' | 'v'; atMax: boolean; mid: number } {
  const EPS = 1e-6;
  const p1 = toLocal(face, edgeStart);
  const p2 = toLocal(face, edgeEnd);
  if (Math.abs(p1.u - p2.u) < EPS) {
    if (Math.abs(p1.u) < EPS) return { axis: 'u', atMax: false, mid: (p1.v + p2.v) / 2 };
    if (Math.abs(p1.u - face.uLength) < EPS)
      return { axis: 'u', atMax: true, mid: (p1.v + p2.v) / 2 };
  } else if (Math.abs(p1.v - p2.v) < EPS) {
    if (Math.abs(p1.v) < EPS) return { axis: 'v', atMax: false, mid: (p1.u + p2.u) / 2 };
    if (Math.abs(p1.v - face.vLength) < EPS)
      return { axis: 'v', atMax: true, mid: (p1.u + p2.u) / 2 };
  }
  throw new Error(`test setup: edge is not a boundary of face "${face.id}"`);
}

function poseFacingBoundary(
  face: CrawlFace,
  info: ReturnType<typeof boundaryInfo>,
  backoff: number,
): CrawlPose {
  if (info.axis === 'u') {
    const u = info.atMax ? face.uLength - backoff : backoff;
    const heading = info.atMax ? 0 : Math.PI;
    return { faceId: face.id, u, v: info.mid, heading };
  }
  const v = info.atMax ? face.vLength - backoff : backoff;
  const heading = info.atMax ? Math.PI / 2 : -Math.PI / 2;
  return { faceId: face.id, u: info.mid, v, heading };
}

describe('advance() continuity across every link', () => {
  const BACKOFF = 0.02;
  const BEFORE_GAP = 0.001; // stays strictly on faceA
  const CROSS = 0.01; // strictly past the edge, onto faceB

  it.each(CRAWL_LINKS.map((link, index) => ({ link, index })))(
    'link #$index ($link.faceA <-> $link.faceB) has no position jump crossing it',
    ({ link }) => {
      const faceA = faceById(link.faceA);
      const info = boundaryInfo(faceA, link.edgeStart, link.edgeEnd);
      const start = poseFacingBoundary(faceA, info, BACKOFF);

      const justBefore = advance(start, BACKOFF - BEFORE_GAP);
      const justAfter = advance(start, BACKOFF + CROSS);

      // Sanity: the crossing actually happened (and didn't happen early).
      expect(justBefore.faceId).toBe(faceA.id);
      expect(justAfter.faceId).toBe(link.faceA === faceA.id ? link.faceB : link.faceA);

      // The load-bearing property: however the fold bends the local (u, v)
      // representation, the *world* position can only move as far as the
      // arc length actually travelled between the two calls — never a
      // jump. `advance` is a unit-speed, piecewise-straight traversal, so
      // this bound holds for a correct implementation regardless of how
      // either face's own axes are oriented.
      const displacement = length(
        sub(poseToWorld(justAfter).position, poseToWorld(justBefore).position),
      );
      const travelled = BEFORE_GAP + CROSS;
      expect(displacement).toBeLessThanOrEqual(travelled + 1e-6);
    },
  );

  it('crosses correctly in both directions for a simple case (floor <-> glass-front)', () => {
    const link = CRAWL_LINKS.find((l) => l.faceA === 'floor' && l.faceB === 'glass-front');
    if (!link) throw new Error('test setup: expected a floor<->glass-front link');

    // floor -> wall (already covered generically above, repeated for
    // symmetry) ...
    const floor = faceById('floor');
    const floorInfo = boundaryInfo(floor, link.edgeStart, link.edgeEnd);
    const fromFloor = poseFacingBoundary(floor, floorInfo, BACKOFF);
    const crossedUp = advance(fromFloor, BACKOFF + CROSS);
    expect(crossedUp.faceId).toBe('glass-front');

    // ... and wall -> floor, the other direction.
    const wall = faceById('glass-front');
    const wallInfo = boundaryInfo(wall, link.edgeStart, link.edgeEnd);
    const fromWall = poseFacingBoundary(wall, wallInfo, BACKOFF);
    const justBefore = advance(fromWall, BACKOFF - BEFORE_GAP);
    const justAfter = advance(fromWall, BACKOFF + CROSS);
    expect(justBefore.faceId).toBe('glass-front');
    expect(justAfter.faceId).toBe('floor');
    const displacement = length(
      sub(poseToWorld(justAfter).position, poseToWorld(justBefore).position),
    );
    expect(displacement).toBeLessThanOrEqual(BEFORE_GAP + CROSS + 1e-6);
  });
});

describe('advance() at an unlinked edge', () => {
  it('clamps and reflects heading at the top of a glass wall (nothing linked above it)', () => {
    const wall = faceById('glass-front');
    const start: CrawlPose = {
      faceId: 'glass-front',
      u: wall.uLength / 2,
      v: wall.vLength - 0.02,
      heading: Math.PI / 2,
    };
    // 0.02 reaches the top exactly; the remaining 0.01 continues, now
    // travelling back down (reflected) — advance() doesn't stop dead at
    // the boundary, it keeps consuming the full requested distance.
    const result = advance(start, 0.03);

    expect(result.faceId).toBe('glass-front');
    expect(result.v).toBeLessThanOrEqual(wall.vLength + 1e-9);
    expect(result.v).toBeCloseTo(wall.vLength - 0.01, 9);
    // Reflected: heading's v-component (sin) should now point back down.
    expect(Math.sin(result.heading)).toBeLessThanOrEqual(1e-9);
    expect(Number.isFinite(result.heading)).toBe(true);
  });

  it('wraps onto the adjacent side instead of bouncing, at a castle box`s own vertical corner', () => {
    // Every side's left/right edge is now linked to its neighbour (PR 3) —
    // a crawler wraps all the way around the box rather than bouncing.
    const side = faceById('castle-left-tower-side-px');
    const start: CrawlPose = {
      faceId: side.id,
      u: side.uLength - 0.02,
      v: side.vLength / 2,
      heading: 0,
    };
    const result = advance(start, 0.03);
    expect(result.faceId).not.toBe(side.id);
    expect(result.faceId).toMatch(/^castle-left-tower-side-/);
  });

  it('clamps and reflects at a castle side face`s un-linked bottom edge (the lintel, which never touches the floor)', () => {
    const side = faceById('castle-lintel-side-px');
    const start: CrawlPose = {
      faceId: side.id,
      u: side.uLength / 2,
      v: 0.02,
      heading: -Math.PI / 2,
    };
    const result = advance(start, 0.03);

    expect(result.faceId).toBe(side.id);
    expect(result.v).toBeGreaterThanOrEqual(-1e-9);
    expect(result.v).toBeCloseTo(0.01, 9);
    // Reflected: heading's v-component (sin) should now point back up.
    expect(Math.sin(result.heading)).toBeGreaterThanOrEqual(-1e-9);
  });

  it('never leaves the tank, even after many bounces (a wall-top corner)', () => {
    const wall = faceById('glass-left');
    let pose: CrawlPose = {
      faceId: 'glass-left',
      u: wall.uLength - 0.05,
      v: wall.vLength - 0.05,
      heading: 0.9,
    };
    for (let i = 0; i < 50; i++) {
      pose = advance(pose, 0.05);
      const { position } = poseToWorld(pose);
      expect(Math.abs(position.x)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.x + 1e-6);
      expect(Math.abs(position.y)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.y + 1e-6);
      expect(Math.abs(position.z)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.z + 1e-6);
    }
  });
});

describe('advance() basics', () => {
  it('is a no-op for zero distance', () => {
    const pose: CrawlPose = { faceId: 'floor', u: 1, v: 1, heading: 0.4 };
    expect(advance(pose, 0)).toEqual(pose);
  });

  it('moves straight within a face when nothing is in the way', () => {
    // Near the floor's own far corner, well clear of every castle box, so
    // a short straight hop can't clip one.
    const pose: CrawlPose = { faceId: 'floor', u: 0.2, v: 0.2, heading: 0 };
    const moved = advance(pose, 0.3);
    expect(moved.faceId).toBe('floor');
    expect(moved.u).toBeCloseTo(0.5, 9);
    expect(moved.v).toBeCloseTo(0.2, 9);
    expect(moved.heading).toBe(0);
  });
});

describe('turn()', () => {
  it('rotates heading without moving', () => {
    const pose: CrawlPose = { faceId: 'floor', u: 1, v: 1, heading: 0.2 };
    const turned = turn(pose, 0.5);
    expect(turned.u).toBe(1);
    expect(turned.v).toBe(1);
    expect(turned.heading).toBeCloseTo(0.7, 9);
  });

  it('normalizes heading into (-pi, pi]', () => {
    const pose: CrawlPose = { faceId: 'floor', u: 0, v: 0, heading: 3 };
    const turned = turn(pose, 3);
    expect(turned.heading).toBeGreaterThan(-Math.PI);
    expect(turned.heading).toBeLessThanOrEqual(Math.PI);
  });
});

describe('randomFloorPose', () => {
  it('always lands on the floor, inside the tank, clear of every castle collider box', () => {
    let call = 0;
    const values = [0.1, 0.9, 0.02, 0.5, 0.99, 0.01, 0.3, 0.7, 0.6, 0.4];
    const random = () => values[call++ % values.length]!;

    for (let i = 0; i < 20; i++) {
      const pose = randomFloorPose(random);
      expect(pose.faceId).toBe('floor');
      const { position } = poseToWorld(pose);
      expect(position.y).toBeCloseTo(FLOOR_TOP_Y, 9);
      expect(Math.abs(position.x)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.x + 1e-6);
      expect(Math.abs(position.z)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.z + 1e-6);
      for (const box of CASTLE_COLLIDER_BOXES) {
        const boxWorld = {
          x: CASTLE_POSITION.x + box.position.x,
          y: CASTLE_POSITION.y + box.position.y,
          z: CASTLE_POSITION.z + box.position.z,
        };
        // Full 3D overlap (matching `decorLayout.test.ts`'s own style) —
        // the lintel floats above the doorway, so the floor underneath it
        // is genuinely open and must not be treated as forbidden.
        const inside =
          Math.abs(position.x - boxWorld.x) < box.halfExtents.x &&
          Math.abs(position.y - boxWorld.y) < box.halfExtents.y &&
          Math.abs(position.z - boxWorld.z) < box.halfExtents.z;
        expect(inside).toBe(false);
      }
    }
  });
});

describe('dropToFloor', () => {
  it('lands directly below the given point, at floor height', () => {
    const pose = dropToFloor({ x: -1, y: 3, z: 0.2 });
    expect(pose.faceId).toBe('floor');
    const { position } = poseToWorld(pose);
    expect(position.y).toBeCloseTo(FLOOR_TOP_Y, 9);
    expect(position.x).toBeCloseTo(-1, 6);
    expect(position.z).toBeCloseTo(0.2, 6);
  });

  it('pushes clear of the castle if the point would land inside a collider box', () => {
    const box = CASTLE_COLLIDER_BOXES[0]!;
    const boxWorld = {
      x: CASTLE_POSITION.x + box.position.x,
      y: CASTLE_POSITION.y + box.position.y,
      z: CASTLE_POSITION.z + box.position.z,
    };
    const pose = dropToFloor(boxWorld);
    const { position } = poseToWorld(pose);
    const inside =
      Math.abs(position.x - boxWorld.x) < box.halfExtents.x &&
      Math.abs(position.z - boxWorld.z) < box.halfExtents.z;
    expect(inside).toBe(false);
  });

  it('clamps to inside the tank even for a wildly out-of-bounds point', () => {
    const pose = dropToFloor({ x: 999, y: 0, z: -999 });
    const { position } = poseToWorld(pose);
    expect(Math.abs(position.x)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.x + 1e-6);
    expect(Math.abs(position.z)).toBeLessThanOrEqual(TANK_INNER_BOUNDS.z + 1e-6);
  });
});

function clampToUnit(x: number): number {
  return Math.min(1, Math.max(-1, x));
}

function edgeMidpoint(link: (typeof CRAWL_LINKS)[number]): Vec3 {
  return {
    x: (link.edgeStart.x + link.edgeEnd.x) / 2,
    y: (link.edgeStart.y + link.edgeEnd.y) / 2,
    z: (link.edgeStart.z + link.edgeEnd.z) / 2,
  };
}

describe('roundedNormalAt', () => {
  it('matches the flat face normal far from every crease', () => {
    for (const face of CRAWL_FACES) {
      const u = face.uLength / 2;
      const v = face.vLength / 2;
      const clearance = Math.min(u, face.uLength - u, v, face.vLength - v);
      if (clearance <= FILLET_RADIUS + 1e-6) continue; // a face this small is exercised elsewhere
      const n = roundedNormalAt(face.id, u, v, FILLET_RADIUS);
      expect(n.x).toBeCloseTo(face.normal.x, 9);
      expect(n.y).toBeCloseTo(face.normal.y, 9);
      expect(n.z).toBeCloseTo(face.normal.z, 9);
    }
  });

  it('is unaffected near an unlinked edge (a wall`s top, away from any side corner)', () => {
    const front = faceById('glass-front');
    const n = roundedNormalAt(
      'glass-front',
      front.uLength / 2,
      front.vLength - 0.001,
      FILLET_RADIUS,
    );
    expect(n.x).toBeCloseTo(front.normal.x, 6);
    expect(n.y).toBeCloseTo(front.normal.y, 6);
    expect(n.z).toBeCloseTo(front.normal.z, 6);
  });

  it('superposes two nearby creases exactly at a three-face corner', () => {
    // The floor's own (u=0, v=vLength) corner is where the floor, the
    // front wall, and the left wall all meet — the front-link crease
    // (v = vLength) and the left-link crease (u = 0) both pass through it
    // at distance 0, so the floor's own contribution should cancel out
    // entirely, leaving an even blend of just the two neighbours.
    const floor = faceById('floor');
    const front = faceById('glass-front');
    const left = faceById('glass-left');
    const n = roundedNormalAt('floor', 0, floor.vLength, FILLET_RADIUS);
    const expected = normalize(add(scale(front.normal, 0.5), scale(left.normal, 0.5)));
    expect(n.x).toBeCloseTo(expected.x, 8);
    expect(n.y).toBeCloseTo(expected.y, 8);
    expect(n.z).toBeCloseTo(expected.z, 8);
  });

  it('agrees exactly on both sides of every linked seam (the bisector of the two flat normals)', () => {
    for (const link of CRAWL_LINKS) {
      const faceA = faceById(link.faceA);
      const faceB = faceById(link.faceB);
      const midpoint = edgeMidpoint(link);
      const aLocal = toLocal(faceA, midpoint);
      const bLocal = toLocal(faceB, midpoint);

      const nA = roundedNormalAt(faceA.id, aLocal.u, aLocal.v, FILLET_RADIUS);
      const nB = roundedNormalAt(faceB.id, bLocal.u, bLocal.v, FILLET_RADIUS);
      const expected = normalize(add(faceA.normal, faceB.normal));

      for (const n of [nA, nB]) {
        expect(n.x).toBeCloseTo(expected.x, 7);
        expect(n.y).toBeCloseTo(expected.y, 7);
        expect(n.z).toBeCloseTo(expected.z, 7);
      }
    }
  });

  it('eases smoothly away from every crease, reaching the flat normal exactly by FILLET_RADIUS', () => {
    for (const link of CRAWL_LINKS) {
      const faceA = faceById(link.faceA);
      const midpoint = edgeMidpoint(link);
      const crease = toLocal(faceA, midpoint);
      // A direction from the crease toward the face's own centre stands in
      // for "into the face" generically, for any crease on any face shape
      // this module builds (always a convex rectangle).
      const rawDir = { u: faceA.uLength / 2 - crease.u, v: faceA.vLength / 2 - crease.v };
      const dirLen = Math.hypot(rawDir.u, rawDir.v);
      if (dirLen < 1e-6) continue; // crease sits exactly on the face's own centre — degenerate, skip
      const dir = { u: rawDir.u / dirLen, v: rawDir.v / dirLen };

      const fractions = [0, 0.25, 0.5, 0.75, 0.99, 1, 1.25];
      const angles = fractions.map((f) => {
        const d = f * FILLET_RADIUS;
        const n = roundedNormalAt(
          faceA.id,
          crease.u + dir.u * d,
          crease.v + dir.v * d,
          FILLET_RADIUS,
        );
        return Math.acos(clampToUnit(dot(n, faceA.normal)));
      });

      // Relaxes toward the flat normal (angle 0) as distance from the
      // crease grows — never a sudden jump back toward the tilted value.
      for (let i = 1; i < angles.length; i++) {
        expect(angles[i]!).toBeLessThanOrEqual(angles[i - 1]! + 1e-9);
      }
      // Exactly flat at, and beyond, FILLET_RADIUS itself.
      expect(angles[angles.length - 2]!).toBeCloseTo(0, 6);
      expect(angles[angles.length - 1]!).toBeCloseTo(0, 6);
    }
  });
});

describe('unlinkedEdgeAvoidanceBias', () => {
  it('is zero everywhere on a face with no unlinked edges (the floor)', () => {
    const floor = faceById('floor');
    const pose: CrawlPose = { faceId: 'floor', u: 0.01, v: floor.vLength - 0.01, heading: 0 };
    expect(unlinkedEdgeAvoidanceBias(pose, EDGE_AVOIDANCE_RADIUS)).toBe(0);
  });

  it('is zero far from a genuinely unlinked edge', () => {
    const front = faceById('glass-front');
    const pose: CrawlPose = {
      faceId: 'glass-front',
      u: front.uLength / 2,
      v: front.vLength / 2,
      heading: 0,
    };
    expect(unlinkedEdgeAvoidanceBias(pose, EDGE_AVOIDANCE_RADIUS)).toBe(0);
  });

  it('steers a wanderer heading away from a wall`s unlinked top edge back toward the centre', () => {
    const front = faceById('glass-front');
    const pose: CrawlPose = {
      faceId: 'glass-front',
      u: front.uLength / 2,
      v: front.vLength - 0.01,
      heading: Math.PI / 2 + 0.3, // pointing up and off-axis, away from centre
    };
    const bias = unlinkedEdgeAvoidanceBias(pose, EDGE_AVOIDANCE_RADIUS);
    expect(bias).not.toBe(0);

    const towardCentre = Math.atan2(front.vLength / 2 - pose.v, front.uLength / 2 - pose.u);
    const angleTo = (a: number, b: number) =>
      Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    const before = angleTo(pose.heading, towardCentre);
    const after = angleTo(pose.heading + bias, towardCentre);
    expect(after).toBeLessThan(before);
  });

  it('weakens smoothly with distance, reaching zero at (and beyond) the awareness radius', () => {
    const front = faceById('glass-front');
    const heading = Math.PI / 2;
    const magnitudes = [0, 0.25, 0.5, 0.75, 0.99, 1, 1.5].map((f) => {
      const v = front.vLength - f * EDGE_AVOIDANCE_RADIUS;
      const pose: CrawlPose = { faceId: 'glass-front', u: front.uLength / 2, v, heading };
      return Math.abs(unlinkedEdgeAvoidanceBias(pose, EDGE_AVOIDANCE_RADIUS));
    });
    for (let i = 1; i < magnitudes.length; i++) {
      expect(magnitudes[i]!).toBeLessThanOrEqual(magnitudes[i - 1]! + 1e-9);
    }
    expect(magnitudes[magnitudes.length - 2]!).toBeCloseTo(0, 6);
    expect(magnitudes[magnitudes.length - 1]!).toBe(0);
  });
});

describe('poseToWorldRounded', () => {
  it("keeps position identical to poseToWorld's — only the frame rounds, never where the crawler sits", () => {
    const cases: CrawlPose[] = [
      { faceId: 'floor', u: 0.4, v: 0.9, heading: 1.2 },
      { faceId: 'glass-front', u: 0.6, v: 0.1, heading: -0.4 },
    ];
    for (const pose of cases) {
      const flat = poseToWorld(pose);
      const rounded = poseToWorldRounded(pose, FILLET_RADIUS);
      expect(rounded.position.x).toBeCloseTo(flat.position.x, 10);
      expect(rounded.position.y).toBeCloseTo(flat.position.y, 10);
      expect(rounded.position.z).toBeCloseTo(flat.position.z, 10);
    }
  });

  it('matches poseToWorld exactly away from any crease', () => {
    const floor = faceById('floor');
    const pose: CrawlPose = {
      faceId: 'floor',
      u: floor.uLength / 2,
      v: floor.vLength / 2,
      heading: 0.5,
    };
    const flat = poseToWorld(pose);
    const rounded = poseToWorldRounded(pose, FILLET_RADIUS);
    for (const key of ['forward', 'up', 'right'] as const) {
      expect(rounded[key].x).toBeCloseTo(flat[key].x, 9);
      expect(rounded[key].y).toBeCloseTo(flat[key].y, 9);
      expect(rounded[key].z).toBeCloseTo(flat[key].z, 9);
    }
  });

  it('returns a genuinely orthonormal frame near and far from a crease, across a spread of headings', () => {
    const floor = faceById('floor');
    for (const v of [floor.vLength - FILLET_RADIUS * 0.5, floor.vLength / 2]) {
      for (const heading of [0, 0.7, Math.PI / 2, 2.4, -1.1]) {
        const pose: CrawlPose = { faceId: 'floor', u: floor.uLength / 2, v, heading };
        const frame = poseToWorldRounded(pose, FILLET_RADIUS);
        expect(length(frame.up)).toBeCloseTo(1, 8);
        expect(length(frame.forward)).toBeCloseTo(1, 8);
        expect(length(frame.right)).toBeCloseTo(1, 8);
        expect(dot(frame.forward, frame.up)).toBeCloseTo(0, 8);
        expect(dot(frame.right, frame.up)).toBeCloseTo(0, 8);
        expect(dot(frame.right, frame.forward)).toBeCloseTo(0, 8);
      }
    }
  });
});
