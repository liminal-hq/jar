// Pure per-mode behaviour-weight targets and ramping math for
// `useFishSteering.ts` — split out specifically so the ramp itself is
// unit-testable without mocking a Yuka vehicle/`useFrame` loop.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { FishMotionMode } from './motionState';

export interface ModeWeights {
  wander: number;
  separation: number;
  arrive: number;
  pursuit: number;
}

/** Target `.weight` (Yuka's own per-behaviour force-contribution scalar,
 * applied after `calculate()` — `SteeringManager._calculateByOrder`) for
 * each mode. `containment` is deliberately absent — it stays at a fixed
 * weight of 1 in every mode (`useFishSteering.ts`), since even a resting
 * fish shouldn't be able to drift into the glass. */
export const MODE_WEIGHTS: Record<FishMotionMode, ModeWeights> = {
  active: { wander: 1, separation: 1, arrive: 0, pursuit: 0 },
  paused: { wander: 0, separation: 1, arrive: 0, pursuit: 0 },
  settling: { wander: 0, separation: 0, arrive: 1, pursuit: 0 },
  settled: { wander: 0, separation: 0, arrive: 0, pursuit: 0 },
  // A chase is a committed beeline, not a meander — wander off. Separation
  // stays on to protect third-party fish the chaser passes; it doesn't fight
  // pursuit near the target because `CHASE_CAUGHT_SURFACE_GAP`
  // (`chaseParams.ts`) ends the chase right around where separation would
  // start pushing back.
  chasing: { wander: 0, separation: 1, arrive: 0, pursuit: 1 },
};

/** ~0.5s time constant — softens a mode flip's behaviour-set change from an
 * instant on/off into a smooth fade, so `ArriveBehavior`'s own steering
 * force (`desiredVelocity - vehicle.velocity`, effectively unbounded by
 * anything but `vehicle.maxForce`) doesn't suddenly apply at full strength
 * the instant night falls or lifts. A sudden full-strength redirect like
 * that fed directly into `FishModel.tsx`'s turn-boosted tail amplitude was
 * the live cause traced for fish visibly "shaking" for a moment right at
 * every settle/wake transition — confirmed via the Tank monitor window's
 * peak turn-rate readout spiking exactly then
 * (`windows/TankMonitor/TankMonitorWindow.tsx`). */
export const BEHAVIOUR_WEIGHT_RAMP_RATE = 2;

/** Moves `current` a framerate-independent step toward `target` — the same
 * `1 - exp(-rate * delta)` exponential-approach shape used elsewhere in
 * this codebase (`SteeringSystem.tsx`'s heading slerp, `FishModel.tsx`'s
 * rest blend). Never mutates `current`. */
export function rampWeights(
  current: ModeWeights,
  target: ModeWeights,
  delta: number,
  rate: number = BEHAVIOUR_WEIGHT_RAMP_RATE,
): ModeWeights {
  const t = 1 - Math.exp(-rate * delta);
  return {
    wander: current.wander + (target.wander - current.wander) * t,
    separation: current.separation + (target.separation - current.separation) * t,
    arrive: current.arrive + (target.arrive - current.arrive) * t,
    pursuit: current.pursuit + (target.pursuit - current.pursuit) * t,
  };
}
