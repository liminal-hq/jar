// W2 · Critter card (SCREENS.md). Spawns/retargets on a critter-selected
// event from the tank (or, once built, the family tree) — see
// `domain/selection.ts`. One card at a time: a new selection just updates
// `selectedId`, it doesn't open a second window.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useState } from 'react';

import { DialogShell } from '../../components/DialogShell';
import { StatBar } from '../../components/StatBar';
import { ensureJarClientStarted, jar, onCritterEvent, useJarStore } from '../../domain/jarClient';
import type { CritterId } from '../../domain/protocol/generated/CritterId';
import { onCritterSelected } from '../../domain/selection';
import { SECONDS_PER_JAR_DAY } from '../../domain/simConstants';
import { CritterPreview } from './CritterPreview';

/** Reads the `critterId` this window was created with (`domain/selection.ts`'s
 * `openSatelliteWindow` call) — the window's very first selection, which
 * can't rely on the `jar://critter-selected` event: that's emitted right
 * after the window is created, with no guarantee this component has
 * mounted and subscribed yet, so a fresh window's first selection would
 * otherwise be silently dropped. */
function initialCritterIdFromUrl(): CritterId | null {
  const raw = new URLSearchParams(window.location.search).get('critterId');
  if (raw === null) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

export function CritterCardWindow() {
  const [selectedId, setSelectedId] = useState<CritterId | null>(initialCritterIdFromUrl);
  const critter = useJarStore((s) => (selectedId !== null ? s.critters[selectedId] : undefined));

  useEffect(() => {
    void ensureJarClientStarted();
    const unlistenPromise = onCritterSelected(setSelectedId);
    // A jar reset assigns fresh ids starting from 0 again — without this,
    // a still-open card bound to (say) id 0 would silently start showing
    // whatever unrelated critter later reclaims that id, instead of
    // falling back to "No critter selected yet."
    const unlistenReset = onCritterEvent((event) => {
      if (event.kind === 'reset') setSelectedId(null);
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
      unlistenReset();
    };
  }, []);

  if (!critter) {
    return <DialogShell windowTitle="Critter card">No critter selected yet.</DialogShell>;
  }

  // Gecko/terrarium rendering isn't built yet (NEXT_STEPS.md) — `CritterPreview`
  // only knows how to render fish and snails.
  const hasPreview = critter.species === 'Fish' || critter.species === 'Snail';

  if (!critter.alive) {
    return (
      <DialogShell windowTitle="Critter card" title={critter.name}>
        {hasPreview && <CritterPreview critter={critter} passed />}
        <p style={{ fontStyle: 'italic' }}>Remembered fondly — this one has passed on.</p>
      </DialogShell>
    );
  }

  const stage = critter.life_stage;
  const ageDays = (critter.age_sec / SECONDS_PER_JAR_DAY).toFixed(1);

  return (
    <DialogShell
      windowTitle="Critter card"
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
      {hasPreview && <CritterPreview critter={critter} />}

      <p>
        {critter.species} · {stage} · {ageDays} days old
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0' }}>
        <StatBar label="Mood" value={critter.mood} colourByValue />
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
          {critter.fin ? ` · ${critter.fin}` : ''}
          {critter.shell ? ` · ${critter.shell}` : ''}
          {` · ${critter.pattern.toLowerCase()}`}
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
