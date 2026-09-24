// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it, vi } from 'vitest';

import type { MenuItem, MenuSection } from '../components/ContextMenu/types';
import { DEFAULT_SETTINGS } from './jarClient';
import { buildTankMenuModel, type TankMenuActions } from './tankMenuModel';

function makeActions(): TankMenuActions {
  return {
    toggleLight: vi.fn(),
    toggleAmbient: vi.fn(),
    toggleSound: vi.fn(),
    switchMode: vi.fn(),
    openFamilyTree: vi.fn(),
    openFishMonitor: vi.fn(),
    openFishEye: vi.fn(),
    openSetup: vi.fn(),
    openDevSettings: vi.fn(),
    exit: vi.fn(),
  };
}

function items(section: MenuSection): MenuItem[] {
  return section.items as MenuItem[];
}

function itemById(model: ReturnType<typeof buildTankMenuModel>, id: string): MenuItem {
  const found = model.sections.flatMap((s) => items(s)).find((i) => i.id === id);
  if (!found) throw new Error(`no menu item with id "${id}"`);
  return found;
}

describe('buildTankMenuModel', () => {
  it('has four sections: Tank, Mode, Critters, App', () => {
    const model = buildTankMenuModel(DEFAULT_SETTINGS, makeActions());
    const [tank, mode, critters, app] = model.sections;
    expect(model.sections).toHaveLength(4);
    expect(items(tank!)).toHaveLength(3);
    expect(items(mode!)).toHaveLength(1);
    expect(items(critters!).map((i) => i.id)).toEqual(['family-tree', 'fish-monitor', 'fish-eye']);
    expect(items(app!).map((i) => i.id)).toEqual(['setup', 'dev-settings', 'exit']);
  });

  it('follows checkbox settings', () => {
    const onModel = buildTankMenuModel(
      { ...DEFAULT_SETTINGS, light_on: true, ambient_particles_on: false, sound_on: true },
      makeActions(),
    );
    expect(itemById(onModel, 'light').checked).toBe(true);
    expect(itemById(onModel, 'ambient').checked).toBe(false);
    expect(itemById(onModel, 'sound').checked).toBe(true);
  });

  it('labels the ambient toggle Bubbles in Fish mode, Mist in Gecko mode', () => {
    const fishModel = buildTankMenuModel({ ...DEFAULT_SETTINGS, mode: 'Fish' }, makeActions());
    expect(itemById(fishModel, 'ambient').label).toBe('Bubbles');

    const geckoModel = buildTankMenuModel({ ...DEFAULT_SETTINGS, mode: 'Gecko' }, makeActions());
    expect(itemById(geckoModel, 'ambient').label).toBe('Mist');
  });

  it('names the other mode on the mode-switch row', () => {
    const fishModel = buildTankMenuModel({ ...DEFAULT_SETTINGS, mode: 'Fish' }, makeActions());
    expect(itemById(fishModel, 'mode').label).toBe('Switch to gecko');

    const geckoModel = buildTankMenuModel({ ...DEFAULT_SETTINGS, mode: 'Gecko' }, makeActions());
    expect(itemById(geckoModel, 'mode').label).toBe('Switch to fish');
  });

  it('calls exactly the matching action and nothing else', () => {
    const actions = makeActions();
    const model = buildTankMenuModel(DEFAULT_SETTINGS, actions);

    itemById(model, 'fish-eye').action?.();

    expect(actions.openFishEye).toHaveBeenCalledOnce();
    expect(actions.openFamilyTree).not.toHaveBeenCalled();
    expect(actions.openFishMonitor).not.toHaveBeenCalled();
    expect(actions.openSetup).not.toHaveBeenCalled();
    expect(actions.openDevSettings).not.toHaveBeenCalled();
    expect(actions.exit).not.toHaveBeenCalled();
  });
});
