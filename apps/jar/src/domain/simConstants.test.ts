// `lifeStageScale`'s render-scale mapping — the underlying life-stage
// *classification* (age thresholds) is tested in `crates/jar-core/src/
// tick.rs`'s `life_stage_boundaries_match_spec`, not here; this file no
// longer has a copy of that logic to test.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { lifeStageScale, SECONDS_PER_JAR_DAY } from './simConstants';

describe('SECONDS_PER_JAR_DAY', () => {
  it('agrees with SPEC.md §5 on the jar-day length', () => {
    expect(SECONDS_PER_JAR_DAY).toBe(120);
  });
});

describe('lifeStageScale', () => {
  it('scales fry to 0.45 and juveniles to 0.75, per 3d-engine.md §6.3', () => {
    expect(lifeStageScale('Fry')).toBe(0.45);
    expect(lifeStageScale('Juvenile')).toBe(0.75);
  });

  it('leaves adults and elders at full scale', () => {
    expect(lifeStageScale('Adult')).toBe(1.0);
    expect(lifeStageScale('Elder')).toBe(1.0);
  });
});
