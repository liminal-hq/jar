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
    captureScreenshot: vi.fn(),
    addCritter: vi.fn(),
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
  it('has five sections: Tank, Mode, Screenshot, Critters, App', () => {
    const model = buildTankMenuModel(DEFAULT_SETTINGS, makeActions());
    const [tank, mode, screenshot, critters, app] = model.sections;
    expect(model.sections).toHaveLength(5);
    expect(items(tank!)).toHaveLength(3);
    expect(items(mode!)).toHaveLength(1);
    expect(items(screenshot!).map((i) => i.id)).toEqual(['screenshot']);
    expect(items(critters!).map((i) => i.id)).toEqual([
      'add-critter',
      'family-tree',
      'fish-monitor',
      'fish-eye',
    ]);
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

  it('wires the Screenshot item to captureScreenshot and nothing else', () => {
    const actions = makeActions();
    const model = buildTankMenuModel(DEFAULT_SETTINGS, actions);
    const screenshotItem = itemById(model, 'screenshot');

    expect(screenshotItem.label).toBe('Screenshot');
    expect(screenshotItem.checked).toBeUndefined();

    screenshotItem.action?.();

    expect(actions.captureScreenshot).toHaveBeenCalledOnce();
    expect(actions.switchMode).not.toHaveBeenCalled();
    expect(actions.openFamilyTree).not.toHaveBeenCalled();
  });

  it('wires Add a critter to addCritter and nothing else', () => {
    const actions = makeActions();
    const model = buildTankMenuModel(DEFAULT_SETTINGS, actions);
    const addCritterItem = itemById(model, 'add-critter');

    expect(addCritterItem.label).toBe('Add a critter');
    expect(addCritterItem.checked).toBeUndefined();

    addCritterItem.action?.();

    expect(actions.addCritter).toHaveBeenCalledOnce();
    expect(actions.openFamilyTree).not.toHaveBeenCalled();
    expect(actions.captureScreenshot).not.toHaveBeenCalled();
  });
});
