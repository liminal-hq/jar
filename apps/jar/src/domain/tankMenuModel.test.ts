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
    toggleAlwaysOnTop: vi.fn(),
    setDayNightAuto: vi.fn(),
    setDayNightDay: vi.fn(),
    setDayNightNight: vi.fn(),
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

function childById(item: MenuItem, id: string): MenuItem {
  const found = (item.children as MenuItem[] | undefined)?.find((c) => c.id === id);
  if (!found) throw new Error(`no child item with id "${id}" under "${item.id}"`);
  return found;
}

describe('buildTankMenuModel', () => {
  it('has five sections: Tank, Mode, Screenshot, Critters, App', () => {
    const model = buildTankMenuModel(DEFAULT_SETTINGS, 'auto', makeActions());
    const [tank, mode, screenshot, critters, app] = model.sections;
    expect(model.sections).toHaveLength(5);
    expect(items(tank!).map((i) => i.id)).toEqual(['light', 'ambient', 'sound', 'day-night']);
    expect(items(mode!)).toHaveLength(1);
    expect(items(screenshot!).map((i) => i.id)).toEqual(['screenshot']);
    expect(items(critters!).map((i) => i.id)).toEqual([
      'add-critter',
      'family-tree',
      'fish-monitor',
      'fish-eye',
    ]);
    expect(items(app!).map((i) => i.id)).toEqual([
      'always-on-top',
      'setup',
      'dev-settings',
      'exit',
    ]);
  });

  it('follows checkbox settings', () => {
    const onModel = buildTankMenuModel(
      {
        ...DEFAULT_SETTINGS,
        light_on: true,
        ambient_particles_on: false,
        sound_on: true,
        always_on_top: true,
      },
      'auto',
      makeActions(),
    );
    expect(itemById(onModel, 'light').checked).toBe(true);
    expect(itemById(onModel, 'ambient').checked).toBe(false);
    expect(itemById(onModel, 'sound').checked).toBe(true);
    expect(itemById(onModel, 'always-on-top').checked).toBe(true);
  });

  it('labels the ambient toggle Bubbles in Fish mode, Mist in Gecko mode', () => {
    const fishModel = buildTankMenuModel(
      { ...DEFAULT_SETTINGS, mode: 'Fish' },
      'auto',
      makeActions(),
    );
    expect(itemById(fishModel, 'ambient').label).toBe('Bubbles');

    const geckoModel = buildTankMenuModel(
      { ...DEFAULT_SETTINGS, mode: 'Gecko' },
      'auto',
      makeActions(),
    );
    expect(itemById(geckoModel, 'ambient').label).toBe('Mist');
  });

  it('names the other mode on the mode-switch row', () => {
    const fishModel = buildTankMenuModel(
      { ...DEFAULT_SETTINGS, mode: 'Fish' },
      'auto',
      makeActions(),
    );
    expect(itemById(fishModel, 'mode').label).toBe('Switch to gecko');

    const geckoModel = buildTankMenuModel(
      { ...DEFAULT_SETTINGS, mode: 'Gecko' },
      'auto',
      makeActions(),
    );
    expect(itemById(geckoModel, 'mode').label).toBe('Switch to fish');
  });

  it('calls exactly the matching action and nothing else', () => {
    const actions = makeActions();
    const model = buildTankMenuModel(DEFAULT_SETTINGS, 'auto', actions);

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
    const model = buildTankMenuModel(DEFAULT_SETTINGS, 'auto', actions);
    const screenshotItem = itemById(model, 'screenshot');

    expect(screenshotItem.label).toBe('Screenshot');
    expect(screenshotItem.checked).toBeUndefined();

    screenshotItem.action?.();

    expect(actions.captureScreenshot).toHaveBeenCalledOnce();
    expect(actions.switchMode).not.toHaveBeenCalled();
    expect(actions.openFamilyTree).not.toHaveBeenCalled();
  });

  it('wires Always on top to toggleAlwaysOnTop and nothing else', () => {
    const actions = makeActions();
    const model = buildTankMenuModel(DEFAULT_SETTINGS, 'auto', actions);
    const alwaysOnTopItem = itemById(model, 'always-on-top');

    expect(alwaysOnTopItem.label).toBe('Always on top');
    expect(alwaysOnTopItem.checked).toBe(false);

    alwaysOnTopItem.action?.();

    expect(actions.toggleAlwaysOnTop).toHaveBeenCalledOnce();
    expect(actions.openSetup).not.toHaveBeenCalled();
    expect(actions.openDevSettings).not.toHaveBeenCalled();
    expect(actions.exit).not.toHaveBeenCalled();
  });

  it('wires Add a critter to addCritter and nothing else', () => {
    const actions = makeActions();
    const model = buildTankMenuModel(DEFAULT_SETTINGS, 'auto', actions);
    const addCritterItem = itemById(model, 'add-critter');

    expect(addCritterItem.label).toBe('Add a critter');
    expect(addCritterItem.checked).toBeUndefined();

    addCritterItem.action?.();

    expect(actions.addCritter).toHaveBeenCalledOnce();
    expect(actions.openFamilyTree).not.toHaveBeenCalled();
    expect(actions.captureScreenshot).not.toHaveBeenCalled();
  });

  it('renders Day/night as a submenu with no checked/action of its own', () => {
    const model = buildTankMenuModel(DEFAULT_SETTINGS, 'auto', makeActions());
    const dayNightItem = itemById(model, 'day-night');

    expect(dayNightItem.label).toBe('Day/night');
    expect(dayNightItem.checked).toBeUndefined();
    expect(dayNightItem.action).toBeUndefined();
    expect(dayNightItem.children?.map((c) => (c as MenuItem).id)).toEqual([
      'day-night-auto',
      'day-night-day',
      'day-night-night',
    ]);
  });

  it("computes the Day/night submenu's checked state exclusively", () => {
    const autoModel = buildTankMenuModel(DEFAULT_SETTINGS, 'auto', makeActions());
    const autoItem = itemById(autoModel, 'day-night');
    expect(childById(autoItem, 'day-night-auto').checked).toBe(true);
    expect(childById(autoItem, 'day-night-day').checked).toBe(false);
    expect(childById(autoItem, 'day-night-night').checked).toBe(false);

    const nightModel = buildTankMenuModel(DEFAULT_SETTINGS, 'night', makeActions());
    const nightItem = itemById(nightModel, 'day-night');
    expect(childById(nightItem, 'day-night-auto').checked).toBe(false);
    expect(childById(nightItem, 'day-night-day').checked).toBe(false);
    expect(childById(nightItem, 'day-night-night').checked).toBe(true);
  });

  it('wires each Day/night submenu item to its own action and nothing else', () => {
    const actions = makeActions();
    const model = buildTankMenuModel(DEFAULT_SETTINGS, 'auto', actions);
    const dayNightItem = itemById(model, 'day-night');

    childById(dayNightItem, 'day-night-night').action?.();

    expect(actions.setDayNightNight).toHaveBeenCalledOnce();
    expect(actions.setDayNightAuto).not.toHaveBeenCalled();
    expect(actions.setDayNightDay).not.toHaveBeenCalled();
  });
});
