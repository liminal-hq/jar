// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { defaultSpeciesFor, speciesOfHabitat } from './habitat';

describe('defaultSpeciesFor', () => {
  it('is Fish for the aquarium', () => {
    expect(defaultSpeciesFor('Aquarium')).toBe('Fish');
  });

  it('is Gecko for the terrarium', () => {
    expect(defaultSpeciesFor('Terrarium')).toBe('Gecko');
  });
});

describe('speciesOfHabitat', () => {
  it('lists Fish for the aquarium', () => {
    expect(speciesOfHabitat('Aquarium')).toEqual(['Fish']);
  });

  it('lists Gecko for the terrarium', () => {
    expect(speciesOfHabitat('Terrarium')).toEqual(['Gecko']);
  });
});
