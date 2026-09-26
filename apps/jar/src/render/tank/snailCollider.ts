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
  SHELL_APEX_HEIGHT_ABOVE_SOLE,
  SHELL_EXTRUSION_DEPTH,
  SHELL_HALF_LENGTH_ABOUT_SEAT,
  SHELL_SEAT_X,
  SNAIL_BODY_SCALE,
  SOLE_Y,
  SVG_SCALE,
} from '../models/snailGeometry';

/** Half-extents of a snail's collider box, in the RigidBody's own local
 * frame, plus the offsets positioning that box relative to the RigidBody's
 * origin. See this module's header for the axis convention. */
export interface SnailColliderHalfExtents {
  x: number;
  y: number;
  z: number;
  /** Local-frame `y` of the box's own centre — its bottom face
   * (`centreOffsetY - y`) lands exactly on `SOLE_Y` (scaled), the same
   * contact line `crawlSurfaces.ts` places the snail's root position
   * against. */
  centreOffsetY: number;
  /** Local-frame `z` of the box's own centre (issue #112's PR 7 re-anchor)
   * — the RigidBody's own origin now sits at the shell's seat's *ground
   * projection* (`Snail.tsx`'s `rootPositionFromFrame`), not the model's
   * local origin, but the collider box itself must still be centred on the
   * shell's own footprint in the model's *unshifted* local coordinates
   * (`SHELL_SEAT_X`, mapped straight across to this module's `z` axis —
   * see this module's header on the axis convention). Without this, the
   * box would still be centred on the old local-origin point, `SHELL_SEAT_X`
   * away from where the shell (and its own half-length,
   * `SHELL_HALF_LENGTH_ABOUT_SEAT`) actually is. */
  centreOffsetZ: number;
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
  // Sized to the shell's own footprint around its seat, not the whole
  // foot (issue #112's PR 7) — only the shell stays rigid once the foot
  // itself can bend (a later PR); a box still sized to the whole foot
  // would stick through whatever surface a bent foot had moved away from.
  const halfLength = SHELL_HALF_LENGTH_ABOUT_SEAT[shell] * s;
  // Turret is genuinely the tallest (§issue #98's assembly table) — this is
  // exactly half of `SHELL_APEX_HEIGHT_ABOVE_SOLE`, so the box spans from
  // the sole to the apex.
  const halfHeight = (SHELL_APEX_HEIGHT_ABOVE_SOLE[shell] / 2) * s;
  const halfThickness =
    (Math.max(SHELL_EXTRUSION_DEPTH[shell], FOOT_DEPTH) / 2) * s + EYESTALK_HEADROOM_SVG * s;
  // Bottom face (`centreOffsetY - halfHeight`) lands exactly on the sole
  // line (`SOLE_Y * s`) — see this module's header.
  const centreOffsetY = SOLE_Y * s + halfHeight;
  const centreOffsetZ = SHELL_SEAT_X * s;
  return { x: halfThickness, y: halfHeight, z: halfLength, centreOffsetY, centreOffsetZ };
}

/** This snail's *current*, life-stage-scaled collider — feeds the real
 * `CuboidCollider` (`Snail.tsx`), recomputed fresh every render so it grows
 * live as `critter.life_stage` changes, the same contract as
 * `fishCollider.ts`'s `colliderHalfExtentsFor`. */
export function snailColliderHalfExtentsFor(critter: Critter): SnailColliderHalfExtents {
  return halfExtentsAt(critter.shell ?? 'Coil', lifeStageScale(critter.life_stage));
}
