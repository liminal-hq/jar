// The one place the tank's habitat maps to the species living in it — a
// mapping that used to be a 1:1 assumption baked into `JarSettings.mode`
// itself (issue #98: a snail in the aquarium breaks that, since the
// aquarium now holds more than one species).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { Habitat } from './protocol/generated/Habitat';
import type { Species } from './protocol/generated/Species';

/** The species an "Add a critter" action should create when the caller
 * doesn't ask for a specific one (e.g. a flat, non-flyout Setup button in a
 * habitat with only one species). */
export function defaultSpeciesFor(habitat: Habitat): Species {
  switch (habitat) {
    case 'Aquarium':
      return 'Fish';
    case 'Terrarium':
      return 'Gecko';
  }
}

/** Every species that can currently live in a given habitat, for anything
 * that needs to enumerate them (the status chip's per-species counts, a
 * future Add-a-critter flyout). */
export function speciesOfHabitat(habitat: Habitat): Species[] {
  switch (habitat) {
    case 'Aquarium':
      return ['Fish', 'Snail'];
    case 'Terrarium':
      return ['Gecko'];
  }
}
