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
import type { LightColour } from './protocol/generated/LightColour';
import type { SimEvent } from './protocol/generated/SimEvent';
import type { Species } from './protocol/generated/Species';
import type { TankFrame } from './protocol/generated/TankFrame';

const JAR_REBROADCAST_EVENT = 'jar://event';
const TANK_WINDOW_LABEL = 'tank';

export const DEFAULT_SETTINGS: JarSettings = {
  mode: 'Fish',
  frame: 'Bevelled98',
  dialog_theme: 'Modern',
  theme_variants: {
    Modern: 'Lagoon',
    ModernDark: 'Lagoon',
    Classic98: 'Classic blue',
    PaperNotebook: 'Ruled cream',
    HandheldLcd: 'Pea soup',
    NeonTerminal: 'Magenta',
  },
  light_on: true,
  light_colour: 'Daylight',
  ambient_particles_on: true,
  sound_on: false,
  simulation_speed: 1,
  always_on_top: false,
};

interface JarStoreState {
  critters: Record<CritterId, Critter>;
  settings: JarSettings;
  simSeconds: number;
  /** Authoritative day/night state, pushed by the sim core on every
   * `TickUpdate`/`get_snapshot` response — never re-derived in the
   * frontend, so it can never disagree with what the core actually used
   * for energy refill and breeding eligibility (`SimEvent.TickUpdate`'s
   * own doc comment). */
  isNight: boolean;
  hydrated: boolean;
}

interface JarStoreActions {
  applyEvent: (event: SimEvent) => void;
  hydrate: (snapshot: {
    critters: Critter[];
    settings: JarSettings;
    sim_seconds: number;
    is_night: boolean;
  }) => void;
}

export const useJarStore = create<JarStoreState & JarStoreActions>((set) => ({
  critters: {},
  settings: DEFAULT_SETTINGS,
  simSeconds: 0,
  isNight: false,
  hydrated: false,

  hydrate: (snapshot) =>
    set({
      critters: Object.fromEntries(snapshot.critters.map((c) => [c.id, c])),
      settings: snapshot.settings,
      simSeconds: snapshot.sim_seconds,
      isNight: snapshot.is_night,
      hydrated: true,
    }),

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
              life_stage: stats.life_stage,
              alive: stats.alive,
            };
          }
          return { critters: next, simSeconds: state.simSeconds + 1, isNight: event.is_night };
        }

        // Pushed by every `set_*` command (rust-core.md §6) so a change
        // made from any window reaches every window, not just the caller.
        case 'SettingsChanged':
          return { settings: event.settings };

        case 'Renamed': {
          const existing = state.critters[event.id];
          if (!existing) return state;
          return { critters: { ...state.critters, [event.id]: { ...existing, name: event.name } } };
        }

        case 'Added':
          return { critters: { ...state.critters, [event.critter.id]: event.critter } };
      }
    }),
}));

/** One-shot notifications for things that happened at a moment in time — a
 * toast, or the trigger to spawn/despawn a Yuka vehicle — as opposed to
 * `useJarStore`'s continuously-current state. See this file's header for
 * why these are kept separate from the store. */
export type CritterEvent =
  | { kind: 'born'; child: Critter; parentA: CritterId; parentB: CritterId }
  | { kind: 'passed'; id: CritterId }
  | { kind: 'added'; critter: Critter };

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
  } else if (event.type === 'Added') {
    for (const cb of critterEventListeners) cb({ kind: 'added', critter: event.critter });
  }
  useJarStore.getState().applyEvent(event);
}

/** SPEC.md §4: the dialog theme defaults to the OS's light/dark preference
 * on first run only — `DEFAULT_SETTINGS` itself stays pinned to Rust's
 * `JarSettings::default()` (see the `DEFAULT_SETTINGS` test in
 * `jarClient.test.ts`), so this is applied at the `ensureJarClientStarted`
 * call site instead of baked into that constant. Once a jar snapshot
 * exists on disk, `start` never consults this — see `commands.rs::start`. */
function firstRunSettings(): JarSettings {
  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? { ...DEFAULT_SETTINGS, dialog_theme: 'ModernDark' } : DEFAULT_SETTINGS;
}

let startPromise: Promise<void> | null = null;

/** Idempotent — safe to call from every window's top-level effect. Only
 * actually calls the plugin's `start` command once, and only from the tank
 * window; see the multi-window note in this file's header. */
export function ensureJarClientStarted(settings: JarSettings = firstRunSettings()): Promise<void> {
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
    is_night: boolean;
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
  // camelCase to match `Toggle`'s `#[serde(rename_all = "camelCase")]` on the
  // Rust side — the PascalCase variant names it's declared with in Rust
  // source are not what serde expects over the wire.
  setToggle: (toggle: 'light' | 'ambientParticles' | 'sound' | 'alwaysOnTop', on: boolean) =>
    pluginApi.setToggle(toggle, on),
  setTheme: (theme: DialogTheme, variant: string) => pluginApi.setTheme(theme, variant),
  setFrame: (frame: TankFrame) => pluginApi.setFrame(frame),
  setLightColour: (colour: LightColour) => pluginApi.setLightColour(colour),
};
