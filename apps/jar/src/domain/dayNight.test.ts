// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import type { DayNightOverride } from './devSettings';
import { isAsleep, isNightPresentation, nocturnal } from './dayNight';
import type { Species } from './protocol/generated/Species';

describe('nocturnal', () => {
  it('is true only for the snail', () => {
    expect(nocturnal('Fish')).toBe(false);
    expect(nocturnal('Gecko')).toBe(false);
    expect(nocturnal('Snail')).toBe(true);
  });
});

describe('isNightPresentation', () => {
  it('follows the sim clock under auto and active', () => {
    expect(isNightPresentation('auto', true)).toBe(true);
    expect(isNightPresentation('auto', false)).toBe(false);
    expect(isNightPresentation('active', true)).toBe(true);
    expect(isNightPresentation('active', false)).toBe(false);
  });

  it('pins day/night regardless of the sim clock', () => {
    expect(isNightPresentation('day', true)).toBe(false);
    expect(isNightPresentation('day', false)).toBe(false);
    expect(isNightPresentation('night', true)).toBe(true);
    expect(isNightPresentation('night', false)).toBe(true);
  });
});

describe('isAsleep', () => {
  const SPECIES: Species[] = ['Fish', 'Gecko', 'Snail'];
  const OVERRIDES: Exclude<DayNightOverride, 'active'>[] = ['auto', 'day', 'night'];

  it('is never asleep under active, for any species or clock state', () => {
    for (const species of SPECIES) {
      expect(isAsleep(species, 'active', true)).toBe(false);
      expect(isAsleep(species, 'active', false)).toBe(false);
    }
  });

  it('diurnal species (fish, gecko) sleep exactly at night', () => {
    for (const species of ['Fish', 'Gecko'] as const) {
      for (const override of OVERRIDES) {
        const night = isNightPresentation(override, true);
        expect(isAsleep(species, override, true)).toBe(night);
      }
    }
  });

  it('the nocturnal snail sleeps exactly by day', () => {
    for (const override of OVERRIDES) {
      const night = isNightPresentation(override, true);
      expect(isAsleep('Snail', override, true)).toBe(!night);
    }
  });

  it('auto follows the real sim clock for every species', () => {
    expect(isAsleep('Fish', 'auto', true)).toBe(true);
    expect(isAsleep('Fish', 'auto', false)).toBe(false);
    expect(isAsleep('Snail', 'auto', true)).toBe(false);
    expect(isAsleep('Snail', 'auto', false)).toBe(true);
  });

  it('day/night pins override the sim clock entirely', () => {
    expect(isAsleep('Fish', 'day', true)).toBe(false);
    expect(isAsleep('Fish', 'night', false)).toBe(true);
    expect(isAsleep('Snail', 'day', false)).toBe(true);
    expect(isAsleep('Snail', 'night', true)).toBe(false);
  });
});
