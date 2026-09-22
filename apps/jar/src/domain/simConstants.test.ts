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
  // `localHour` is irrelevant on this branch — any value works, since
  // `simulationSpeed !== 1` selects the jar-day-cycle path.
  const ARBITRARY_HOUR = 12;

  describe('at any speed above 1x, the jar day/night cycle', () => {
    // Boundary values mirrored exactly from `clock.rs`'s own
    // `is_night_at_the_day_start_boundary` / `is_night_at_the_night_start_boundary`
    // / `is_night_wraps_across_midnight` tests.
    it('is night just before the day-start boundary (7:00, 35/120 of a jar-day)', () => {
      expect(isNight(34, 2, ARBITRARY_HOUR)).toBe(true);
    });

    it('becomes day at exactly the day-start boundary', () => {
      expect(isNight(35, 2, ARBITRARY_HOUR)).toBe(false);
    });

    it('is day just before the night-start boundary (21:00, 105/120 of a jar-day)', () => {
      expect(isNight(104, 2, ARBITRARY_HOUR)).toBe(false);
    });

    it('becomes night at exactly the night-start boundary', () => {
      expect(isNight(105, 2, ARBITRARY_HOUR)).toBe(true);
    });

    it('wraps correctly across midnight (jar-day boundary at multiples of 120)', () => {
      expect(isNight(0, 2, ARBITRARY_HOUR)).toBe(true);
      expect(isNight(120, 2, ARBITRARY_HOUR)).toBe(true); // one full jar-day later
    });

    it('uses the jar-day cycle at every accelerated speed, not just 2x', () => {
      expect(isNight(34, 60, ARBITRARY_HOUR)).toBe(true);
      expect(isNight(35, 60, ARBITRARY_HOUR)).toBe(false);
    });
  });

  describe("at Real time (1x), the system clock's local hour", () => {
    // `simSeconds` is irrelevant on this branch.
    const ARBITRARY_SIM_SECONDS = 60;

    it('is night at 21:00 local and after', () => {
      expect(isNight(ARBITRARY_SIM_SECONDS, 1, 21)).toBe(true);
      expect(isNight(ARBITRARY_SIM_SECONDS, 1, 23)).toBe(true);
    });

    it('is night before 07:00 local', () => {
      expect(isNight(ARBITRARY_SIM_SECONDS, 1, 0)).toBe(true);
      expect(isNight(ARBITRARY_SIM_SECONDS, 1, 6)).toBe(true);
    });

    it('is day from 07:00 local up to (not including) 21:00', () => {
      expect(isNight(ARBITRARY_SIM_SECONDS, 1, 7)).toBe(false);
      expect(isNight(ARBITRARY_SIM_SECONDS, 1, 20)).toBe(false);
    });
  });
});
