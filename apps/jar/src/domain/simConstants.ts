// Constants mirrored from `crates/jar-core` for frontend-only presentation
// concerns (life-stage scaling, etc.) that don't need a round trip through
// the Rust core. Keep in sync with `crates/jar-core/src/clock.rs` and
// `crates/jar-core/src/tick.rs` by hand — these are small, stable numbers
// from SPEC.md §5, not part of the generated protocol.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

export const SECONDS_PER_JAR_DAY = 120;

export const JUVENILE_AT_DAYS = 2;
export const ADULT_AT_DAYS = 5;
export const ELDER_AT_DAYS = 22;

export type LifeStage = 'Fry' | 'Juvenile' | 'Adult' | 'Elder';

export function lifeStageOf(ageSec: number): LifeStage {
  const ageDays = ageSec / SECONDS_PER_JAR_DAY;
  if (ageDays < JUVENILE_AT_DAYS) return 'Fry';
  if (ageDays < ADULT_AT_DAYS) return 'Juvenile';
  if (ageDays < ELDER_AT_DAYS) return 'Adult';
  return 'Elder';
}

/** `docs/architecture/3d-engine.md` §6.3: fry x0.45, juvenile x0.75, adult
 * x1.0, elder x1.0 (no separate elder scale defined yet). */
export function lifeStageScale(ageSec: number): number {
  switch (lifeStageOf(ageSec)) {
    case 'Fry':
      return 0.45;
    case 'Juvenile':
      return 0.75;
    default:
      return 1.0;
  }
}

/** SPEC.md §5: "Night = 21:00-07:00" *on whichever clock is active*: at
 * Real time (1×) that's the system clock's local hour; at any faster speed
 * the jar's own day/night cycle takes over (`clock.rs`'s `is_night`,
 * mirrored in the `else` branch below — jar-day fraction outside
 * `[7/24, 21/24)`) — `clock.rs`'s own doc comment notes this system-clock
 * substitution at 1× is exactly the presentation-layer decision it defers
 * to the frontend. `localHour` is injected (the caller's `new
 * Date().getHours()`) rather than read from `Date` internally, so this
 * stays a pure, deterministically-testable function. */
export function isNight(simSeconds: number, simulationSpeed: number, localHour: number): boolean {
  if (simulationSpeed === 1) {
    return localHour >= 21 || localHour < 7;
  }
  const fraction = (simSeconds / SECONDS_PER_JAR_DAY) % 1;
  return !(fraction >= 7 / 24 && fraction < 21 / 24);
}
