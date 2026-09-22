// Life-stage boundary cases from SPEC.md §5, mirrored in
// `crates/jar-core/src/tick.rs`'s equivalent Rust test — together the two
// are the sync-enforcement mechanism for this file's hand-duplicated
// constants (see this file's header comment).
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { isNight, lifeStageOf, lifeStageScale, SECONDS_PER_JAR_DAY } from './simConstants';

describe('lifeStageOf', () => {
  it('is Fry from birth up to (not including) 2 jar-days', () => {
    expect(lifeStageOf(0)).toBe('Fry');
    expect(lifeStageOf(239)).toBe('Fry');
  });

  it('becomes Juvenile at exactly 2 jar-days', () => {
    expect(lifeStageOf(240)).toBe('Juvenile');
    expect(lifeStageOf(599)).toBe('Juvenile');
  });

  it('becomes Adult at exactly 5 jar-days', () => {
    expect(lifeStageOf(600)).toBe('Adult');
    expect(lifeStageOf(2639)).toBe('Adult');
  });

  it('becomes Elder at exactly 22 jar-days', () => {
    expect(lifeStageOf(2640)).toBe('Elder');
    expect(lifeStageOf(100_000)).toBe('Elder');
  });

  it('agrees with SPEC.md §5 on the jar-day length', () => {
    expect(SECONDS_PER_JAR_DAY).toBe(120);
  });
});

describe('lifeStageScale', () => {
  it('scales fry to 0.45 and juveniles to 0.75, per 3d-engine.md §6.3', () => {
    expect(lifeStageScale(0)).toBe(0.45);
    expect(lifeStageScale(240)).toBe(0.75);
  });

  it('leaves adults and elders at full scale', () => {
    expect(lifeStageScale(600)).toBe(1.0);
    expect(lifeStageScale(2640)).toBe(1.0);
  });
});

describe('isNight', () => {
  // Boundary values mirrored exactly from `clock.rs`'s own
  // `is_night_at_the_day_start_boundary` / `is_night_at_the_night_start_boundary`
  // / `is_night_wraps_across_midnight` tests.
  it('is night just before the day-start boundary (7:00, 35/120 of a jar-day)', () => {
    expect(isNight(34)).toBe(true);
  });

  it('becomes day at exactly the day-start boundary', () => {
    expect(isNight(35)).toBe(false);
  });

  it('is day just before the night-start boundary (21:00, 105/120 of a jar-day)', () => {
    expect(isNight(104)).toBe(false);
  });

  it('becomes night at exactly the night-start boundary', () => {
    expect(isNight(105)).toBe(true);
  });

  it('wraps correctly across midnight (jar-day boundary at multiples of 120)', () => {
    expect(isNight(0)).toBe(true);
    expect(isNight(120)).toBe(true); // one full jar-day later
  });
});
