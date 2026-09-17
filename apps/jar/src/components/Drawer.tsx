// The tank window's drawer (SCREENS.md W1): "Light · Bubbles (aquarium) /
// Mist (terrarium) · Sound · Gecko/Fish (mode switch) · Tree · Setup ·
// Exit (saves the jar, quits the app — essential on GNOME where there is
// no tray)." Styling per theme is not wired up yet — see `theme/theme.ts`
// and `windows/Tank/TankWindow.module.css`.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { getCurrentWindow } from '@tauri-apps/api/window';

import { jar, useJarStore } from '../domain/jarClient';
import { openSatelliteWindow } from '../domain/windows';

export function Drawer() {
  const settings = useJarStore((s) => s.settings);

  const toggleMode = () => jar.setMode(settings.mode === 'Fish' ? 'Gecko' : 'Fish');
  const toggleLight = () => jar.setToggle('light', !settings.light_on);
  const toggleAmbient = () => jar.setToggle('ambientParticles', !settings.ambient_particles_on);
  const toggleSound = () => jar.setToggle('sound', !settings.sound_on);

  const exit = async () => {
    // The shutdown autosave flush (rust-core.md §5.3) fires from the
    // plugin's own `ExitRequested` hook regardless of how the process
    // exits, so this just needs to close the window.
    await getCurrentWindow().close();
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: 'var(--jar-bg, #fbfaf6)',
        color: 'var(--jar-ink, #2b2a33)',
        borderRadius: 'var(--jar-radius, 12px)',
        boxShadow: 'var(--jar-shadow, 0 4px 12px rgba(0,0,0,0.2))',
        padding: 6,
      }}
    >
      <button onClick={toggleLight}>{settings.light_on ? 'Light: on' : 'Light: off'}</button>
      <button onClick={toggleAmbient}>
        {settings.mode === 'Fish' ? 'Bubbles' : 'Mist'}:{' '}
        {settings.ambient_particles_on ? 'on' : 'off'}
      </button>
      <button onClick={toggleSound}>{settings.sound_on ? 'Sound: on' : 'Sound: off'}</button>
      <button onClick={toggleMode}>
        {settings.mode === 'Fish' ? 'Switch to gecko' : 'Switch to fish'}
      </button>
      <button onClick={() => openSatelliteWindow('family-tree')}>Tree</button>
      <button onClick={() => openSatelliteWindow('setup')}>Setup</button>
      <button onClick={exit}>Exit</button>
    </div>
  );
}
