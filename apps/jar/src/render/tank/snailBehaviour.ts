// Pure state machine for a snail's activity/tuck-animation mode — the
// `motionState.ts` discipline (states as a closed union, transition logic
// factored out of the render component) applied to a much richer lifecycle
// than a fish's five modes, since a snail's day/night behaviour changes its
// whole silhouette (sealed into its shell) rather than just its steering
// weights. `Snail.tsx` (PR 6) is the only consumer: it calls
// `stepSnailBehaviour` once per frame and reads `tuckProgress`/`tuckMode`
// straight into `SnailModel`'s matching props, and `mode` via `isMoving` to
// decide whether to advance the crawl pose at all this frame.
//
// - `crawling`: awake, wandering the crawl surfaces under its own slow
//   heading drift (`Snail.tsx`'s own concern, not this module's).
// - `pausing`: a brief rest between wander stretches, mirroring
//   `motionState.ts`'s fish `paused` — same tuck state as `crawling` (fully
//   emerged), just holding still.
// - `settling`: sleep has just begun on the floor — `tuckProgress` ramps
//   0→1 over `SEAL_DURATION_SEC`.
// - `sealed`: fully tucked in, `tuckProgress` pinned at 1, holding until
//   sleep lifts.
// - `waking`: sleep has just lifted — `tuckProgress` ramps back 1→0 over
//   `WAKE_DURATION_SEC`, then resumes `crawling`.
// - `startled`: an external trigger (a click, wired up outside this
//   module, in `Snail.tsx`) — the identical tuck rig in `'startle'` mode,
//   which `snailGeometry.ts`'s `tuckPoseForMode` already caps below the
//   operculum-seal window, so a startled snail flinches but never seals.
// - `detached`: knocked or fallen off its current surface (a fish contact,
//   or sleep beginning while off the floor) — `Snail.tsx` owns the actual
//   float-down animation; this module only tracks how long it's been
//   falling (`DETACH_SINK_DURATION_SEC`) and, once landed, hands back to
//   `settling` (if still asleep) or `crawling` (if not).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { STARTLE_MAX_PROGRESS } from '../models/snailGeometry';

export type SnailMotionMode =
  'crawling' | 'pausing' | 'settling' | 'sealed' | 'waking' | 'startled' | 'detached';

export interface SnailBehaviourState {
  mode: SnailMotionMode;
  /** Seconds spent in the current mode — reset to 0 on every transition, so
   * each mode's own timing (below) always measures from when it started. */
  elapsed: number;
  /** Fed straight to `SnailModel`'s `tuckProgress` prop. */
  tuckProgress: number;
  /** Fed straight to `SnailModel`'s `tuckMode` prop. Only ever `'startle'`
   * while `mode === 'startled'`. */
  tuckMode: 'sleep' | 'startle';
  /** When (in seconds of `elapsed` spent `crawling`) to next roll the
   * wander/pause dice — reset to a fresh random interval every time
   * crawling (re)starts, mirroring `Fish.tsx`'s own periodic roll but
   * expressed as state instead of a `setTimeout`, so this module stays a
   * pure step function the way `Fish.tsx`'s imperative timer can't be. */
  nextRollSec: number;
  /** How long the current `pausing` stretch lasts, rolled fresh each time
   * one starts. Meaningless outside `pausing`. */
  pauseDurationSec: number;
}

/** A snail's much slower cadence than a fish's 8-15s wander roll
 * (`Fish.tsx`'s `ROLL_MIN_MS`/`ROLL_MAX_MS`) — tuned for a critter that
 * should read as deliberate, not idle or twitchy. */
const ROLL_MIN_SEC = 14;
const ROLL_MAX_SEC = 10;
const PAUSE_CHANCE = 0.5;
const PAUSE_MIN_SEC = 4;
const PAUSE_MAX_SEC = 8;

/** Tune by eye — slow enough to actually watch a snail tuck away, quick
 * enough not to feel like a loading spinner. */
const SEAL_DURATION_SEC = 2.5;
const WAKE_DURATION_SEC = 2.5;

const STARTLE_RAMP_UP_SEC = 0.3;
const STARTLE_HOLD_SEC = 0.4;
const STARTLE_RAMP_DOWN_SEC = 0.5;
const STARTLE_TOTAL_SEC = STARTLE_RAMP_UP_SEC + STARTLE_HOLD_SEC + STARTLE_RAMP_DOWN_SEC;

/** How long a knocked-loose or fallen snail spends sinking before it lands
 * (`Snail.tsx` owns the actual position/rotation easing over this window;
 * this module only counts it down). Tune by eye — "a slow sink," not
 * ballistic, per issue #98's settled dawn-on-a-wall spec. */
export const DETACH_SINK_DURATION_SEC = 1.4;

function rollInterval(random: () => number): number {
  return ROLL_MIN_SEC + random() * ROLL_MAX_SEC;
}

function rollPauseDuration(random: () => number): number {
  return PAUSE_MIN_SEC + random() * (PAUSE_MAX_SEC - PAUSE_MIN_SEC);
}

export function createInitialSnailBehaviour(
  random: () => number = Math.random,
): SnailBehaviourState {
  return {
    mode: 'crawling',
    elapsed: 0,
    tuckProgress: 0,
    tuckMode: 'sleep',
    nextRollSec: rollInterval(random),
    pauseDurationSec: 0,
  };
}

/** Whether this mode should advance the crawl pose this frame — only
 * `crawling` moves; every other mode (including `pausing`) holds still,
 * mirroring `motionState.ts`'s `isSelfPropelledMode` distinction for
 * fish. */
export function isMoving(mode: SnailMotionMode): boolean {
  return mode === 'crawling';
}

export interface SnailBehaviourInput {
  /** `dayNight.ts`'s `isAsleep('Snail', override, simNight)` — this module
   * has no clock of its own. */
  asleep: boolean;
  /** Whether the snail's current `CrawlPose.faceId` is the tank floor —
   * drives the dawn-on-a-wall detach case. */
  onFloor: boolean;
  /** One-shot: true only on the frame a click (or other external trigger)
   * requests a startle. The caller clears it after one step. */
  startle: boolean;
  /** One-shot, same contract as `startle` — true only on the frame a fish
   * contact was detected (`Snail.tsx`'s `onCollisionEnter`). */
  fishContact: boolean;
  random: () => number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Advances the state machine by `deltaSec`. Pure — no clock, no RNG beyond
 * the injected `input.random`, no three.js/Rapier/R3F — so every branch is
 * directly unit-testable without mounting `Snail.tsx`. */
export function stepSnailBehaviour(
  state: SnailBehaviourState,
  input: SnailBehaviourInput,
  deltaSec: number,
): SnailBehaviourState {
  // Fish contact wins over everything except an already-in-flight detach —
  // "any contact" is enough, from any face, in any other mode (issue #98's
  // settled "playful framing rather than pre-engineering a physics
  // threshold" decision).
  if (input.fishContact && state.mode !== 'detached') {
    return { ...state, mode: 'detached', elapsed: 0, tuckMode: 'sleep' };
  }

  const elapsed = state.elapsed + deltaSec;

  switch (state.mode) {
    case 'detached': {
      if (elapsed < DETACH_SINK_DURATION_SEC) {
        return { ...state, elapsed };
      }
      // Landed — `Snail.tsx` snaps its `CrawlPose` to its own
      // `dropToFloor` result the same frame this transition happens.
      return input.asleep
        ? { ...state, mode: 'settling', elapsed: 0, tuckMode: 'sleep' }
        : {
            ...state,
            mode: 'crawling',
            elapsed: 0,
            tuckProgress: 0,
            tuckMode: 'sleep',
            nextRollSec: rollInterval(input.random),
          };
    }

    case 'startled': {
      if (elapsed < STARTLE_TOTAL_SEC) {
        const rampUp = clamp01(elapsed / STARTLE_RAMP_UP_SEC);
        const rampDownStart = STARTLE_RAMP_UP_SEC + STARTLE_HOLD_SEC;
        const rampDown =
          elapsed <= rampDownStart
            ? 1
            : 1 - clamp01((elapsed - rampDownStart) / STARTLE_RAMP_DOWN_SEC);
        return {
          ...state,
          elapsed,
          tuckMode: 'startle',
          tuckProgress: STARTLE_MAX_PROGRESS * Math.min(rampUp, rampDown),
        };
      }
      return {
        ...state,
        mode: 'crawling',
        elapsed: 0,
        tuckProgress: 0,
        tuckMode: 'sleep',
        nextRollSec: rollInterval(input.random),
      };
    }

    case 'settling': {
      if (!input.asleep) {
        // Continue unsealing from wherever sealing had actually gotten to
        // — seed `elapsed` so `waking`'s own formula picks up at the same
        // `tuckProgress` this frame, rather than the two modes' formulas
        // disagreeing about what `elapsed: 0` means and popping to the
        // opposite extreme for one frame before correcting.
        const elapsedForWaking = (1 - state.tuckProgress) * WAKE_DURATION_SEC;
        return { ...state, mode: 'waking', elapsed: elapsedForWaking, tuckMode: 'sleep' };
      }
      const tuckProgress = clamp01(elapsed / SEAL_DURATION_SEC);
      if (tuckProgress >= 1) {
        return { ...state, mode: 'sealed', elapsed: 0, tuckProgress: 1, tuckMode: 'sleep' };
      }
      return { ...state, elapsed, tuckProgress, tuckMode: 'sleep' };
    }

    case 'sealed': {
      if (!input.asleep) {
        return { ...state, mode: 'waking', elapsed: 0, tuckMode: 'sleep' };
      }
      return state;
    }

    case 'waking': {
      if (input.asleep) {
        // Mirrors `settling`'s own interrupt handling above.
        const elapsedForSettling = state.tuckProgress * SEAL_DURATION_SEC;
        return { ...state, mode: 'settling', elapsed: elapsedForSettling, tuckMode: 'sleep' };
      }
      const tuckProgress = 1 - clamp01(elapsed / WAKE_DURATION_SEC);
      if (tuckProgress <= 0) {
        return {
          ...state,
          mode: 'crawling',
          elapsed: 0,
          tuckProgress: 0,
          tuckMode: 'sleep',
          nextRollSec: rollInterval(input.random),
        };
      }
      return { ...state, elapsed, tuckProgress, tuckMode: 'sleep' };
    }

    case 'crawling':
    case 'pausing': {
      if (input.asleep) {
        return input.onFloor
          ? { ...state, mode: 'settling', elapsed: 0, tuckMode: 'sleep' }
          : { ...state, mode: 'detached', elapsed: 0, tuckMode: 'sleep' };
      }
      if (input.startle) {
        return { ...state, mode: 'startled', elapsed: 0, tuckMode: 'startle', tuckProgress: 0 };
      }
      if (state.mode === 'pausing') {
        if (elapsed >= state.pauseDurationSec) {
          return {
            ...state,
            mode: 'crawling',
            elapsed: 0,
            nextRollSec: rollInterval(input.random),
          };
        }
        return { ...state, elapsed };
      }
      // 'crawling'
      if (elapsed >= state.nextRollSec) {
        if (input.random() < PAUSE_CHANCE) {
          return {
            ...state,
            mode: 'pausing',
            elapsed: 0,
            pauseDurationSec: rollPauseDuration(input.random),
          };
        }
        return { ...state, elapsed: 0, nextRollSec: rollInterval(input.random) };
      }
      return { ...state, elapsed };
    }
  }
}
