// Builds the tank window's right-click menu (`TankContextMenu.tsx`) as a
// pure function of the current settings — kept free of any Tauri/store
// import so it's testable without mounting React or a running backend,
// mirroring `ContextMenu`'s own model/view split.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { MenuModel } from '../components/ContextMenu/types';
import type { JarSettings } from './protocol/generated/JarSettings';

export interface TankMenuActions {
  toggleLight: () => void;
  toggleAmbient: () => void;
  toggleSound: () => void;
  switchMode: () => void;
  captureScreenshot: () => void;
  openFamilyTree: () => void;
  openFishMonitor: () => void;
  openFishEye: () => void;
  openSetup: () => void;
  openDevSettings: () => void;
  exit: () => void;
}

export function buildTankMenuModel(settings: JarSettings, actions: TankMenuActions): MenuModel {
  const otherMode = settings.mode === 'Fish' ? 'gecko' : 'fish';

  return {
    sections: [
      {
        items: [
          { id: 'light', label: 'Light', checked: settings.light_on, action: actions.toggleLight },
          {
            id: 'ambient',
            label: settings.mode === 'Fish' ? 'Bubbles' : 'Mist',
            checked: settings.ambient_particles_on,
            action: actions.toggleAmbient,
          },
          {
            id: 'sound',
            label: 'Critter sounds',
            checked: settings.sound_on,
            action: actions.toggleSound,
          },
        ],
      },
      {
        items: [{ id: 'mode', label: `Switch to ${otherMode}`, action: actions.switchMode }],
      },
      {
        items: [{ id: 'screenshot', label: 'Screenshot', action: actions.captureScreenshot }],
      },
      {
        // Windows that show you the critters/sim itself — not app
        // configuration or tooling, which live in the App section below.
        items: [
          { id: 'family-tree', label: 'Tree', action: actions.openFamilyTree },
          { id: 'fish-monitor', label: 'Fish monitor', action: actions.openFishMonitor },
          { id: 'fish-eye', label: 'Fish eye', action: actions.openFishEye },
        ],
      },
      {
        items: [
          { id: 'setup', label: 'Setup', action: actions.openSetup },
          { id: 'dev-settings', label: 'Dev', action: actions.openDevSettings },
          { id: 'exit', label: 'Exit', action: actions.exit },
        ],
      },
    ],
  };
}
