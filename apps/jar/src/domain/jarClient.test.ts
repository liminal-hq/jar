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
    hydrated: false,
  });
});

describe('hydrate', () => {
  it('populates critters keyed by id and marks the store hydrated', () => {
    const critter = makeCritter();
    useJarStore.getState().hydrate({
      critters: [critter],
      settings: DEFAULT_SETTINGS,
      sim_seconds: 42,
    });

    const state = useJarStore.getState();
    expect(state.critters[critter.id]).toEqual(critter);
    expect(state.simSeconds).toBe(42);
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
    });

    expect(useJarStore.getState().critters[999]).toBeUndefined();
  });

  it('advances simSeconds by one per TickUpdate, regardless of critter count', () => {
    useJarStore.getState().applyEvent({ type: 'TickUpdate', critters: [] });
    expect(useJarStore.getState().simSeconds).toBe(1);

    useJarStore.getState().applyEvent({ type: 'TickUpdate', critters: [] });
    expect(useJarStore.getState().simSeconds).toBe(2);
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
