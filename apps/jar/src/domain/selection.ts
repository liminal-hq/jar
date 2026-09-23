// Critter selection — clicking a critter (tank, tree, or phone list) opens
// one critter card and retargets it if another is already open
// (SCREENS.md W2: "One card at a time; clicking another critter retargets
// it"). Selection is broadcast as a plain Tauri app event rather than
// piped through `jarClient`'s store, since it's UI-focus state, not
// simulation state, and every window (not just the tank) needs to react to
// it — the family tree's node click does the same thing a tank click does.
//
// A freshly-created critter-card window also gets the id via its own URL
// (`openSatelliteWindow`'s `initialQuery`) — the `emit()` below still fires
// unconditionally so an *already-open* card retargets, but a new window's
// listener isn't guaranteed to be registered yet by the time that emit
// reaches it, so the URL is what the first selection actually relies on.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';

import type { CritterId } from './protocol/generated/CritterId';
import { openSatelliteWindow } from './windows';

const SELECTION_EVENT = 'jar://critter-selected';

export async function selectCritter(id: CritterId): Promise<void> {
  await openSatelliteWindow('critter-card', `critterId=${id}`);
  await emit(SELECTION_EVENT, id);
}

export function onCritterSelected(callback: (id: CritterId) => void): Promise<UnlistenFn> {
  return listen<CritterId>(SELECTION_EVENT, (e) => callback(e.payload));
}
