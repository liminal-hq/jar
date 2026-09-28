// Tests for the snail foot's girth/length deformation — the factor maths, the
// per-vertex map's two anchors, and the reason the whole thing has to be a
// vertex deformation in the first place: a real foot `SkinnedMesh`, built from
// the real geometry and bone chain, is driven through three's own skinning
// maths to show that an ancestor's scale moves nothing while the deformation
// moves every vertex it should.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { deformFootVertex, footDeformation, FOOT_WITHDRAW_GIRTH } from './footDeformation';
import {
  addFootSkinAttributes,
  createFootBones,
  createFootGeometry,
  FOOT_TOE_X,
  SOLE_Y,
} from './snailGeometry';

describe('footDeformation', () => {
  it('is the identity at rest', () => {
    expect(footDeformation(0, 0)).toEqual({ girth: 1, length: 1 });
  });

  it('thins girth with withdrawal and never touches length', () => {
    const half = footDeformation(0.5, 0);
    expect(half.girth).toBeCloseTo(1 - 0.5 * FOOT_WITHDRAW_GIRTH, 10);
    expect(half.length).toBe(1);

    const full = footDeformation(1, 0);
    expect(full.girth).toBeCloseTo(1 - FOOT_WITHDRAW_GIRTH, 10);
    expect(full.length).toBe(1);
  });

  it('trades girth against length under squash-and-stretch', () => {
    const stretched = footDeformation(0, 0.25);
    expect(stretched.length).toBeCloseTo(1.25, 10);
    expect(stretched.girth).toBeCloseTo(1 / 1.25, 10);

    const squashed = footDeformation(0, -0.25);
    expect(squashed.length).toBeCloseTo(0.75, 10);
    expect(squashed.girth).toBeCloseTo(1 / 0.75, 10);
  });

  it('keeps both factors strictly positive for any input', () => {
    for (const [withdraw, stretch] of [
      [1, -1],
      [1, -5],
      [2, -1],
      [-3, -1],
    ] as const) {
      const deformation = footDeformation(withdraw, stretch);
      expect(deformation.girth).toBeGreaterThan(0);
      expect(deformation.length).toBeGreaterThan(0);
    }
  });
});

describe('deformFootVertex', () => {
  const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  it('leaves every vertex exactly where it was at rest', () => {
    const vertex = at(40, -20, 7);
    deformFootVertex(vertex, footDeformation(0, 0), SOLE_Y, FOOT_TOE_X);
    expect(vertex.toArray()).toEqual([40, -20, 7]);
  });

  it('pins the sole line for any girth — the crawl-surface contact contract', () => {
    for (const withdraw of [0.25, 0.5, 1]) {
      const onSole = at(-60, SOLE_Y, 5);
      deformFootVertex(onSole, footDeformation(withdraw, 0), SOLE_Y, FOOT_TOE_X);
      expect(onSole.y).toBeCloseTo(SOLE_Y, 12);
    }
  });

  it('never pushes a vertex below the sole line', () => {
    const aboveSole = at(0, SOLE_Y + 30, 0);
    deformFootVertex(aboveSole, footDeformation(1, -0.35), SOLE_Y, FOOT_TOE_X);
    expect(aboveSole.y).toBeGreaterThan(SOLE_Y);
  });

  it('pins the toe and elongates the body behind it', () => {
    const toe = at(FOOT_TOE_X, -30, 0);
    deformFootVertex(toe, footDeformation(0, 0.3), SOLE_Y, FOOT_TOE_X);
    expect(toe.x).toBeCloseTo(FOOT_TOE_X, 12);

    const tail = at(-125, -30, 0);
    deformFootVertex(tail, footDeformation(0, 0.3), SOLE_Y, FOOT_TOE_X);
    // Stretching moves the tail further *behind* the toe, never past it.
    expect(tail.x).toBeLessThan(-125);
  });

  it('narrows about the body centre plane, which extrusion already centres on z=0', () => {
    const near = at(0, -30, 9);
    const far = at(0, -30, -9);
    const deformation = footDeformation(1, 0);
    deformFootVertex(near, deformation, SOLE_Y, FOOT_TOE_X);
    deformFootVertex(far, deformation, SOLE_Y, FOOT_TOE_X);
    expect(near.z).toBeCloseTo(9 * deformation.girth, 10);
    expect(far.z).toBeCloseTo(-9 * deformation.girth, 10);
  });
});

/** The real foot: real geometry, real skin attributes, the real 9-bone chain,
 * bound the same way `SnailModel.tsx` binds it — mesh and bone root as
 * siblings under one outer group, with an extra group between the outer group
 * and the mesh standing in for the scale that used to be applied there. */
function buildFoot(): {
  mesh: THREE.SkinnedMesh;
  outer: THREE.Group;
  meshParent: THREE.Group;
} {
  const geometry = createFootGeometry();
  addFootSkinAttributes(geometry);
  const bones = createFootBones();

  const outer = new THREE.Group();
  const meshParent = new THREE.Group();
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  meshParent.add(mesh);
  outer.add(bones[0]!);
  outer.add(meshParent);
  outer.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));

  return { mesh, outer, meshParent };
}

/** Where a vertex actually lands on screen: three's own `applyBoneTransform`
 * (`skinning_vertex.glsl`'s maths, line for line) followed by the mesh's own
 * `matrixWorld` (`project_vertex`'s). */
function renderedPosition(mesh: THREE.SkinnedMesh, index: number, local: THREE.Vector3) {
  return mesh.localToWorld(mesh.applyBoneTransform(index, local.clone()));
}

function vertexAt(mesh: THREE.SkinnedMesh, index: number): THREE.Vector3 {
  return new THREE.Vector3().fromBufferAttribute(
    mesh.geometry.attributes.position as THREE.BufferAttribute,
    index,
  );
}

describe('a scale above a skinned foot mesh', () => {
  it('is cancelled out of the skinning maths entirely', () => {
    const { mesh, outer, meshParent } = buildFoot();
    const index = Math.floor(mesh.geometry.attributes.position!.count / 3);
    const local = vertexAt(mesh, index);

    const before = renderedPosition(mesh, index, local);

    // Exactly what the retired `footGroupRef` scale did: withdrawal on all
    // three axes, squash-and-stretch traded between them.
    meshParent.scale.set(0.15 * 1.35, 0.15 / 1.35, 0.15 / 1.35);
    outer.updateMatrixWorld(true);

    const after = renderedPosition(mesh, index, local);
    expect(after.distanceTo(before)).toBeLessThan(1e-9);

    // The control, so the assertion above can't pass for the wrong reason: the
    // scale and the maths measuring it are both live, and it is specifically
    // `AttachedBindMode`'s per-frame `bindMatrixInverse` that annihilates it.
    mesh.bindMode = THREE.DetachedBindMode;
    outer.updateMatrixWorld(true);
    expect(renderedPosition(mesh, index, local).distanceTo(before)).toBeGreaterThan(1e-3);
  });

  it('stays cancelled for every vertex, not just a lucky one', () => {
    const { mesh, outer, meshParent } = buildFoot();
    const count = mesh.geometry.attributes.position!.count;
    const rest = Array.from({ length: count }, (_, i) =>
      renderedPosition(mesh, i, vertexAt(mesh, i)),
    );

    meshParent.scale.setScalar(4);
    outer.updateMatrixWorld(true);

    let worst = 0;
    for (let i = 0; i < count; i++) {
      worst = Math.max(worst, renderedPosition(mesh, i, vertexAt(mesh, i)).distanceTo(rest[i]!));
    }
    expect(worst).toBeLessThan(1e-9);
  });
});

describe('the foot deformation applied where the shader applies it', () => {
  it('moves rendered vertices that an ancestor scale could not', () => {
    const { mesh } = buildFoot();
    const count = mesh.geometry.attributes.position!.count;
    const deformation = footDeformation(1, 0);

    let moved = 0;
    let worstSoleLift = 0;
    for (let i = 0; i < count; i++) {
      const local = vertexAt(mesh, i);
      const rest = renderedPosition(mesh, i, local);
      const deformed = renderedPosition(
        mesh,
        i,
        deformFootVertex(local.clone(), deformation, SOLE_Y, FOOT_TOE_X),
      );
      if (deformed.distanceTo(rest) > 1e-6) moved++;
      // A vertex on the sole may narrow sideways, but it must never leave the
      // contact plane the crawl surface is defined by.
      if (Math.abs(local.y - SOLE_Y) < 1e-9) {
        worstSoleLift = Math.max(worstSoleLift, Math.abs(deformed.y - rest.y));
      }
    }

    // A full withdrawal collapses the body onto the sole: the overwhelming
    // majority of the foot's vertices have to move, not a handful.
    expect(moved).toBeGreaterThan(count * 0.8);
    expect(worstSoleLift).toBeLessThan(1e-9);
  });

  it('reverses direction between stretch and squash', () => {
    const { mesh } = buildFoot();
    // The vertex furthest from both anchors, so the assertion can't land on
    // one the deformation legitimately holds still.
    const count = mesh.geometry.attributes.position!.count;
    let index = 0;
    let furthest = -Infinity;
    for (let i = 0; i < count; i++) {
      const v = vertexAt(mesh, i);
      const reach = Math.abs(v.x - FOOT_TOE_X) + Math.abs(v.y - SOLE_Y);
      if (reach > furthest) {
        furthest = reach;
        index = i;
      }
    }

    const local = vertexAt(mesh, index);
    const rest = renderedPosition(mesh, index, local);
    const stretched = renderedPosition(
      mesh,
      index,
      deformFootVertex(local.clone(), footDeformation(0, 0.3), SOLE_Y, FOOT_TOE_X),
    );
    const squashed = renderedPosition(
      mesh,
      index,
      deformFootVertex(local.clone(), footDeformation(0, -0.3), SOLE_Y, FOOT_TOE_X),
    );

    expect(stretched.distanceTo(rest)).toBeGreaterThan(1e-6);
    expect(squashed.distanceTo(rest)).toBeGreaterThan(1e-6);
    // Opposite sides of rest along the body axis, so the two poses are further
    // apart from each other than either is from rest.
    expect(stretched.x).toBeLessThan(rest.x);
    expect(squashed.x).toBeGreaterThan(rest.x);
    expect(stretched.distanceTo(squashed)).toBeGreaterThan(stretched.distanceTo(rest));
  });
});
