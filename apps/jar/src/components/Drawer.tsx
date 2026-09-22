// The drawer (SCREENS.md W1): "Light · Bubbles (aquarium) / Mist
// (terrarium) · Sound · Gecko/Fish (mode switch) · Tree · Setup · Exit
// (saves the jar, quits the app — essential on GNOME where there is no
// tray)." Mounted by `TankWindow.tsx` into the strip exposed when it grows
// the tank window rightward on click — see that file for why it's a resize
// of the tank's own window rather than a second floating window.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { CSSProperties } from 'react';

import { getCurrentWindow } from '@tauri-apps/api/window';

import { jar, useJarStore } from '../domain/jarClient';
import { openSatelliteWindow } from '../domain/windows';

const buttonStyle: CSSProperties = {
  width: '100%',
  textAlign: 'left',
  font: 'inherit',
  color: 'inherit',
};

interface DrawerProps {
  /** Called right before Tree/Setup/Dev open a new window and take its
   * focus — closes the drawer immediately rather than waiting on the idle
   * timeout for this specific transition. Its own resize is awaited before
   * anything else measures or persists the tank window's geometry: the
   * physical window is still `DRAWER_WIDTH` wider than the closed tank
   * until this settles. */
  onNavigate: () => Promise<void>;
}

export function Drawer({ onNavigate }: DrawerProps) {
  const settings = useJarStore((s) => s.settings);

  const toggleMode = () => jar.setMode(settings.mode === 'Fish' ? 'Gecko' : 'Fish');
  const toggleLight = () => jar.setToggle('light', !settings.light_on);
  const toggleAmbient = () => jar.setToggle('ambientParticles', !settings.ambient_particles_on);
  const toggleSound = () => jar.setToggle('sound', !settings.sound_on);
  const navigate = async (window: 'family-tree' | 'setup' | 'dev-settings' | 'fish-monitor') => {
    // Await the shrink first — otherwise `openSatelliteWindow` measures the
    // tank while it's still the drawer's extra width, positioning the new
    // window separated from the tank instead of beside it.
    await onNavigate();
    void openSatelliteWindow(window);
  };

  const exit = async () => {
    // Await the shrink first — `tauri-plugin-window-state` persists
    // whatever size the window closes at, and the drawer's extra width is
    // never the tank's real closed size.
    await onNavigate();
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
        font: '13px "Nunito", sans-serif',
        background: 'var(--jar-bg, #fbfaf6)',
        color: 'var(--jar-ink, #2b2a33)',
        borderRadius: 'var(--jar-radius, 12px)',
        boxShadow: 'var(--jar-shadow, 0 4px 12px rgba(0,0,0,0.2))',
        padding: 8,
        boxSizing: 'border-box',
      }}
    >
      <button style={buttonStyle} onClick={toggleLight}>
        {settings.light_on ? 'Light: on' : 'Light: off'}
      </button>
      <button style={buttonStyle} onClick={toggleAmbient}>
        {settings.mode === 'Fish' ? 'Bubbles' : 'Mist'}:{' '}
        {settings.ambient_particles_on ? 'on' : 'off'}
      </button>
      <button style={buttonStyle} onClick={toggleSound}>
        {settings.sound_on ? 'Sound: on' : 'Sound: off'}
      </button>
      <button style={buttonStyle} onClick={toggleMode}>
        {settings.mode === 'Fish' ? 'Switch to gecko' : 'Switch to fish'}
      </button>
      <button style={buttonStyle} onClick={() => void navigate('family-tree')}>
        Tree
      </button>
      <button style={buttonStyle} onClick={() => void navigate('setup')}>
        Setup
      </button>
      <button style={buttonStyle} onClick={() => void exit()}>
        Exit
      </button>
      {import.meta.env.DEV && (
        <button style={buttonStyle} onClick={() => void navigate('dev-settings')}>
          Dev
        </button>
      )}
      {import.meta.env.DEV && (
        <button style={buttonStyle} onClick={() => void navigate('fish-monitor')}>
          Fish monitor
        </button>
      )}
    </div>
  );
}
