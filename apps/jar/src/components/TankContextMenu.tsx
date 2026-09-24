// The tank's right-click menu (SCREENS.md W1) — a fixed-position overlay
// over the tank, not a second window or a window resize (see
// `TankWindow.tsx` for why the previous resize-based drawer was replaced).
// Wires `tankMenuModel.ts`'s pure model builder to the live settings store
// and renders it through the shared `ContextMenu` (also used by
// `TitleBar.tsx`'s right-click menu on the satellite windows).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { getCurrentWindow } from '@tauri-apps/api/window';

import { jar, useJarStore } from '../domain/jarClient';
import { buildTankMenuModel } from '../domain/tankMenuModel';
import { openSatelliteWindow } from '../domain/windows';
import { ContextMenu } from './ContextMenu/ContextMenu';
import type { MenuPosition } from './ContextMenu/types';

interface TankContextMenuProps {
  position: MenuPosition;
  onClose: () => void;
}

export function TankContextMenu({ position, onClose }: TankContextMenuProps) {
  const settings = useJarStore((s) => s.settings);

  const model = buildTankMenuModel(settings, {
    toggleLight: () => void jar.setToggle('light', !settings.light_on),
    toggleAmbient: () => void jar.setToggle('ambientParticles', !settings.ambient_particles_on),
    toggleSound: () => void jar.setToggle('sound', !settings.sound_on),
    switchMode: () => void jar.setMode(settings.mode === 'Fish' ? 'Gecko' : 'Fish'),
    openFamilyTree: () => void openSatelliteWindow('family-tree'),
    openFishMonitor: () => void openSatelliteWindow('fish-monitor'),
    openFishEye: () => void openSatelliteWindow('fish-eye'),
    openSetup: () => void openSatelliteWindow('setup'),
    openDevSettings: () => void openSatelliteWindow('dev-settings'),
    // The shutdown autosave flush (rust-core.md §5.3) fires from the
    // plugin's own `ExitRequested` hook regardless of how the process
    // exits, so this just needs to close the window.
    exit: () => void getCurrentWindow().close(),
  });

  return (
    // `ContextMenu`'s own `handleItemClick` already closes the menu after
    // every click, checkbox items included — no `keepOpen` concept here.
    <ContextMenu
      model={model}
      position={position}
      onClose={onClose}
      onItemClick={(_id, action) => action?.()}
    />
  );
}
