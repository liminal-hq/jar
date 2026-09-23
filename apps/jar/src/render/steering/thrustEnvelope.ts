// The burst-and-glide propulsion pulse: converts a fish's tail-beat phase
// into a multiplier on the physics impulse (`SteeringSystem.tsx`), so thrust
// arrives on the power stroke and the fish coasts under damping between
// beats — real fish don't track a velocity setpoint continuously.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

/** Sharpness of the pulse — higher narrows each half-stroke's push toward
 * its midpoint; a live-tuning knob, not derived from first principles. */
export const THRUST_ENVELOPE_EXPONENT = 2;

/** The mean of `abs(sin(x))^THRUST_ENVELOPE_EXPONENT` over a full period,
 * dividing it out below so `thrustMultiplierFor`'s time-average is 1 — the
 * *mean* corrective force on a cruising fish stays what `VELOCITY_GAIN`
 * (`SteeringSystem.tsx`) was already tuned for, and only the instantaneous
 * shape becomes pulsed. Closed form for exponent 2: `sin²x` averages to 1/2
 * over any period, and `abs()` doesn't change that (squaring already makes
 * it non-negative). Re-derive (or sample numerically) if
 * `THRUST_ENVELOPE_EXPONENT` changes. */
const THRUST_ENVELOPE_MEAN = 0.5;

/** Two gentler pulses per tail-beat cycle (once per half-stroke, matching
 * how a real fin generates thrust on *both* the left and right sweep, not
 * just one) rather than one sharp pulse against a fully dead half-cycle. An
 * earlier `max(0, sin(phase))` version — thrust only on the front half, a
 * genuine zero-force coast on the back half — under-delivered net forward
 * progress in practice: during that dead half, `linearDamping`
 * (`SteeringSystem.tsx`) decays the body's real velocity unopposed, and
 * that decay-only window drags the average speed down more than
 * mean-preserving the *force* alone accounts for. `abs(sin)` only touches
 * zero for an instant at each stroke reversal, never leaving damping a
 * sustained, uncontested window — fish keep making real headway between
 * pulses instead of stalling and re-orienting in place. */
export function thrustMultiplierFor(phase: number): number {
  return Math.abs(Math.sin(phase)) ** THRUST_ENVELOPE_EXPONENT / THRUST_ENVELOPE_MEAN;
}
