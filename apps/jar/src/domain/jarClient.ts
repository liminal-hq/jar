// Typed façade combining `tauri-plugin-jar-api` (thin, untyped `invoke()`
// wrappers, in `plugins/tauri-plugin-jar/guest-js`) with the generated
// types in `./protocol/generated/` (produced by `jar-protocol`'s `ts-rs`
// export — regenerate via `scripts/generate-protocol-bindings.sh` whenever
// `crates/jar-protocol` changes).
//
// This is the *only* place in the frontend that should import
// `tauri-plugin-jar-api` directly or touch `SimEvent` shapes — every
// window imports `useJarStore`/`onCritterEvent`/the `jar` action object
// from here instead. See `docs/architecture/rust-core.md` §6 for the
// merge/event contract this file implements:
//   §6.1 merge-not-overwrite — a `TickUpdate` only ever replaces the stats
//        fields (mood/energy/age_sec/alive) on a critter record, never
//        anything steering/physics own (this store never holds position
//        or velocity at all, so there is nothing to accidentally stomp).
//   §6.2 `Born`/`Passed` are one-shot events, not something the render
//        layer infers by diffing — `onCritterEvent` exists specifically so
//        a listener can react to the *moment* something happened (a toast,
//        spawning a Yuka vehicle) rather than to a before/after diff.
//   §6.3 who decides where a child appears — `Born`'s payload carries
//        genetics/parentage only; reading a live parent position and
//        placing the child there is the render layer's job
//        (see `render/steering`), not this file's.
//
// Multi-window note: every Jar window (tank, critter-card, family-tree,
// setup) loads this same bundle, but each `WebviewWindow` is a separate JS
// realm with its own copy of this module's state. Only the `tank` window
// calls `start()` (the plugin keeps exactly one live `Channel`, so only one
// caller can own it — see `plugins/tauri-plugin-jar/src/lib.rs`); every
// other window hydrates once via `get_snapshot` and then listens for the
// tank window's rebroadcast of each `SimEvent` over a plain Tauri app
// event. If the tank window is closed, non-tank windows stop receiving
// updates until the tank window is reopened and calls `start()` again —
// a known limitation, not a bug to chase in this pass (see `NEXT_STEPS.md`).
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as pluginApi from 'tauri-plugin-jar-api';
import { create } from 'zustand';

import type { Critter } from './protocol/generated/Critter';
import type { CritterId } from './protocol/generated/CritterId';
import type { DialogTheme } from './protocol/generated/DialogTheme';
import type { JarSettings } from './protocol/generated/JarSettings';
import type { SimEvent } from './protocol/generated/SimEvent';
import type { Species } from './protocol/generated/Species';
import type { TankFrame } from './protocol/generated/TankFrame';

const JAR_REBROADCAST_EVENT = 'jar://event';
const TANK_WINDOW_LABEL = 'tank';

export const DEFAULT_SETTINGS: JarSettings = {
  mode: 'Fish',
  frame: 'Bevelled98',
  dialog_theme: 'Modern',
  theme_variant: 'Lagoon',
  light_on: true,
  ambient_particles_on: true,
  sound_on: false,
  simulation_speed: 1,
  always_on_top: false,
};

interface JarStoreState {
  critters: Record<CritterId, Critter>;
  settings: JarSettings;
  simSeconds: number;
  hydrated: boolean;
}

interface JarStoreActions {
  applyEvent: (event: SimEvent) => void;
  hydrate: (snapshot: { critters: Critter[]; settings: JarSettings; sim_seconds: number }) => void;
  setSettings: (settings: JarSettings) => void;
}

export const useJarStore = create<JarStoreState & JarStoreActions>((set) => ({
  critters: {},
  settings: DEFAULT_SETTINGS,
  simSeconds: 0,
  hydrated: false,

  hydrate: (snapshot) =>
    set({
      critters: Object.fromEntries(snapshot.critters.map((c) => [c.id, c])),
      settings: snapshot.settings,
      simSeconds: snapshot.sim_seconds,
      hydrated: true,
    }),

  setSettings: (settings) => set({ settings }),

  applyEvent: (event) =>
    set((state) => {
      switch (event.type) {
        case 'Born':
          return { critters: { ...state.critters, [event.child.id]: event.child } };

        case 'Passed': {
          const existing = state.critters[event.id];
          if (!existing) return state;
          return { critters: { ...state.critters, [event.id]: { ...existing, alive: false } } };
        }

        case 'TickUpdate': {
          // Merge-not-overwrite (rust-core.md §6.1): copy only the stats
          // fields onto the existing record, never replace it wholesale.
          const next = { ...state.critters };
          for (const stats of event.critters) {
            const existing = next[stats.id];
            if (!existing) continue; // a Born we haven't processed yet
            next[stats.id] = {
              ...existing,
              mood: stats.mood,
              energy: stats.energy,
              age_sec: stats.age_sec,
              alive: stats.alive,
            };
          }
          return { critters: next, simSeconds: state.simSeconds + 1 };
        }
      }
    }),
}));

/** One-shot notifications for things that happened at a moment in time — a
 * toast, or the trigger to spawn/despawn a Yuka vehicle — as opposed to
 * `useJarStore`'s continuously-current state. See this file's header for
 * why these are kept separate from the store. */
export type CritterEvent =
  | { kind: 'born'; child: Critter; parentA: CritterId; parentB: CritterId }
  | { kind: 'passed'; id: CritterId };

const critterEventListeners = new Set<(event: CritterEvent) => void>();

export function onCritterEvent(callback: (event: CritterEvent) => void): () => void {
  critterEventListeners.add(callback);
  return () => critterEventListeners.delete(callback);
}

function handleEvent(event: SimEvent): void {
  if (event.type === 'Born') {
    for (const cb of critterEventListeners) {
      cb({ kind: 'born', child: event.child, parentA: event.parent_a, parentB: event.parent_b });
    }
  } else if (event.type === 'Passed') {
    for (const cb of critterEventListeners) cb({ kind: 'passed', id: event.id });
  }
  useJarStore.getState().applyEvent(event);
}

let startPromise: Promise<void> | null = null;

/** Idempotent — safe to call from every window's top-level effect. Only
 * actually calls the plugin's `start` command once, and only from the tank
 * window; see the multi-window note in this file's header. */
export function ensureJarClientStarted(settings: JarSettings = DEFAULT_SETTINGS): Promise<void> {
  if (!startPromise) startPromise = doStart(settings);
  return startPromise;
}

async function doStart(settings: JarSettings): Promise<void> {
  const isTank = getCurrentWindow().label === TANK_WINDOW_LABEL;

  if (isTank) {
    await pluginApi.start(settings, (event) => {
      const simEvent = event as SimEvent;
      handleEvent(simEvent);
      // Rebroadcast so non-tank windows stay in sync without each holding
      // their own `Channel` (the plugin only keeps one — see this file's
      // header).
      void emit(JAR_REBROADCAST_EVENT, simEvent);
    });
  } else {
    await listen<SimEvent>(JAR_REBROADCAST_EVENT, (e) => handleEvent(e.payload));
  }

  const snapshot = (await pluginApi.getSnapshot()) as {
    critters: Critter[];
    settings: JarSettings;
    sim_seconds: number;
  };
  useJarStore.getState().hydrate(snapshot);
}

/** Typed wrappers over the untyped `tauri-plugin-jar-api` commands — every
 * window should call these, not `pluginApi` directly. */
export const jar = {
  setSpeed: (speed: number) => pluginApi.setSpeed(speed),
  setMode: (mode: Species) => pluginApi.setMode(mode),
  addCritter: (species: Species) => pluginApi.addCritter(species) as Promise<Critter>,
  renameCritter: (id: CritterId, name: string) => pluginApi.renameCritter(id, name),
  setToggle: (toggle: 'Light' | 'AmbientParticles' | 'Sound' | 'AlwaysOnTop', on: boolean) =>
    pluginApi.setToggle(toggle, on),
  setTheme: (theme: DialogTheme, variant: string) => pluginApi.setTheme(theme, variant),
  setFrame: (frame: TankFrame) => pluginApi.setFrame(frame),
};
