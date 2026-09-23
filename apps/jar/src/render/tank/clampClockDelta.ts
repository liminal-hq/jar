// Clamps the shared R3F frame clock's per-frame delta — split out from
// `TankScene.tsx`'s `onCreated` specifically so the wrapping behaviour is
// unit-testable without a real `THREE.Clock`/`Canvas`.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

/** The subset of `THREE.Clock` this cares about — real `getDelta()` is
 * `(now - oldTime) / 1000` with no clamp of its own, and `elapsedTime` is a
 * plain running total every subscriber reads directly (`FishModel.tsx`'s
 * tail phase, micro-flick/rest-dwell timers, etc.). */
export interface DeltaClock {
  getDelta: () => number;
  elapsedTime: number;
}

/** Wraps `clock.getDelta` in place so no single frame ever reports more
 * than `maxDeltaSec` of elapsed time, and rolls `elapsedTime` back by the
 * same amount so it stays continuous (not just `getDelta`'s return value)
 * — every steering/animation formula in this codebase (velocity-matching
 * impulses, heading slerp factors, exponential decays, tail-phase
 * `t * frequency`) assumes a small, ~60fps delta; R3F's own `useFrame`
 * hands out raw wall-clock elapsed time with no clamp of its own
 * (`@react-three/fiber`'s frame loop calls `clock.getDelta()` verbatim).
 *
 * Real R3F/WebKitGTK windows stall their `requestAnimationFrame` delivery
 * whenever the window loses OS-level foreground/compositing status (e.g.
 * another window gets focus) without becoming "hidden" in the sense
 * `useRenderLoopPolicy` checks — the very next frame after such a stall
 * would otherwise get handed the whole stalled duration as one `delta`,
 * which is what a live screen recording + fish monitor telemetry traced
 * to fish "stuttering" on every click into a separate window: a huge
 * one-frame heading snap, a physics position teleport (Rapier's own
 * internal stepper runs a burst of fixed substeps to catch up), and a
 * tail-phase pop, all in the same rendered frame. Clamping converts that
 * into a fast-but-smooth catch-up instead. */
export function clampClockDelta(clock: DeltaClock, maxDeltaSec: number): void {
  const originalGetDelta = clock.getDelta.bind(clock);
  clock.getDelta = () => {
    const dt = originalGetDelta();
    if (dt > maxDeltaSec) {
      clock.elapsedTime -= dt - maxDeltaSec;
      return maxDeltaSec;
    }
    return dt;
  };
}
