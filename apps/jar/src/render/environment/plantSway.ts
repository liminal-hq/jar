// Pure bend-angle math for a swaying plant blade — split out (same
// rationale as `chaseParams.ts`) so it's unit-testable without a geometry
// or `useFrame` loop. `Plants.tsx` applies the returned angle as a rigid
// rotation of each vertex's (height-from-base, width) pair, the same
// per-vertex-bend technique `FishModel.tsx`'s veil tail uses — see that
// file's veil-bend code for the vertex loop this feeds.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

/** Slow — a gentle current, not a flutter; much slower than even a resting
 * fish's tail beat (`FishModel.tsx`'s `REST_TAIL_FREQUENCY`). */
export const SWAY_FREQUENCY = 0.5;
export const SWAY_AMPLITUDE = 0.18;
/** Per-height stagger so the bend visibly travels up the blade rather than
 * the whole blade swaying as one rigid unit — reuses §6.6's own per-segment
 * stagger constant (`FishModel.tsx`'s `VEIL_PHASE_LAG`), the same "how much
 * a flexible strip's far end lags its base" value already established for
 * the veil tail. */
export const SWAY_PHASE_LAG = 1.1;

/** The bend angle at a given point along a blade's length — `tt` is height
 * from the base normalized to [0, 1] (0 at the base, 1 at the tip), `t` is
 * elapsed time, `phase` is a per-blade offset so a cluster's blades don't
 * sway in unison. Zero at the base by construction (the `tt` factor), so a
 * blade never appears to pivot away from where it's rooted. */
export function bladeSwayAngle(tt: number, t: number, phase: number): number {
  return tt * SWAY_AMPLITUDE * Math.sin(t * SWAY_FREQUENCY + phase + tt * SWAY_PHASE_LAG);
}

/** How close a fish has to get to a plant before it visibly pushes a blade
 * aside, and the biggest extra bend it can add on top of the ambient
 * current sway — large enough to read as "the fish just brushed past,"
 * capped well short of folding a blade back on itself. */
export const DISTURBANCE_RADIUS = 0.5;
export const DISTURBANCE_MAX_ANGLE = 0.9;

/** Extra bend from the nearest disturbing fish — 0 at or beyond
 * `DISTURBANCE_RADIUS`, growing smoothly as the fish closes in, signed so
 * the blade leans *away* from whichever side (`localOffsetX`) the fish is
 * on. `Plants.tsx` scales this by the same `tt` the ambient sway uses, so a
 * nearby fish still only visibly moves the blade's upper reach, not its
 * rooted base. */
export function plantDisturbanceAngle(localOffsetX: number, distance: number): number {
  if (distance >= DISTURBANCE_RADIUS) return 0;
  const closeness = 1 - Math.max(0, distance) / DISTURBANCE_RADIUS;
  const direction = localOffsetX >= 0 ? -1 : 1;
  return direction * closeness * DISTURBANCE_MAX_ANGLE;
}
