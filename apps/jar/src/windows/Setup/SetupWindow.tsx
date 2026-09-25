// W4 · Setup (SCREENS.md). Shows every option at once: mode, frame, dialog
// theme + variant, tank toggles, simulation speed, jar clock, add a
// critter, restore default settings, reset jar.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useRef, useState } from 'react';

import { DialogShell } from '../../components/DialogShell';
import { setDayNightOverride } from '../../domain/devSettings';
import { defaultSpeciesFor } from '../../domain/habitat';
import { ensureJarClientStarted, jar, useJarStore } from '../../domain/jarClient';
import type { DialogTheme } from '../../domain/protocol/generated/DialogTheme';
import type { Habitat } from '../../domain/protocol/generated/Habitat';
import type { LightColour } from '../../domain/protocol/generated/LightColour';
import type { TankFrame } from '../../domain/protocol/generated/TankFrame';
import { defaultVariantOf, variantNamesFor } from '../../theme/theme';

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

const LIGHT_COLOURS: LightColour[] = [
  'Daylight',
  'Warm',
  'Moonlight',
  'Reef',
  'Jungle',
  'Sunset',
  'Party',
];

/** Swatch dot per option — a standalone copy of the hues
 * `LedLightStrip.tsx` actually renders with, not an import from it: this
 * window has no reason to pull in the R3F/three.js render stack just to
 * borrow a handful of hex strings, the same "presentation tokens live on
 * each side separately" precedent `theme.ts`'s dialog-theme swatches
 * already set. `Party` gets a gradient instead of one hex, hinting at its
 * own colour-cycling rather than implying a fixed hue. */
/** How long the "Reset jar" button stays armed after one click before it
 * silently disarms — long enough to read the warning and click again, short
 * enough that walking away doesn't leave it primed indefinitely. */
const RESET_JAR_ARM_TIMEOUT_MS = 4000;

const LIGHT_COLOUR_SWATCHES: Record<LightColour, string> = {
  Daylight: '#eaf6ff',
  Warm: '#ffd8a3',
  Moonlight: '#6f8fef',
  Reef: '#b46dff',
  Jungle: '#7be08f',
  Sunset: '#ff8c52',
  Party: 'linear-gradient(135deg, #ff5e5e, #ffe45e, #5eff8f, #5ecbff, #b45eff)',
};

export function SetupWindow() {
  const settings = useJarStore((s) => s.settings);
  const simSeconds = useJarStore((s) => s.simSeconds);

  useEffect(() => {
    void ensureJarClientStarted();
  }, []);

  const jarDay = (simSeconds / 120).toFixed(2);

  // "Reset jar" is a permanent, irreversible wipe of every critter — this
  // window has no confirm-dialog precedent to reuse (nothing else here
  // gates on one), so a two-click "armed" state stands in for one: the
  // first click only names what's about to be lost, the second actually
  // does it. Auto-disarms after `RESET_JAR_ARM_TIMEOUT_MS` so walking away
  // mid-decision can't leave it primed for an accidental second click much
  // later.
  const [resetJarArmed, setResetJarArmed] = useState(false);
  // Read once when arming, not subscribed reactively — `critters` gets a
  // new object reference on every `TickUpdate` (which keeps arriving even
  // while this window is open, per CLAUDE.md's "the sim tick keeps running
  // regardless of window visibility"), so a reactive subscription here
  // would re-render this whole window every tick just to keep a count that
  // only ever matters while the button is armed.
  const [resetJarCritterCount, setResetJarCritterCount] = useState(0);
  const resetJarTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetJarTimerRef.current !== null) window.clearTimeout(resetJarTimerRef.current);
    };
  }, []);

  function armResetJar() {
    // reset_jar wipes living and passed critters alike (SCREENS.md) — count
    // every record, not just the living ones, so this warning doesn't
    // undercount what's actually about to be lost.
    setResetJarCritterCount(Object.keys(useJarStore.getState().critters).length);
    setResetJarArmed(true);
    resetJarTimerRef.current = window.setTimeout(() => {
      setResetJarArmed(false);
    }, RESET_JAR_ARM_TIMEOUT_MS);
  }

  function handleResetJarClick() {
    if (!resetJarArmed) {
      armResetJar();
      return;
    }
    if (resetJarTimerRef.current !== null) window.clearTimeout(resetJarTimerRef.current);
    setResetJarArmed(false);
    void jar.resetJar();
  }

  return (
    <DialogShell windowTitle="Setup" title="Setup">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>
          Mode
          <select
            value={settings.habitat}
            onChange={(e) => void jar.setHabitat(e.target.value as Habitat)}
          >
            <option value="Aquarium">Aquarium — fish</option>
            <option value="Terrarium">Terrarium — gecko</option>
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
            onChange={(e) => {
              const nextTheme = e.target.value as DialogTheme;
              // Switching theme never changes its remembered variant
              // (SPEC.md §4/§6) — pass through whatever's already stored
              // for it, falling back to that theme's documented default.
              const nextVariant = settings.theme_variants[nextTheme] ?? defaultVariantOf(nextTheme);
              void jar.setTheme(nextTheme, nextVariant);
            }}
          >
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {variantNamesFor(settings.dialog_theme).map((variant) => {
            const active = settings.theme_variants[settings.dialog_theme] === variant;
            return (
              <button
                key={variant}
                onClick={() => void jar.setTheme(settings.dialog_theme, variant)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 999,
                  border: active ? '2px solid var(--jar-accent)' : '1px solid var(--jar-ink)',
                  background: active ? 'var(--jar-accent)' : 'transparent',
                  color: active ? 'var(--jar-bg)' : 'inherit',
                  cursor: 'pointer',
                }}
              >
                {variant}
              </button>
            );
          })}
        </div>

        <label>
          <input
            type="checkbox"
            checked={settings.light_on}
            onChange={(e) => void jar.setToggle('light', e.target.checked)}
          />{' '}
          Light
        </label>
        {settings.light_on && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {LIGHT_COLOURS.map((colour) => {
              const active = settings.light_colour === colour;
              return (
                <button
                  key={colour}
                  onClick={() => void jar.setLightColour(colour)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    borderRadius: 999,
                    border: active ? '2px solid var(--jar-accent)' : '1px solid var(--jar-ink)',
                    background: active ? 'var(--jar-accent)' : 'transparent',
                    color: active ? 'var(--jar-bg)' : 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: LIGHT_COLOUR_SWATCHES[colour],
                      border: '1px solid rgba(0, 0, 0, 0.2)',
                    }}
                  />
                  {colour}
                </button>
              );
            })}
          </div>
        )}
        <label>
          Castle light: {settings.light_intensity}%
          {/* Deliberately not gated on settings.light_on — the castle's own
              ground-level uplight fixture (Castle.tsx's GroundUplight) is
              always on, independent of the tank-wide LED strip toggle
              above. */}
          <input
            type="range"
            min={0}
            max={200}
            value={settings.light_intensity}
            onChange={(e) => void jar.setLightIntensity(Number(e.target.value))}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.ambient_particles_on}
            onChange={(e) => void jar.setToggle('ambientParticles', e.target.checked)}
          />{' '}
          {settings.habitat === 'Aquarium' ? 'Bubbles' : 'Mist'}
        </label>
        {/* Aquarium-only — terrarium's "Mist" doesn't exist yet, so this
            slider (Bubbles.tsx's own particle count) has nothing to affect
            in Terrarium habitat. */}
        {settings.ambient_particles_on && settings.habitat === 'Aquarium' && (
          <label>
            Bubble intensity: {settings.bubble_intensity}%
            <input
              type="range"
              min={0}
              max={200}
              value={settings.bubble_intensity}
              onChange={(e) => void jar.setBubbleIntensity(Number(e.target.value))}
            />
          </label>
        )}
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

        <button onClick={() => void jar.addCritter(defaultSpeciesFor(settings.habitat))}>
          + Add a critter
        </button>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            marginTop: 8,
            paddingTop: 12,
            borderTop: '1px solid var(--jar-ink)',
          }}
        >
          <button
            onClick={() => {
              void jar.resetSettings();
              // `JarSettings` itself resets via the command above, but the
              // Day/night override is a frontend-only `localStorage` pref
              // (`domain/devSettings.ts`) that command never touches — reset
              // it here so "restore defaults" is honest about every setting
              // it claims to restore, not just the backend-owned ones.
              setDayNightOverride('active');
            }}
          >
            Restore default settings
          </button>
          <button onClick={handleResetJarClick}>
            {resetJarArmed
              ? `Really reset? All ${resetJarCritterCount} critters will be lost`
              : 'Reset jar'}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
