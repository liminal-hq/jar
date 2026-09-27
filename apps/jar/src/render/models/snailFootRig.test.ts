// Tests for snailFootRig.ts — and, through it, for the one invariant the
// whole snail rig exists to hold: the skinned foot and the rigid shell are
// one animal, so wherever the crawl spine puts the body, the shell's own
// authored seat stays sitting on the foot's back. Every assertion below is
// made against a real `THREE.SkinnedMesh` mounted in the exact scene-graph
// shape `SnailModel.tsx` builds, evaluated through three's own
// `applyBoneTransform` (the CPU twin of the skinning vertex shader) rather
// than against the rig's intermediate maths — the bugs this file guards
// against all produced perfectly self-consistent intermediate values and
// only showed up in where the vertices actually landed.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  addFootSkinAttributes,
  createFootBones,
  EYESTALK_HINGE,
  FOOT_BONE_XS,
  FOOT_TAIL_TIP_X,
  FOOT_TOE_X,
  SHELL_SEAT_X,
  SNAIL_BODY_SCALE,
  SOLE_Y,
  SVG_SCALE,
} from './snailGeometry';
import {
  basisQuaternionFromVectors,
  boneOrientationFromVectors,
  footBoneLocalTransforms,
  headMountTransform,
  rootTransformFromFoot,
  updateFootBones,
  type SampledFrame,
} from './snailFootRig';

/** An adult snail (`lifeStageScale` of 1). */
const SCALE = SVG_SCALE * SNAIL_BODY_SCALE;
const BODY_LENGTH = (FOOT_TOE_X - FOOT_TAIL_TIP_X) * SCALE;

/** Tight enough that nothing visible could hide under it: 0.2% of the body's
 * own length, well under a pixel at any plausible camera distance. */
const EXACT = BODY_LENGTH * 0.002;

interface Rig {
  scene: THREE.Scene;
  root: THREE.Group;
  /** The static, scaled group the bones, the foot mesh and the shell all
   * share — `SnailModel.tsx`'s own `<group scale={scale}>`. */
  modelGroup: THREE.Group;
  bones: THREE.Bone[];
  mesh: THREE.SkinnedMesh;
}

/** Mirrors `SnailModel.tsx`'s mount: a kinematic root carrying the fixed
 * `-90°` model yaw, then the uniformly-scaled model group, with the bone
 * chain and the (separately grouped) skinned foot mesh as siblings under it.
 * Binds in the same order that component's `useLayoutEffect` does. */
function buildRig(): Rig {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  const yawGroup = new THREE.Group();
  yawGroup.rotation.set(0, -Math.PI / 2, 0);
  const modelGroup = new THREE.Group();
  modelGroup.scale.setScalar(SCALE);
  const footGroup = new THREE.Group();

  // Two vertices per bone x — one on the sole (the crawl-surface contact
  // line), one above it — so a bone's own sample position is directly
  // assertable against a real skinned vertex.
  const positions: number[] = [];
  for (const x of FOOT_BONE_XS) {
    positions.push(x, SOLE_Y, 0);
    positions.push(x, SOLE_Y + 30, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  addFootSkinAttributes(geometry);

  const bones = createFootBones();
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());

  scene.add(root);
  root.add(yawGroup);
  yawGroup.add(modelGroup);
  modelGroup.add(bones[0]!);
  modelGroup.add(footGroup);
  footGroup.add(mesh);

  scene.updateMatrixWorld(true);
  bones[0]!.updateWorldMatrix(true, true);
  mesh.updateWorldMatrix(true, false);
  mesh.bind(new THREE.Skeleton(bones));

  return { scene, root, modelGroup, bones, mesh };
}

/** Where a geometry vertex actually renders: skinned into mesh-local space
 * exactly as the vertex shader does, then through the mesh's own world
 * matrix. */
function skinnedWorld(rig: Rig, index: number): THREE.Vector3 {
  const v = new THREE.Vector3().fromBufferAttribute(rig.mesh.geometry.attributes.position!, index);
  rig.mesh.applyBoneTransform(index, v);
  return v.applyMatrix4(rig.mesh.matrixWorld);
}

/** The sole vertex belonging to bone `i` — index `2 * i` by `buildRig`'s own
 * vertex order. */
function soleVertexWorld(rig: Rig, boneIndex: number): THREE.Vector3 {
  return skinnedWorld(rig, boneIndex * 2);
}

function frame(position: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3): SampledFrame {
  return { position, forward: forward.clone().normalize(), up: up.clone().normalize() };
}

/** One synthetic spine, sampled at the seat's own offset behind the head
 * plus every bone's, all as arc length along a chosen shape. `shape(s)`
 * returns the surface point `s` behind the head and the frame there, with
 * `forward` pointing head-ward (the same convention `sampledFrameAt`
 * produces). */
function sampleShape(
  shape: (s: number) => { position: THREE.Vector3; forward: THREE.Vector3; up: THREE.Vector3 },
): { rootFrame: SampledFrame; boneFrames: SampledFrame[] } {
  const at = (offset: number) => {
    const { position, forward, up } = shape(offset);
    return frame(position, forward, up);
  };
  return {
    rootFrame: at((FOOT_TOE_X - SHELL_SEAT_X) * SCALE),
    boneFrames: FOOT_BONE_XS.map((x) => at((FOOT_TOE_X - x) * SCALE)),
  };
}

/** `Snail.tsx`'s own `liftedRootPosition`: the model origin sits above the
 * seat sample by the sole's depth and ahead of it by the seat's own offset
 * along the authored toe-tail axis. */
function rootPositionFor(rootFrame: SampledFrame): THREE.Vector3 {
  return rootFrame.position
    .clone()
    .addScaledVector(rootFrame.up, -SOLE_Y * SCALE)
    .addScaledVector(rootFrame.forward, -SHELL_SEAT_X * SCALE);
}

/** Drives a rig from one synthetic spine and reports what the invariant
 * actually measures: how far each bone and each sole vertex ended up from
 * the sample it was meant to sit on, and how far the shell's own seat point
 * ended up from the foot beneath it. */
function driveAndMeasure(
  shape: (s: number) => { position: THREE.Vector3; forward: THREE.Vector3; up: THREE.Vector3 },
): { boneDrift: number; soleDrift: number; seatGap: number } {
  const rig = buildRig();
  const { rootFrame, boneFrames } = sampleShape(shape);
  const rootPosition = rootPositionFor(rootFrame);
  const rootQuaternion = basisQuaternionFromVectors(rootFrame.forward, rootFrame.up);

  rig.root.position.copy(rootPosition);
  rig.root.quaternion.copy(rootQuaternion);
  rig.scene.updateMatrixWorld(true);

  updateFootBones(rig.bones, boneFrames, rootPosition, rootQuaternion, SCALE);
  rig.scene.updateMatrixWorld(true);
  rig.mesh.skeleton.update();

  let boneDrift = 0;
  let soleDrift = 0;
  for (let i = 0; i < rig.bones.length; i++) {
    const boneWorld = new THREE.Vector3().setFromMatrixPosition(rig.bones[i]!.matrixWorld);
    boneDrift = Math.max(boneDrift, boneWorld.distanceTo(boneFrames[i]!.position));
    soleDrift = Math.max(soleDrift, soleVertexWorld(rig, i).distanceTo(boneFrames[i]!.position));
  }

  // The shell is a plain rigid mesh under the same model group, so its
  // authored seat point — on the sole line at `SHELL_SEAT_X` — is just that
  // model-space point pushed through the group's own world matrix. The foot
  // has a bone at the two x values bracketing it; the nearer one's sole
  // vertex is what has to stay underneath.
  const seat = new THREE.Vector3(SHELL_SEAT_X, SOLE_Y, 0).applyMatrix4(rig.modelGroup.matrixWorld);
  let nearest = 0;
  for (let i = 1; i < FOOT_BONE_XS.length; i++) {
    if (Math.abs(FOOT_BONE_XS[i]! - SHELL_SEAT_X) < Math.abs(FOOT_BONE_XS[nearest]! - SHELL_SEAT_X))
      nearest = i;
  }
  // Discount the authored gap between the seat's own x and that bone's x —
  // what's being measured is *drift*, not the (fixed, correct) spacing
  // between two different material points on the same foot.
  const authored = Math.abs(FOOT_BONE_XS[nearest]! - SHELL_SEAT_X) * SCALE;
  const seatGap = Math.abs(soleVertexWorld(rig, nearest).distanceTo(seat) - authored);

  return { boneDrift, soleDrift, seatGap };
}

const straight = (s: number) => ({
  position: new THREE.Vector3(-s, 0, 0),
  forward: new THREE.Vector3(1, 0, 0),
  up: new THREE.Vector3(0, 1, 0),
});

/** A circular arc on the floor of radius `r`, walked backwards from a head
 * at the origin — a snail mid-turn. */
const arc = (r: number) => (s: number) => ({
  position: new THREE.Vector3(-r * Math.sin(s / r), 0, r * (1 - Math.cos(s / r))),
  forward: new THREE.Vector3(Math.cos(s / r), 0, -Math.sin(s / r)),
  up: new THREE.Vector3(0, 1, 0),
});

/** A floor→wall fold: the head has climbed `climb` up a wall in the `x = 0`
 * plane, the rest of the body trails back along the floor. `climb` past the
 * seat's own offset puts the *shell* on the wall with the tail still flat —
 * the pose where a rotation-only rig came apart worst. */
const fold = (climb: number) => (s: number) =>
  s <= climb
    ? {
        position: new THREE.Vector3(0, climb - s, 0),
        forward: new THREE.Vector3(0, 1, 0),
        up: new THREE.Vector3(-1, 0, 0),
      }
    : {
        position: new THREE.Vector3(-(s - climb), 0, 0),
        forward: new THREE.Vector3(1, 0, 0),
        up: new THREE.Vector3(0, 1, 0),
      };

describe('boneOrientationFromVectors', () => {
  it('is the identity for the rest pose the foot mesh is bound at', () => {
    const q = boneOrientationFromVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
    expect(q.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
  });

  it('maps forward onto the +X the bone chain actually runs along', () => {
    const forward = new THREE.Vector3(0, 1, 0);
    const up = new THREE.Vector3(-1, 0, 0);
    const q = boneOrientationFromVectors(forward, up);
    expect(new THREE.Vector3(1, 0, 0).applyQuaternion(q).distanceTo(forward)).toBeLessThan(1e-9);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(q).distanceTo(up)).toBeLessThan(1e-9);
  });

  it('differs from the RigidBody root convention by the model yaw', () => {
    // The root's own basis puts `forward` on +Z, not +X. Building a bone
    // with that convention is a 90° error about `up` — the regression this
    // separate function exists to prevent.
    const forward = new THREE.Vector3(1, 0, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const rootStyle = basisQuaternionFromVectors(forward, up);
    expect(
      THREE.MathUtils.radToDeg(rootStyle.angleTo(boneOrientationFromVectors(forward, up))),
    ).toBeCloseTo(90, 6);
  });
});

describe('footBoneLocalTransforms', () => {
  it('leaves every bone at its authored rest transform for a straight body', () => {
    const { rootFrame, boneFrames } = sampleShape(straight);
    const locals = footBoneLocalTransforms(
      boneFrames,
      rootPositionFor(rootFrame),
      basisQuaternionFromVectors(rootFrame.forward, rootFrame.up),
      SCALE,
    );
    const rest = createFootBones();
    expect(locals).toHaveLength(rest.length);
    locals.forEach((local, i) => {
      expect(local.position.distanceTo(rest[i]!.position)).toBeLessThan(1e-6);
      expect(local.quaternion.angleTo(rest[i]!.quaternion)).toBeLessThan(1e-6);
    });
  });
});

describe('the foot and the shell are one animal', () => {
  const poses: Array<[string, (s: number) => ReturnType<typeof straight>]> = [
    ['flat on the floor', straight],
    ['mid-turn, one body length of radius', arc(BODY_LENGTH)],
    ['mid-turn, a hard half-body-length radius', arc(BODY_LENGTH / 2)],
    ['crossing a floor→wall fold, tail still down', fold(BODY_LENGTH * 0.25)],
    ['up a wall with the shell past the fold', fold(BODY_LENGTH * 0.85)],
    ['fully onto the wall', fold(BODY_LENGTH * 1.5)],
  ];

  for (const [name, shape] of poses) {
    it(`keeps the shell's seat on the foot's back: ${name}`, () => {
      const { boneDrift, soleDrift, seatGap } = driveAndMeasure(shape);
      expect(boneDrift).toBeLessThan(EXACT);
      expect(soleDrift).toBeLessThan(EXACT);
      expect(seatGap).toBeLessThan(EXACT);
    });
  }
});

describe('headMountTransform', () => {
  it('is the identity while the chain is at its rest pose', () => {
    const bones = createFootBones();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    headMountTransform(bones, new THREE.Vector3(FOOT_TOE_X, SOLE_Y, 0), position, quaternion);
    expect(position.length()).toBeLessThan(1e-6);
    expect(quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
  });

  it('carries the eyestalks onto the head bone once the foot bends', () => {
    // The stalks' own hinge, authored in rest model space, has to end up
    // exactly where the head bone carries that same material point — that
    // is what stops a cornering snail leaving its own stalks behind.
    const rig = buildRig();
    const { rootFrame, boneFrames } = sampleShape(fold(BODY_LENGTH * 0.25));
    const rootPosition = rootPositionFor(rootFrame);
    const rootQuaternion = basisQuaternionFromVectors(rootFrame.forward, rootFrame.up);
    rig.root.position.copy(rootPosition);
    rig.root.quaternion.copy(rootQuaternion);
    updateFootBones(rig.bones, boneFrames, rootPosition, rootQuaternion, SCALE);
    rig.scene.updateMatrixWorld(true);

    const headRest = new THREE.Vector3(FOOT_TOE_X, SOLE_Y, 0);
    const mount = new THREE.Group();
    headMountTransform(rig.bones, headRest, mount.position, mount.quaternion);
    rig.modelGroup.add(mount);
    rig.scene.updateMatrixWorld(true);

    const hinge = new THREE.Vector3(EYESTALK_HINGE.x, EYESTALK_HINGE.y, 0);
    const mounted = hinge.clone().applyMatrix4(mount.matrixWorld);
    const head = rig.bones[rig.bones.length - 1]!;
    const expected = hinge
      .clone()
      .sub(headRest)
      .applyMatrix4(new THREE.Matrix4().extractRotation(head.matrixWorld));
    expected.multiplyScalar(SCALE).add(new THREE.Vector3().setFromMatrixPosition(head.matrixWorld));
    expect(mounted.distanceTo(expected)).toBeLessThan(EXACT);

    // And it genuinely moved: a rigid mount would have left them where a
    // straight body's head would be.
    const rigid = hinge.clone().applyMatrix4(rig.modelGroup.matrixWorld);
    expect(rigid.distanceTo(mounted) / BODY_LENGTH).toBeGreaterThan(0.05);
  });
});

describe('rootTransformFromFoot', () => {
  it('puts the model origin exactly where the rest pose wants it', () => {
    const { boneFrames } = sampleShape(straight);
    const root = rootTransformFromFoot(boneFrames, FOOT_BONE_XS, SHELL_SEAT_X, SOLE_Y, SCALE);
    // A straight body's seat sample is at the origin's own authored offset,
    // so this has to agree with the frame-based derivation to the micron.
    const { rootFrame } = sampleShape(straight);
    expect(root.position.distanceTo(rootPositionFor(rootFrame))).toBeLessThan(1e-9);
    expect(
      root.quaternion.angleTo(basisQuaternionFromVectors(rootFrame.forward, rootFrame.up)),
    ).toBeLessThan(1e-9);
  });

  it('keeps the shell riding the foot through a fold that a seat sample would miss', () => {
    // The two bones bracketing the seat are deliberately given *different*
    // surface frames — the situation a crease produces, and the one a
    // separately-sampled seat frame reads independently and gets wrong.
    const { boneFrames } = sampleShape(fold(BODY_LENGTH * 0.6));
    const root = rootTransformFromFoot(boneFrames, FOOT_BONE_XS, SHELL_SEAT_X, SOLE_Y, SCALE);

    let b = 0;
    while (b < FOOT_BONE_XS.length - 2 && FOOT_BONE_XS[b + 1]! < SHELL_SEAT_X) b++;
    const t = (SHELL_SEAT_X - FOOT_BONE_XS[b]!) / (FOOT_BONE_XS[b + 1]! - FOOT_BONE_XS[b]!);

    // The root's own frame has to be the blend of those two bones, not a
    // third opinion: its `up` must sit between theirs, never outside.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(root.quaternion);
    const spread = boneFrames[b]!.up.angleTo(boneFrames[b + 1]!.up);
    expect(up.angleTo(boneFrames[b]!.up)).toBeLessThanOrEqual(spread + 1e-6);
    expect(up.angleTo(boneFrames[b + 1]!.up)).toBeLessThanOrEqual(spread + 1e-6);
    expect(t).toBeGreaterThan(0);
  });
});
