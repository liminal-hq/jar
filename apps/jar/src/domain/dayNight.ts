// The one place species-relative day/night semantics live — every species
// but the snail is awake by day and asleep by night; the snail (issue #98)
// inverts that. Consumed by `Fish.tsx` and, once it exists, the snail
// controller (`render/tank/Snail.tsx`), so the two can never quietly drift
// out of sync on what "asleep" means for a given species/override/clock
// combination.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { DayNightOverride } from './devSettings';
import type { Species } from './protocol/generated/Species';

/** Whether a species sleeps by day and wakes by night — today, only the
 * snail. Exhaustive over `Species` so a future species can't silently fall
 * through to the wrong default. */
export function nocturnal(species: Species): boolean {
  switch (species) {
    case 'Snail':
      return true;
    case 'Fish':
    case 'Gecko':
      return false;
  }
}

/** This tick's real jar-clock night state, as seen through a dev/menu
 * override — `'auto'` follows the actual clock, `'day'`/`'night'` pin it,
 * and `'active'` has no real "is it night" answer (nothing should be asleep
 * under it), so callers that need presentation state should generally
 * prefer `isAsleep` over this directly. */
export function isNightPresentation(override: DayNightOverride, simNight: boolean): boolean {
  switch (override) {
    case 'auto':
      return simNight;
    case 'day':
      return false;
    case 'night':
      return true;
    case 'active':
      return simNight;
  }
}

/** Whether a critter of this species should be presented as asleep right
 * now. `'active'` always answers `false`, regardless of species or clock —
 * every critter stays out. Otherwise a species sleeps exactly when its own
 * nocturnality and the (possibly overridden) night state disagree: a
 * diurnal species sleeps at night, a nocturnal one sleeps by day. */
export function isAsleep(species: Species, override: DayNightOverride, simNight: boolean): boolean {
  if (override === 'active') return false;
  const night = isNightPresentation(override, simNight);
  return nocturnal(species) !== night;
}
