// Accumulates a fish's tail-beat phase frame to frame, rather than deriving
// it from absolute session time — see `advanceTailPhase`'s own comment.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

/** Advances a tail-beat phase by one frame. This has to be an accumulator,
 * not `phase = elapsedTime * frequency`: `frequency` varies every frame
 * (speed, turn-rate damping, chase overdrive all feed it), so the
 * instantaneous beat rate under the absolute-time formula is
 * `frequency + elapsedTime * d(frequency)/dt` — a drift term proportional to
 * *session length*, which is how a barely-perceptible per-frame frequency
 * wobble compounds into a visibly scrambled beat after a long-running jar.
 * Accumulating means each frame only ever advances by this frame's own
 * `frequency * delta`, however long the session has been running.
 *
 * Wrapped modulo 2π so the value stays bounded rather than growing an
 * ever-larger float over a multi-hour/day real-time session. */
export function advanceTailPhase(phase: number, frequency: number, delta: number): number {
  return (phase + frequency * delta) % (Math.PI * 2);
}
