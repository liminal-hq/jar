// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { critterStatusText } from './critterStatus';
import type { Critter } from './protocol/generated/Critter';

function critter(species: Critter['species'], alive = true): Critter {
  return {
    id: Math.random(),
    species,
    name: 'Test',
    hue: 0,
    fin: null,
    spots: false,
    shell: null,
    pattern: null,
    sex: 'Male',
    personality: 'Bold',
    mood: 50,
    energy: 50,
    age_sec: 0,
    life_stage: 'Adult',
    life: 1000,
    gen: 1,
    parents: null,
    alive,
    born: 0,
    died: null,
    favourite_spot: { x: 0, y: 0, z: 0 },
  };
}

describe('critterStatusText', () => {
  it('shows only fish when there are no snails yet', () => {
    const critters = [critter('Fish'), critter('Fish'), critter('Fish'), critter('Fish')];
    expect(critterStatusText(critters, 'Aquarium')).toBe('4 fish');
  });

  it('joins fish and snail counts with the menu separator', () => {
    const critters = [critter('Fish'), critter('Fish'), critter('Snail'), critter('Snail')];
    expect(critterStatusText(critters, 'Aquarium')).toBe('2 fish · 2 snails');
  });

  it('singularizes a lone snail, keeps fish unchanged either way', () => {
    const critters = [critter('Fish'), critter('Snail')];
    expect(critterStatusText(critters, 'Aquarium')).toBe('1 fish · 1 snail');
  });

  it('ignores passed (non-alive) critters', () => {
    const critters = [critter('Fish'), critter('Fish', false), critter('Snail', false)];
    expect(critterStatusText(critters, 'Aquarium')).toBe('1 fish');
  });

  it('falls back to showing the first species at zero when everything is at zero', () => {
    expect(critterStatusText([], 'Aquarium')).toBe('0 fish');
  });

  it('shows a singular/plural gecko count in the terrarium', () => {
    expect(critterStatusText([critter('Gecko')], 'Terrarium')).toBe('1 gecko');
    expect(critterStatusText([critter('Gecko'), critter('Gecko')], 'Terrarium')).toBe('2 geckos');
  });

  it('never shows a snail clause in the terrarium', () => {
    expect(critterStatusText([critter('Gecko')], 'Terrarium')).toBe('1 gecko');
  });
});
