// W3 · Family tree (SCREENS.md). One row per generation; passed critters
// shown muted with `† remembered`. Title shows "N ever" — a count over the
// full population including the passed, per SCREENS.md.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useMemo } from 'react';

import { DialogShell } from '../../components/DialogShell';
import { ensureJarClientStarted, useJarStore } from '../../domain/jarClient';
import type { Critter } from '../../domain/protocol/generated/Critter';
import { selectCritter } from '../../domain/selection';
import { lifeStageOf } from '../../domain/simConstants';

export function FamilyTreeWindow() {
  const critters = useJarStore((s) => s.critters);

  useEffect(() => {
    void ensureJarClientStarted();
  }, []);

  const byGeneration = useMemo(() => {
    const groups = new Map<number, Critter[]>();
    for (const critter of Object.values(critters)) {
      const list = groups.get(critter.gen) ?? [];
      list.push(critter);
      groups.set(critter.gen, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a - b);
  }, [critters]);

  const totalEver = Object.keys(critters).length;

  return (
    <DialogShell title={`${totalEver} ever`}>
      {byGeneration.map(([gen, members]) => (
        <div key={gen} style={{ marginBottom: 12 }}>
          <h3 style={{ margin: '4px 0' }}>Gen {gen}</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {members.map((critter) => (
              <button
                key={critter.id}
                onClick={() => void selectCritter(critter.id)}
                style={{
                  opacity: critter.alive ? 1 : 0.5,
                  padding: '4px 8px',
                  borderRadius: 8,
                  border: '1px solid var(--jar-accent, #ccc)',
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                }}
              >
                {critter.name}
                {!critter.alive && ' † remembered'}
                <br />
                <small>{lifeStageOf(critter.age_sec)}</small>
              </button>
            ))}
          </div>
        </div>
      ))}
    </DialogShell>
  );
}
