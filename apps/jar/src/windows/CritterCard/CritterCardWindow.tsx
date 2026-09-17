// W2 · Critter card (SCREENS.md). Spawns/retargets on a critter-selected
// event from the tank (or, once built, the family tree) — see
// `domain/selection.ts`. One card at a time: a new selection just updates
// `selectedId`, it doesn't open a second window.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useState } from 'react';

import { DialogShell } from '../../components/DialogShell';
import { StatBar } from '../../components/StatBar';
import { ensureJarClientStarted, jar, useJarStore } from '../../domain/jarClient';
import type { CritterId } from '../../domain/protocol/generated/CritterId';
import { onCritterSelected } from '../../domain/selection';
import { lifeStageOf, SECONDS_PER_JAR_DAY } from '../../domain/simConstants';

export function CritterCardWindow() {
  const [selectedId, setSelectedId] = useState<CritterId | null>(null);
  const critter = useJarStore((s) => (selectedId !== null ? s.critters[selectedId] : undefined));

  useEffect(() => {
    void ensureJarClientStarted();
    const unlistenPromise = onCritterSelected(setSelectedId);
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  if (!critter) {
    return <DialogShell>No critter selected yet.</DialogShell>;
  }

  if (!critter.alive) {
    return (
      <DialogShell title={critter.name}>
        <p style={{ fontStyle: 'italic' }}>Remembered fondly — this one has passed on.</p>
      </DialogShell>
    );
  }

  const stage = lifeStageOf(critter.age_sec);
  const ageDays = (critter.age_sec / SECONDS_PER_JAR_DAY).toFixed(1);

  return (
    <DialogShell
      title={
        <input
          key={critter.id}
          defaultValue={critter.name}
          onBlur={(e) => void jar.renameCritter(critter.id, e.target.value)}
          style={{
            border: 'none',
            borderBottom: '1px dashed var(--jar-ink, #999)',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            width: '100%',
          }}
        />
      }
    >
      <p>
        {critter.species} · {stage} · {ageDays} days old
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0' }}>
        <StatBar label="Mood" value={critter.mood} colorByValue />
        <StatBar label="Energy" value={critter.energy} />
      </div>
      <p style={{ fontStyle: 'italic' }}>
        {critter.mood > 60
          ? 'Doing well.'
          : critter.mood > 35
            ? 'Getting by.'
            : 'Having a rough day.'}
      </p>

      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px', margin: 0 }}>
        <dt>Trait</dt>
        <dd>{critter.personality}</dd>
        <dt>Genetics</dt>
        <dd>
          hue {critter.hue}° · {critter.sex}
          {critter.fin ? ` · ${critter.fin}` : ''} · {critter.spots ? 'spotted' : 'plain'}
        </dd>
        <dt>Favourite spot</dt>
        <dd>
          x{critter.favourite_spot.x.toFixed(0)} y{critter.favourite_spot.y.toFixed(0)} z
          {critter.favourite_spot.z.toFixed(0)}
        </dd>
        <dt>Lineage</dt>
        <dd>
          Gen {critter.gen}
          {critter.parents
            ? ` · child of #${critter.parents[0]} & #${critter.parents[1]}`
            : ' · original resident'}
        </dd>
      </dl>
    </DialogShell>
  );
}
