// The snail foot's bone rig: turns the crawl spine's own sampled surface
// frames (`Snail.tsx`'s `SampledFrame`s, one per bone) into the 9-bone
// chain's *local* transforms. Extracted out of `Snail.tsx` so the maths is
// importable and testable on its own — a component's `useFrame` body isn't,
// and this file's own invariant ("the foot's sole lands exactly on the
// spine, so the foot and the shell can never drift apart") is the kind of
// thing that has to be asserted, not eyeballed.
//
// Two conventions live here side by side on purpose, because mixing them up
// is exactly what made the skinned foot render detached from its own shell:
//
// - The **RigidBody root** uses the `fishCollider.ts` convention —
//   `forward`→local `+Z`, `up`→local `+Y` — which is why `Snail.tsx`'s inner
//   model group carries a fixed `-90°` yaw (both species' models are
//   authored facing `+X`).
// - A **bone** does not. `snailGeometry.ts`'s `createFootBones` lays the
//   chain out along the model's own authored toe-tail axis, so every bone's
//   child sits at a positive offset along its parent's local `+X`. A bone's
//   rotation therefore has to map `+X` onto the sampled `forward`, not `+Z`
//   — off by 90° about `up`, which swings the whole chain (and so the whole
//   skinned foot) off the body's axis and onto its thickness axis.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';

/** A world-space position plus the surface frame (`up`/`forward`) at one
 * point along the spine — see `Snail.tsx`'s `sampledFrameAt` for how each
 * one is derived (`up` from the crease-rounded normal field, `forward` from
 * a central difference of neighbouring samples, re-orthonormalized). */
export interface SampledFrame {
  position: THREE.Vector3;
  up: THREE.Vector3;
  forward: THREE.Vector3;
}

/** `forward`→local `+Z`, `up`→local `+Y` — the same axis convention
 * `fishCollider.ts` and `Fish.tsx` use, so `Snail.tsx`'s inner model group
 * needs the identical `-90°` yaw correction `Fish.tsx` applies. `xAxis`
 * (local `+X`) is derived as `up × forward` rather than reusing a face's own
 * `right` directly, since that's the assignment that keeps
 * (`forward`, `up`, `xAxis`) a proper right-handed basis under the
 * `(x, y, z)` axis order. Used for the RigidBody root's own orientation —
 * **not** for bones (see this file's header). */
export function basisQuaternionFromVectors(
  forward: THREE.Vector3,
  up: THREE.Vector3,
): THREE.Quaternion {
  const xAxis = new THREE.Vector3().crossVectors(up, forward).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(xAxis, up, forward),
  );
}

/** `forward`→local `+X`, `up`→local `+Y` — the *bone* convention, because a
 * foot bone's own child sits at a positive offset along its parent's local
 * `+X` (`snailGeometry.ts`'s `createFootBones`). `zAxis` is
 * `forward × up` so (`forward`, `up`, `zAxis`) is right-handed, which makes
 * this the identity for a straight body lying along model `+X` with `up` at
 * model `+Y` — exactly the rest pose the foot mesh is bound at. */
export function boneOrientationFromVectors(
  forward: THREE.Vector3,
  up: THREE.Vector3,
): THREE.Quaternion {
  const zAxis = new THREE.Vector3().crossVectors(forward, up).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(forward, up, zAxis),
  );
}

/** The fixed `-90°` yaw `Snail.tsx`'s model group applies, as a quaternion
 * rather than an Euler — the rig needs its *inverse* to project a
 * world-space surface frame back into the model's own (pre-yaw) local
 * space, the space the bones themselves live in. A module-level constant:
 * the yaw never changes per-snail or per-frame. */
const MODEL_YAW_QUAT_INV = new THREE.Quaternion()
  .setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0))
  .invert();

const scratchRootInverse = new THREE.Quaternion();

/** One bone's parent-relative rest-pose-space transform. */
export interface BoneLocalTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** Places every bone *exactly* on its own spine sample, in the model's own
 * pre-yaw local space — both position and orientation, not orientation
 * alone.
 *
 * Driving rotations only (what this rig originally did) leaves the chain's
 * position a pure forward-kinematic consequence of one fixed anchor: bone 0
 * sits at its authored rest offset from the RigidBody root, and every
 * following joint is that anchor plus a run of fixed-length links. The root
 * is anchored at the *shell's seat* (a single spine sample with a single
 * frame), so that anchor is a straight-line offset through space — fine
 * while the whole body is flat, but the moment the body spans a fold (a
 * snail with its seat on a wall and its tail still on the floor) it plants
 * the tail-most bone well off the surface, and the entire foot with it. The
 * shell, a rigid sibling mesh riding the root directly, doesn't move: the
 * two visibly come apart, worst exactly where the body is most bent.
 *
 * Driving positions from the same samples makes that impossible by
 * construction. Bone `i` is placed at the spine sample taken at bone `i`'s
 * own arc-length offset, and the shell's seat rides the sample taken at the
 * seat's offset — the same spine, the same frame, the same instant — so
 * "the shell sits on the foot's back" holds at every pose on every surface
 * rather than only when a chain of intermediate steps happens to line up.
 *
 * `rootPosition`/`rootQuaternion` are the RigidBody's own current transform
 * and `scale` the model group's uniform scale, together the world→model
 * mapping every sample is projected through. Returned transforms are
 * parent-relative (bone 0's parent carries no rotation of its own, so its
 * entry is absolute in model space), tail-most first — matching both
 * `snailGeometry.ts`'s `FOOT_BONE_XS` order and `frames`' own. */
export function footBoneLocalTransforms(
  frames: SampledFrame[],
  rootPosition: THREE.Vector3,
  rootQuaternion: THREE.Quaternion,
  scale: number,
): BoneLocalTransform[] {
  const modelFromWorld = new THREE.Quaternion()
    .copy(MODEL_YAW_QUAT_INV)
    .multiply(scratchRootInverse.copy(rootQuaternion).invert());

  const locals: BoneLocalTransform[] = [];
  let previousOrientation: THREE.Quaternion | null = null;
  let previousPosition: THREE.Vector3 | null = null;

  for (const frame of frames) {
    const forward = frame.forward.clone().applyQuaternion(modelFromWorld);
    const up = frame.up.clone().applyQuaternion(modelFromWorld);
    const orientation = boneOrientationFromVectors(forward, up);
    const position = frame.position
      .clone()
      .sub(rootPosition)
      .applyQuaternion(modelFromWorld)
      .divideScalar(scale);

    if (previousOrientation && previousPosition) {
      // A bone's own transform is parent-relative, so the parent's
      // (absolute, model-space) orientation has to be divided out of both
      // halves: out of the rotation directly, and out of the offset to this
      // joint, which is expressed in the parent's own rotated frame.
      const parentInverse = previousOrientation.clone().invert();
      locals.push({
        position: position.clone().sub(previousPosition).applyQuaternion(parentInverse),
        quaternion: parentInverse.clone().multiply(orientation),
      });
    } else {
      locals.push({ position: position.clone(), quaternion: orientation.clone() });
    }

    previousOrientation = orientation;
    previousPosition = position;
  }

  return locals;
}

/** Writes `footBoneLocalTransforms`'s result straight onto the chain — the
 * per-frame call site. Bones are mutated in place rather than re-rendered:
 * `SnailModel` hands its chain up via `onBonesReady` precisely so this can
 * happen imperatively. */
export function updateFootBones(
  bones: THREE.Bone[],
  frames: SampledFrame[],
  rootPosition: THREE.Vector3,
  rootQuaternion: THREE.Quaternion,
  scale: number,
): void {
  const locals = footBoneLocalTransforms(frames, rootPosition, rootQuaternion, scale);
  for (let i = 0; i < bones.length; i++) {
    const local = locals[i];
    if (!local) break;
    bones[i]!.position.copy(local.position);
    bones[i]!.quaternion.copy(local.quaternion);
  }
}

const scratchOffset = new THREE.Vector3();

/** The transform that carries anything authored in the foot's *rest* model
 * space onto the foot's *current* head — the head bone's own accumulated
 * transform, pre-composed with the inverse of its rest position so a child
 * keeps its authored coordinates instead of having to be re-expressed
 * relative to the bone.
 *
 * The eyestalks need this. They're head parts, but they mount as rigid
 * siblings under the model group, which the RigidBody anchors at the
 * *shell's seat* — so once the foot could bend, a snail rounding a corner
 * left its own stalks hovering where a straight body's head would have
 * been, by as much as a fifth of a body length. Riding the head bone
 * instead puts them back on the head they belong to, at any bend.
 *
 * Composed from the chain's own *local* transforms rather than read off
 * `matrixWorld`, so it's correct in the same frame the bones were driven:
 * three only propagates world matrices at render time, well after the
 * `useFrame` that writes them. Writes into `outPosition`/`outQuaternion`
 * rather than allocating, since this runs per snail per frame. */
export function headMountTransform(
  bones: THREE.Bone[],
  headRestPosition: THREE.Vector3,
  outPosition: THREE.Vector3,
  outQuaternion: THREE.Quaternion,
): void {
  outPosition.set(0, 0, 0);
  outQuaternion.identity();
  for (const bone of bones) {
    outPosition.add(scratchOffset.copy(bone.position).applyQuaternion(outQuaternion));
    outQuaternion.multiply(bone.quaternion);
  }
  outPosition.sub(scratchOffset.copy(headRestPosition).applyQuaternion(outQuaternion));
}

/** The RigidBody root's own world transform, read off the **foot** rather
 * than off a surface sample of its own.
 *
 * The shell is a rigid mesh bolted to the root, and the root's whole job is
 * to be the shell's seat — a single material point on the foot's back, at
 * `seatX` along the authored toe-tail axis. Sampling the spine separately
 * at that point's arc length gives a frame that is *nearly* the foot's, and
 * "nearly" is the whole problem: the seat's offset falls between two bones'
 * offsets, so the two land in different places along the trail and read the
 * surface independently. Where the surface turns quickly — a castle box's
 * top edge, a corner where three faces meet — those independent reads
 * disagree by tens of degrees, and since the shell stands ~`-soleY` tall
 * above the sole, a few tens of degrees at the seat throws its apex most of
 * a body length clear of the foot it is supposed to be sitting on. The seat
 * *point* stays glued the whole time, which is what makes this so easy to
 * miss: it's the shell's body that leaves, by rotating about a contact that
 * never breaks.
 *
 * Blending the two bones that bracket `seatX` — the same two, with the same
 * weights, that the skinned mesh itself blends for a vertex there — removes
 * the independent read entirely. The shell then rides the foot the way a
 * vertex does, so no amount of disagreement in the surface field can
 * separate them: whatever the bones do, the shell does too.
 *
 * Returns the model group's own origin (not the seat): `seatX`/`soleY` are
 * where the seat sits in the model's authored space, so the origin is that
 * far forward of, and above, the seat. */
export function rootTransformFromFoot(
  boneFrames: SampledFrame[],
  boneXs: number[],
  seatX: number,
  soleY: number,
  scale: number,
): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  let index = 0;
  while (index < boneXs.length - 2 && boneXs[index + 1]! < seatX) index++;
  const xa = boneXs[index]!;
  const xb = boneXs[index + 1]!;
  const t = xb > xa ? THREE.MathUtils.clamp((seatX - xa) / (xb - xa), 0, 1) : 0;

  // Each bone carries the seat forward along its own axis: bone and seat
  // share the sole line, so the offset between them is purely along
  // `forward` (the model's authored `+X`, which is what the chain runs
  // along). Lerping the two carried points is linear-blend skinning of the
  // seat, vertex for vertex.
  const carried = (i: number) =>
    boneFrames[i]!.position.clone().addScaledVector(
      boneFrames[i]!.forward,
      (seatX - boneXs[i]!) * scale,
    );
  const position = carried(index).lerp(carried(index + 1), t);

  const quaternion = basisQuaternionFromVectors(
    boneFrames[index]!.forward,
    boneFrames[index]!.up,
  ).slerp(basisQuaternionFromVectors(boneFrames[index + 1]!.forward, boneFrames[index + 1]!.up), t);

  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
  position.addScaledVector(up, -soleY * scale).addScaledVector(forward, -seatX * scale);
  return { position, quaternion };
}
