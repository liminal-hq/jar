// Renders one `<Fish>`/`<Snail>` per living critter of that species in the
// store. Mounting by React key (`critter.id`) is what actually satisfies
// "spawn/despawn as explicit events, not diffs"
// (`docs/architecture/rust-core.md` §6.2) at this layer — `jarClient.ts`
// already turned `Born`/`Passed` into the store updates that make a critter
// appear/disappear from this list, so this component just maps the current
// snapshot declaratively rather than re-deriving what changed.
//
// Gecko/terrarium rendering isn't implemented yet — see `NEXT_STEPS.md`.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useMemo } from 'react';

import { useJarStore } from '../../domain/jarClient';
import { Fish } from './Fish';
import { Snail } from './Snail';

export function CrittersLayer() {
  const critters = useJarStore((s) => s.critters);

  const livingFish = useMemo(
    () => Object.values(critters).filter((c) => c.alive && c.species === 'Fish'),
    [critters],
  );
  const livingSnails = useMemo(
    () => Object.values(critters).filter((c) => c.alive && c.species === 'Snail'),
    [critters],
  );

  return (
    <>
      {livingFish.map((critter) => (
        <Fish key={critter.id} critter={critter} livingPopulation={livingFish.length} />
      ))}
      {livingSnails.map((critter) => (
        <Snail key={critter.id} critter={critter} />
      ))}
    </>
  );
}
