// Anticipatory wall-avoidance for fish — steers a vehicle back toward the
// tank's centre once it's within `MARGIN` of any wall, rather than relying
// purely on the physical `CuboidCollider` walls (`AquariumEnvironment.tsx`)
// to correct a bad heading after the fact. Without this, `WanderBehavior`
// keeps commanding fish toward the glass (it has no notion of the tank's
// bounds at all), and the resulting fight between the commanded direction
// and the physical collision response is a real source of visible jitter
// right at the walls.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as YUKA from 'yuka';

import { TANK_INNER_BOUNDS } from '../physics/coordinates';
import { horizontalExtents, verticalExtent, type ColliderHalfExtents } from '../tank/fishCollider';

/** Must be able to out-vote `WanderBehavior`'s own clamped force
 * (`vehicle.maxForce = 3`, `useFishSteering.ts`) at full penetration, or a
 * fish committed to wandering straight at the glass would still win. */
const STRENGTH = 4;

export function pushAxis(
  position: number,
  bound: number,
  margin: number,
  strength: number,
): number {
  const innerEdge = bound - margin;
  if (position > innerEdge) {
    const penetration = Math.min(position - innerEdge, margin);
    return -(penetration / margin) * strength;
  }
  if (position < -innerEdge) {
    const penetration = Math.min(-innerEdge - position, margin);
    return (penetration / margin) * strength;
  }
  return 0;
}

/** How much of the dominant push's own magnitude gets mirrored sideways as
 * the tangential nudge below — small enough to leave wall-avoidance itself
 * clearly dominant, large enough to reliably break a square-on approach's
 * exact symmetry within a handful of frames. Tune by eye.
 *
 * Deliberately three distinct values, not one shared fraction: at an exact
 * *corner* (all three axes penetrating equally — `pushX === pushY ===
 * pushZ`), a single shared fraction makes all three tangential nudges the
 * same magnitude too, and even with independent per-fish handedness signs
 * (below) there's a genuine 1-in-4 chance all three land on the same sign
 * by chance, reproducing the exact "force is a scalar multiple of the
 * fish's own heading" stall this behaviour exists to break — just for the
 * corner instead of a flat wall. Three *distinct* fractions make that
 * impossible outright: `handedness * fraction` can only ever take one of
 * two values (`±fraction`) per axis, and since no two of these fractions
 * share a magnitude, `hx·FX`, `hy·FY`, `hz·FZ` can never coincide for any
 * combination of signs — so the three combined forces can never be equal,
 * and the resultant is never a pure scalar multiple of the incoming
 * heading, corner included. */
const TANGENT_FRACTION_X = 0.2;
const TANGENT_FRACTION_Y = 0.24;
const TANGENT_FRACTION_Z = 0.28;

/** Adds a tangential nudge to `ownPush` (sourced from a *different* axis's
 * own push, scaled by `handedness`/`fraction`) without ever letting that
 * nudge flip `ownPush`'s sign. A first version of this added the raw nudge
 * unconditionally, which is safe when `ownPush` is exactly 0 (the
 * square-on case this exists for — nothing to flip) but not when this axis
 * already has its own smaller, genuinely-correct push of its own: a
 * heavily-penetrated *other* wall could inject a nudge bigger than this
 * axis's own honest signal and steer it back *toward* a wall it's actually
 * still clear of. Discarding the nudge whenever it would cross zero keeps
 * every axis's own containment push authoritative over its own sign — the
 * nudge can still resize it, just never reverse it. */
export function withTangentialNudge(
  ownPush: number,
  sourcePush: number,
  handedness: number,
  fraction: number,
): number {
  // `+ 0` normalizes a `-0` result (`handedness === -1` times a zero
  // `sourcePush` produces exactly that per IEEE754) back to `0` — harmless
  // numerically either way, but `-0` fails a naive `toBe(0)` assertion
  // (`Object.is` distinguishes them) and there's no reason to hand callers
  // a signed zero they'd have to know to normalize themselves.
  const nudge = handedness * Math.abs(sourcePush) * fraction + 0;
  if (ownPush === 0) return nudge;
  const combined = ownPush + nudge;
  return Math.sign(combined) === Math.sign(ownPush) ? combined : ownPush;
}

export class TankContainmentBehaviour extends YUKA.SteeringBehavior {
  /** A fixed per-fish left/right bias per axis, rolled once at construction
   * rather than per frame — this is what makes the tangential nudge below a
   * consistent turn instead of a frame-to-frame flicker with no net effect,
   * and (varying per fish) what keeps a whole tank of fish from all turning
   * the same way off the same wall. Independent per axis, not one shared
   * sign, for the same corner-degeneracy reason `TANGENT_FRACTION_X/Y/Z`
   * are three distinct values rather than one shared fraction — see that
   * constant's own comment. Per-axis handedness alone only made the corner
   * case *probably* resolve (three independent coin flips still land on the
   * same sign 1 time in 4); paired with distinct fractions, it can't fail
   * to resolve at all. */
  private readonly handedness: { x: number; y: number; z: number };

  /** `getColliderHalfExtents`: this fish's *live*, current-size collider
   * box (`fishCollider.ts`) — read fresh every `calculate()` call, same as
   * `getYaw` below, so a still-growing fry's margin shrinks to match its
   * real current body rather than the size it'll eventually grow into
   * (recomputing every frame means there's no staleness risk in using the
   * live size — unlike the old fixed-at-construction radius, which
   * genuinely needed the eventual adult value to avoid needing to be
   * reconstructed as the fish grew). `buffer`: extra room beyond the box
   * itself before the push starts, so the turn happens before the body is
   * close enough to actually touch the glass. `getYaw`: this fish's live
   * current heading — read fresh every `calculate()` call so the
   * horizontal margins below are the fish's *actual* current footprint
   * toward each wall, not a fixed worst-case. A fish approaching a wall
   * nose-on gets the full length margin (as safe as the old flat-radius
   * margin ever was — it undersized badly for a male Veil-tailed adult,
   * ~0.72 against a 0.6 margin, which is exactly the bug the length-based
   * sizing here still guards against); broadside gets close to just the
   * thickness margin, letting a fish approach — and pass through — a gap
   * only as wide as its real, flat body. */
  constructor(
    private readonly getColliderHalfExtents: () => ColliderHalfExtents,
    private readonly buffer: number,
    private readonly getYaw: () => number,
  ) {
    super();
    const rollSign = () => (Math.random() < 0.5 ? 1 : -1);
    this.handedness = { x: rollSign(), y: rollSign(), z: rollSign() };
  }

  calculate(vehicle: YUKA.Vehicle, force: YUKA.Vector3): YUKA.Vector3 {
    const yaw = this.getYaw();
    const halfExtents = this.getColliderHalfExtents();
    const horizontal = horizontalExtents(yaw, halfExtents);
    const marginX = horizontal.x + this.buffer;
    const marginY = verticalExtent(halfExtents) + this.buffer;
    const marginZ = horizontal.z + this.buffer;
    const pushX = pushAxis(vehicle.position.x, TANK_INNER_BOUNDS.x, marginX, STRENGTH);
    const pushY = pushAxis(vehicle.position.y, TANK_INNER_BOUNDS.y, marginY, STRENGTH);
    const pushZ = pushAxis(vehicle.position.z, TANK_INNER_BOUNDS.z, marginZ, STRENGTH);

    // A fish approaching a wall square-on (centred on the tank's other two
    // axes) gets a push that's purely antiparallel to its own heading —
    // nothing to turn it aside. WanderBehavior is the usual source of that
    // turn, but Yuka's steering budget (SteeringManager._accumulate) stops
    // adding anything once the running force magnitude reaches
    // vehicle.maxForce, and this behaviour's own STRENGTH is deliberately
    // set to reach that cap alone at full penetration — so wander can get
    // zero contribution at exactly the moment a fish most needs it to turn
    // away. Mirroring each axis's push onto a *different* axis (cyclically:
    // Z's push nudges X, X's push nudges Y, Y's push nudges Z) adds a
    // perpendicular component to the force by construction, breaking a
    // square-on approach's symmetry directly rather than depending on
    // wander ever getting a turn — see `withTangentialNudge`'s own comment
    // for why the nudge is clamped rather than added raw.
    force.x = withTangentialNudge(pushX, pushZ, this.handedness.x, TANGENT_FRACTION_X);
    force.y = withTangentialNudge(pushY, pushX, this.handedness.y, TANGENT_FRACTION_Y);
    force.z = withTangentialNudge(pushZ, pushY, this.handedness.z, TANGENT_FRACTION_Z);
    return force;
  }
}
