// Renders one `<Fish>` per living fish critter in the store. Mounting by
// React key (`critter.id`) is what actually satisfies "spawn/despawn as
// explicit events, not diffs" (`docs/architecture/rust-core.md` §6.2) at
// this layer — `jarClient.ts` already turned `Born`/`Passed` into the
// store updates that make a critter appear/disappear from this list, so
// this component just maps the current snapshot declaratively rather than
// re-deriving what changed.
//
// Gecko/terrarium rendering isn't implemented yet — see `NEXT_STEPS.md`.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useMemo } from 'react';

import { useJarStore } from '../../domain/jarClient';
import { Fish } from './Fish';

export function CrittersLayer() {
  const critters = useJarStore((s) => s.critters);

  const livingFish = useMemo(
    () => Object.values(critters).filter((c) => c.alive && c.species === 'Fish'),
    [critters],
  );

  return (
    <>
      {livingFish.map((critter) => (
        <Fish key={critter.id} critter={critter} livingPopulation={livingFish.length} />
      ))}
    </>
  );
}
