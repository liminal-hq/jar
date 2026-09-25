// Builds the tank window's right-click menu (`TankContextMenu.tsx`) as a
// pure function of the current settings — kept free of any Tauri/store
// import so it's testable without mounting React or a running backend,
// mirroring `ContextMenu`'s own model/view split.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { MenuModel } from '../components/ContextMenu/types';
import type { DayNightOverride } from './devSettings';
import type { JarSettings } from './protocol/generated/JarSettings';

export interface TankMenuActions {
  toggleLight: () => void;
  toggleAmbient: () => void;
  toggleSound: () => void;
  switchMode: () => void;
  captureScreenshot: () => void;
  addCritter: () => void;
  openFamilyTree: () => void;
  openFishMonitor: () => void;
  openFishEye: () => void;
  toggleAlwaysOnTop: () => void;
  setDayNightAuto: () => void;
  setDayNightDay: () => void;
  setDayNightNight: () => void;
  setDayNightActive: () => void;
  openSetup: () => void;
  openDevSettings: () => void;
  exit: () => void;
}

export function buildTankMenuModel(
  settings: JarSettings,
  dayNightOverride: DayNightOverride,
  actions: TankMenuActions,
): MenuModel {
  const otherMode = settings.habitat === 'Aquarium' ? 'gecko' : 'fish';

  return {
    sections: [
      {
        items: [
          { id: 'light', label: 'Light', checked: settings.light_on, action: actions.toggleLight },
          {
            id: 'ambient',
            label: settings.habitat === 'Aquarium' ? 'Bubbles' : 'Mist',
            checked: settings.ambient_particles_on,
            action: actions.toggleAmbient,
          },
          {
            id: 'sound',
            label: 'Critter sounds',
            checked: settings.sound_on,
            action: actions.toggleSound,
          },
          {
            id: 'day-night',
            label: 'Day/night',
            children: [
              {
                id: 'day-night-auto',
                label: 'Auto',
                checked: dayNightOverride === 'auto',
                action: actions.setDayNightAuto,
              },
              {
                id: 'day-night-day',
                label: 'Always day',
                checked: dayNightOverride === 'day',
                action: actions.setDayNightDay,
              },
              {
                id: 'day-night-night',
                label: 'Always night',
                checked: dayNightOverride === 'night',
                action: actions.setDayNightNight,
              },
              {
                id: 'day-night-active',
                label: 'Always active',
                checked: dayNightOverride === 'active',
                action: actions.setDayNightActive,
              },
            ],
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
        // Everything about the critters themselves — creating one, and the
        // windows that show you them — not app configuration or tooling,
        // which live in the App section below.
        items: [
          { id: 'add-critter', label: 'Add a critter', action: actions.addCritter },
          { id: 'family-tree', label: 'Tree', action: actions.openFamilyTree },
          { id: 'fish-monitor', label: 'Fish monitor', action: actions.openFishMonitor },
          { id: 'fish-eye', label: 'Fish eye', action: actions.openFishEye },
        ],
      },
      {
        items: [
          {
            id: 'always-on-top',
            label: 'Always on top',
            checked: settings.always_on_top,
            action: actions.toggleAlwaysOnTop,
          },
          { id: 'setup', label: 'Setup', action: actions.openSetup },
          { id: 'dev-settings', label: 'Dev', action: actions.openDevSettings },
          { id: 'exit', label: 'Exit', action: actions.exit },
        ],
      },
    ],
  };
}
