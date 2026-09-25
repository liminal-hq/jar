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
  poseToWorld,
  randomFloorPose,
  turn,
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
function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
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

  it('the link count is exactly the base tank links plus each box`s own links', () => {
    const touchingFloor = CASTLE_COLLIDER_BOXES.filter(
      (box) =>
        Math.abs(CASTLE_POSITION.y + box.position.y - box.halfExtents.y - FLOOR_TOP_Y) < 1e-9,
    ).length;
    const expected = 8 + CASTLE_COLLIDER_BOXES.length * 4 + touchingFloor * 4;
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

  it('clamps and reflects at a castle side face`s un-linked left/right edge', () => {
    const side = faceById('castle-left-tower-side-px');
    const start: CrawlPose = {
      faceId: side.id,
      u: side.uLength - 0.02,
      v: side.vLength / 2,
      heading: 0,
    };
    const result = advance(start, 0.03);

    expect(result.faceId).toBe(side.id);
    expect(result.u).toBeLessThanOrEqual(side.uLength + 1e-9);
    expect(result.u).toBeCloseTo(side.uLength - 0.01, 9);
    // Reflected: heading's u-component (cos) should now point back the
    // other way.
    expect(Math.cos(result.heading)).toBeLessThanOrEqual(1e-9);
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
