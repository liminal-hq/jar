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

/** SPEC.md §5: "Night = 21:00-07:00". Mirrors `clock.rs`'s `is_night`
 * exactly (jar-day fraction outside `[7/24, 21/24)`) — the jar clock's own
 * notion of night, not the system clock (`clock.rs`'s own doc comment
 * notes that substitution, if ever made, is a presentation-layer decision
 * this function doesn't make). */
export function isNight(simSeconds: number): boolean {
  const fraction = (simSeconds / SECONDS_PER_JAR_DAY) % 1;
  return !(fraction >= 7 / 24 && fraction < 21 / 24);
}
