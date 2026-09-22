// Tests for `useJarStore`'s event-application logic — the merge-not-overwrite
// contract from `docs/architecture/rust-core.md` §6.1 and the Born/Passed
// handling from §6.2 (see this module's header comment). `@tauri-apps/api/*`
// and `tauri-plugin-jar-api` are mocked since none of this file's exports
// touch the Tauri IPC bridge outside `ensureJarClientStarted`, which these
// tests never call.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(),
  listen: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({ label: 'tank' })),
}));

vi.mock('tauri-plugin-jar-api', () => ({
  start: vi.fn(),
  stop: vi.fn(),
  setSpeed: vi.fn(),
  setMode: vi.fn(),
  addCritter: vi.fn(),
  renameCritter: vi.fn(),
  setToggle: vi.fn(),
  setTheme: vi.fn(),
  setFrame: vi.fn(),
  getSnapshot: vi.fn(),
  loadSnapshot: vi.fn(),
}));

import defaultSettingsFixture from './protocol/generated/defaultSettings.json';
import type { Critter } from './protocol/generated/Critter';
import { DEFAULT_SETTINGS, useJarStore } from './jarClient';

function makeCritter(overrides: Partial<Critter> = {}): Critter {
  return {
    id: 1,
    species: 'Fish',
    name: 'Pickle',
    hue: 210,
    fin: 'Veil',
    spots: true,
    sex: 'Male',
    personality: 'Bold',
    mood: 66,
    energy: 100,
    age_sec: 0,
    life: 3120,
    gen: 1,
    parents: null,
    alive: true,
    born: 0,
    died: null,
    favourite_spot: { x: 10, y: 20, z: 30 },
    ...overrides,
  };
}

beforeEach(() => {
  useJarStore.setState({
    critters: {},
    settings: DEFAULT_SETTINGS,
    simSeconds: 0,
    isNight: false,
    hydrated: false,
  });
});

describe('DEFAULT_SETTINGS', () => {
  it("matches defaultSettings.json, generated from Rust's JarSettings::default()", () => {
    // `defaultSettings.json` is written by
    // `crates/jar-protocol/src/settings.rs`'s `export_default_settings_fixture`
    // test, the same `cargo test`-time regeneration convention as the
    // `ts-rs` type bindings alongside it. Comparing against that generated
    // artifact — rather than a second hand-copied literal — means a changed
    // Rust default actually fails this test the next time `cargo test`
    // regenerates the fixture, instead of two independent copies silently
    // drifting in lockstep.
    expect(DEFAULT_SETTINGS).toEqual(defaultSettingsFixture);
  });
});

describe('hydrate', () => {
  it('populates critters keyed by id and marks the store hydrated', () => {
    const critter = makeCritter();
    useJarStore.getState().hydrate({
      critters: [critter],
      settings: DEFAULT_SETTINGS,
      sim_seconds: 42,
      is_night: true,
    });

    const state = useJarStore.getState();
    expect(state.critters[critter.id]).toEqual(critter);
    expect(state.simSeconds).toBe(42);
    expect(state.isNight).toBe(true);
    expect(state.hydrated).toBe(true);
  });
});

describe('applyEvent — TickUpdate', () => {
  it('merges only the stats fields, leaving genetics/name/parents untouched', () => {
    const original = makeCritter({ id: 1, mood: 66, energy: 100, age_sec: 0, alive: true });
    useJarStore.setState({
      critters: { 1: original },
      settings: DEFAULT_SETTINGS,
      simSeconds: 0,
      hydrated: true,
    });

    useJarStore.getState().applyEvent({
      type: 'TickUpdate',
      critters: [{ id: 1, mood: 40, energy: 55, age_sec: 12, alive: true }],
      is_night: false,
    });

    const updated = useJarStore.getState().critters[1];
    if (!updated) throw new Error('expected critter 1 to still exist');
    expect(updated.mood).toBe(40);
    expect(updated.energy).toBe(55);
    expect(updated.age_sec).toBe(12);
    expect(updated.alive).toBe(true);
    // Untouched: everything steering/physics or genetics own.
    expect(updated.name).toBe(original.name);
    expect(updated.hue).toBe(original.hue);
    expect(updated.fin).toBe(original.fin);
    expect(updated.spots).toBe(original.spots);
    expect(updated.favourite_spot).toEqual(original.favourite_spot);
    expect(updated.parents).toBe(original.parents);
  });

  it('ignores stats for a critter id not yet in the store (a Born not yet processed)', () => {
    useJarStore.getState().applyEvent({
      type: 'TickUpdate',
      critters: [{ id: 999, mood: 10, energy: 10, age_sec: 1, alive: true }],
      is_night: false,
    });

    expect(useJarStore.getState().critters[999]).toBeUndefined();
  });

  it('advances simSeconds by one per TickUpdate, regardless of critter count', () => {
    useJarStore.getState().applyEvent({ type: 'TickUpdate', critters: [], is_night: false });
    expect(useJarStore.getState().simSeconds).toBe(1);

    useJarStore.getState().applyEvent({ type: 'TickUpdate', critters: [], is_night: false });
    expect(useJarStore.getState().simSeconds).toBe(2);
  });

  it('adopts is_night as the store-wide authoritative night state', () => {
    useJarStore.getState().applyEvent({ type: 'TickUpdate', critters: [], is_night: true });
    expect(useJarStore.getState().isNight).toBe(true);

    useJarStore.getState().applyEvent({ type: 'TickUpdate', critters: [], is_night: false });
    expect(useJarStore.getState().isNight).toBe(false);
  });
});

describe('applyEvent — Born', () => {
  it('inserts the new critter into the store', () => {
    const child = makeCritter({ id: 2, name: 'Noodle', gen: 2, parents: [1, 3] });

    useJarStore.getState().applyEvent({ type: 'Born', child, parent_a: 1, parent_b: 3 });

    expect(useJarStore.getState().critters[2]).toEqual(child);
  });
});

describe('applyEvent — Passed', () => {
  it('flips alive to false while preserving the rest of the record (the memorial state)', () => {
    const critter = makeCritter({ id: 5, alive: true });
    useJarStore.setState({
      critters: { 5: critter },
      settings: DEFAULT_SETTINGS,
      simSeconds: 0,
      hydrated: true,
    });

    useJarStore.getState().applyEvent({ type: 'Passed', id: 5 });

    const passed = useJarStore.getState().critters[5];
    if (!passed) throw new Error('expected critter 5 to still exist');
    expect(passed.alive).toBe(false);
    expect(passed.name).toBe(critter.name);
    expect(passed.hue).toBe(critter.hue);
  });

  it('is a no-op for an unknown critter id', () => {
    useJarStore.getState().applyEvent({ type: 'Passed', id: 999 });

    expect(useJarStore.getState().critters[999]).toBeUndefined();
  });
});

describe('applyEvent — SettingsChanged', () => {
  it('replaces settings wholesale, so a change from any window reaches every window', () => {
    const changed = { ...DEFAULT_SETTINGS, light_on: false, simulation_speed: 30 };

    useJarStore.getState().applyEvent({ type: 'SettingsChanged', settings: changed });

    expect(useJarStore.getState().settings).toEqual(changed);
  });
});

describe('applyEvent — Renamed', () => {
  it('updates the name, leaving everything else untouched', () => {
    const critter = makeCritter({ id: 7, name: 'Pickle' });
    useJarStore.setState({
      critters: { 7: critter },
      settings: DEFAULT_SETTINGS,
      simSeconds: 0,
      hydrated: true,
    });

    useJarStore.getState().applyEvent({ type: 'Renamed', id: 7, name: 'Sir Bubbles' });

    const renamed = useJarStore.getState().critters[7];
    if (!renamed) throw new Error('expected critter 7 to still exist');
    expect(renamed.name).toBe('Sir Bubbles');
    expect(renamed.hue).toBe(critter.hue);
  });

  it('is a no-op for an unknown critter id', () => {
    useJarStore.getState().applyEvent({ type: 'Renamed', id: 999, name: 'Nobody' });

    expect(useJarStore.getState().critters[999]).toBeUndefined();
  });
});

describe('applyEvent — Added', () => {
  it('inserts the new critter into the store, same as Born', () => {
    const critter = makeCritter({ id: 9, name: 'Waffles' });

    useJarStore.getState().applyEvent({ type: 'Added', critter });

    expect(useJarStore.getState().critters[9]).toEqual(critter);
  });
});

describe('ensureJarClientStarted — first-run theme (SPEC.md §4)', () => {
  // Each case needs its own fresh module instance — `ensureJarClientStarted`
  // memoizes `startPromise` after the first call, so reusing the
  // statically-imported module here would only ever exercise one branch.
  const emptySnapshot = { critters: [], settings: DEFAULT_SETTINGS, sim_seconds: 0 };

  it('defaults dialog_theme to ModernDark when the OS prefers dark', async () => {
    vi.resetModules();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    const pluginApi = await import('tauri-plugin-jar-api');
    vi.mocked(pluginApi.getSnapshot).mockResolvedValue(emptySnapshot);
    const { ensureJarClientStarted } = await import('./jarClient');

    await ensureJarClientStarted();

    expect(pluginApi.start).toHaveBeenCalledWith(
      expect.objectContaining({ dialog_theme: 'ModernDark' }),
      expect.any(Function),
    );
    vi.unstubAllGlobals();
  });

  it("keeps DEFAULT_SETTINGS's Modern theme when the OS has no dark preference", async () => {
    vi.resetModules();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    const pluginApi = await import('tauri-plugin-jar-api');
    vi.mocked(pluginApi.getSnapshot).mockResolvedValue(emptySnapshot);
    const { ensureJarClientStarted } = await import('./jarClient');

    await ensureJarClientStarted();

    expect(pluginApi.start).toHaveBeenCalledWith(
      expect.objectContaining({ dialog_theme: 'Modern' }),
      expect.any(Function),
    );
    vi.unstubAllGlobals();
  });
});
