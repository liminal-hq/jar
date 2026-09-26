// A snail's physical size, as a flat box rather than a sphere — mirrors
// `fishCollider.ts`'s exact discipline: a pure module, half-extents hard-
// derived from measured geometry (`snailGeometry.ts`), one policy headroom
// constant tuned by eye, `lifeStageScale` applied live. No React, Rapier, or
// three.js objects, so every formula here is directly unit-testable.
//
// One structural addition versus `fishCollider.ts`: the snail model's own
// local origin isn't the box centre — the foot's sole sits well below it
// (`snailGeometry.ts`'s `SOLE_Y`) and the shell apex well above — so this
// module also returns a `centreOffsetY`, positioning the box so its bottom
// face sits exactly on the sole/contact line rather than straddling the
// model's origin the way the fish's symmetric-about-origin box does.
//
// Axis convention matches `fishCollider.ts` exactly (`x` thickness, `y`
// height, `z` nose-to-tail length) rather than the snail model's own
// authored frame (`+X` toe-to-tail, per `snailGeometry.ts`) — `Snail.tsx`
// applies the identical fixed `-90°` yaw correction `Fish.tsx` applies to
// its own model group, for the identical reason (the model is authored
// facing `+X`; the RigidBody's forward axis is `+Z`).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { Critter } from '../../domain/protocol/generated/Critter';
import type { ShellType } from '../../domain/protocol/generated/ShellType';
import { lifeStageScale } from '../../domain/simConstants';
import {
  FOOT_DEPTH,
  FOOT_TAIL_TIP_X,
  SHELL_APEX_HEIGHT_ABOVE_SOLE,
  SHELL_EXTRUSION_DEPTH,
  SNAIL_BODY_SCALE,
  SOLE_Y,
  SVG_SCALE,
} from '../models/snailGeometry';

/** Half-extents of a snail's collider box, in the RigidBody's own local
 * frame, plus the vertical offset positioning that box relative to the
 * RigidBody's origin. See this module's header for the axis convention. */
export interface SnailColliderHalfExtents {
  x: number;
  y: number;
  z: number;
  /** Local-frame `y` of the box's own centre — its bottom face
   * (`centreOffsetY - y`) lands exactly on `SOLE_Y` (scaled), the same
   * contact line `crawlSurfaces.ts` places the snail's root position
   * against. */
  centreOffsetY: number;
}

/** Extra half-thickness headroom for the eyestalks, which extend beyond
 * the shell/foot silhouettes' own extrusion depth — a policy constant, not
 * a measured extent (unlike every other term here), the same "tune by eye"
 * role `fishCollider.ts`'s `COLLIDER_HALF_THICKNESS_SVG` plays for the
 * fish's pectoral fins. In raw SVG units, scaled the same way as
 * everything else below. */
const EYESTALK_HEADROOM_SVG = 12;

function halfExtentsAt(shell: ShellType, stageScale: number): SnailColliderHalfExtents {
  const s = SVG_SCALE * SNAIL_BODY_SCALE * stageScale;
  // Dominates every shell type: the foot's tail tip sits farther from the
  // model's origin than its toe does (`FOOT_TAIL_TIP_X` vs. `FOOT_TOE_X`,
  // both in `snailGeometry.ts`), so a symmetric box sized off the tail tip
  // alone still fully contains the toe end too, the same "one dominant
  // measured distance, no separate opposite-end term" shape as
  // `fishCollider.ts`'s own `TAIL_TIP_SVG_DISTANCE`.
  const halfLength = Math.abs(FOOT_TAIL_TIP_X) * s;
  // Turret is genuinely the tallest (§issue #98's assembly table) — this is
  // exactly half of `SHELL_APEX_HEIGHT_ABOVE_SOLE`, so the box spans from
  // the sole to the apex.
  const halfHeight = (SHELL_APEX_HEIGHT_ABOVE_SOLE[shell] / 2) * s;
  const halfThickness =
    (Math.max(SHELL_EXTRUSION_DEPTH[shell], FOOT_DEPTH) / 2) * s + EYESTALK_HEADROOM_SVG * s;
  // Bottom face (`centreOffsetY - halfHeight`) lands exactly on the sole
  // line (`SOLE_Y * s`) — see this module's header.
  const centreOffsetY = SOLE_Y * s + halfHeight;
  return { x: halfThickness, y: halfHeight, z: halfLength, centreOffsetY };
}

/** This snail's *current*, life-stage-scaled collider — feeds the real
 * `CuboidCollider` (`Snail.tsx`), recomputed fresh every render so it grows
 * live as `critter.life_stage` changes, the same contract as
 * `fishCollider.ts`'s `colliderHalfExtentsFor`. */
export function snailColliderHalfExtentsFor(critter: Critter): SnailColliderHalfExtents {
  return halfExtentsAt(critter.shell ?? 'Coil', lifeStageScale(critter.life_stage));
}
