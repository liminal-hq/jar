// The tank window's status chip text (SCREENS.md W1: "bottom-left: `4 fish
// · 22:14 · asleep`") — a pure function of the living population and
// habitat, kept free of the store/React so it's directly testable.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { speciesOfHabitat } from './habitat';
import type { Critter } from './protocol/generated/Critter';
import type { Habitat } from './protocol/generated/Habitat';
import type { Species } from './protocol/generated/Species';

function speciesNoun(species: Species, count: number): string {
  switch (species) {
    case 'Fish':
      // "fish" is already its own plural — never "fishes" here.
      return 'fish';
    case 'Gecko':
      return count === 1 ? 'gecko' : 'geckos';
    case 'Snail':
      return count === 1 ? 'snail' : 'snails';
  }
}

/** `"4 fish · 2 snails"` style — one clause per species that actually has a
 * living member, joined with the tank menu's own `·` separator convention.
 * A species with zero living members is omitted entirely rather than shown
 * as `"0 snails"`, except when every species in the habitat is at zero (a
 * freshly reset jar), where the first is kept so the chip is never blank. */
export function critterStatusText(critters: Critter[], habitat: Habitat): string {
  const counts = speciesOfHabitat(habitat).map((species) => ({
    species,
    count: critters.filter((c) => c.alive && c.species === species).length,
  }));
  const nonZero = counts.filter((c) => c.count > 0);
  const shown = nonZero.length > 0 ? nonZero : counts.slice(0, 1);
  return shown.map(({ species, count }) => `${count} ${speciesNoun(species, count)}`).join(' · ');
}
