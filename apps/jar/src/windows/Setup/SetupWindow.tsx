// W4 · Setup (SCREENS.md). Shows every option at once: mode, frame, dialog
// theme + variant, tank toggles, simulation speed, jar clock, add a
// critter. Variant selection (the row that changes per theme, SPEC.md §4)
// isn't wired up yet — `jar.setTheme` always sends the theme's default
// variant name for now; see `NEXT_STEPS.md`.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect } from 'react';

import { DialogShell } from '../../components/DialogShell';
import { ensureJarClientStarted, jar, useJarStore } from '../../domain/jarClient';
import type { DialogTheme } from '../../domain/protocol/generated/DialogTheme';
import type { Species } from '../../domain/protocol/generated/Species';
import type { TankFrame } from '../../domain/protocol/generated/TankFrame';

const FRAMES: TankFrame[] = [
  'Bevelled98',
  'WoodStand',
  'BrushedMetal',
  'RoundedGlass',
  'NeonCrt',
  'CardboardCutout',
];

const THEMES: DialogTheme[] = [
  'Modern',
  'ModernDark',
  'Classic98',
  'PaperNotebook',
  'HandheldLcd',
  'NeonTerminal',
];

export function SetupWindow() {
  const settings = useJarStore((s) => s.settings);
  const simSeconds = useJarStore((s) => s.simSeconds);

  useEffect(() => {
    void ensureJarClientStarted();
  }, []);

  const jarDay = (simSeconds / 120).toFixed(2);

  return (
    <DialogShell title="Setup">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>
          Mode
          <select
            value={settings.mode}
            onChange={(e) => void jar.setMode(e.target.value as Species)}
          >
            <option value="Fish">Aquarium — fish</option>
            <option value="Gecko">Terrarium — gecko</option>
          </select>
        </label>

        <label>
          Frame
          <select
            value={settings.frame}
            onChange={(e) => void jar.setFrame(e.target.value as TankFrame)}
          >
            {FRAMES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>

        <label>
          Dialog theme
          <select
            value={settings.dialog_theme}
            onChange={(e) =>
              void jar.setTheme(e.target.value as DialogTheme, settings.theme_variant)
            }
          >
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label>
          <input
            type="checkbox"
            checked={settings.light_on}
            onChange={(e) => void jar.setToggle('light', e.target.checked)}
          />{' '}
          Light
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.ambient_particles_on}
            onChange={(e) => void jar.setToggle('ambientParticles', e.target.checked)}
          />{' '}
          {settings.mode === 'Fish' ? 'Bubbles' : 'Mist'}
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.sound_on}
            onChange={(e) => void jar.setToggle('sound', e.target.checked)}
          />{' '}
          Critter sounds
        </label>

        <label>
          Simulation speed: {settings.simulation_speed}x
          {settings.simulation_speed === 1 && ' (Real time)'}
          <input
            type="range"
            min={1}
            max={60}
            value={settings.simulation_speed}
            onChange={(e) => void jar.setSpeed(Number(e.target.value))}
          />
        </label>
        <p>Jar clock: day {jarDay}</p>

        <button onClick={() => void jar.addCritter(settings.mode)}>+ Add a critter</button>
      </div>
    </DialogShell>
  );
}
