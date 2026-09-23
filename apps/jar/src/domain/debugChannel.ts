// Cross-window relay for dev-only debug instrumentation: mouse events at
// the tank window's own boundary (`components/MouseDebugCapture.tsx`) and
// live fish RigidBody positions (`render/steering/SteeringSystem.tsx`) are
// both captured *in the tank window*, but displayed in a separate
// `dev-settings` window (`windows/DevSettings/DevSettingsWindow.tsx`) rather
// than an in-tank overlay — a window this small can't afford to have its own
// content covered by the very debug text meant to help diagnose it. Plain
// Tauri app events, the same mechanism `domain/selection.ts` uses for its
// own cross-window signal — each window is its own JS realm
// (`jarClient.ts`'s header), so a module-level store can't bridge them.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';

import type { CritterId } from './protocol/generated/CritterId';

const FISH_POSITIONS_EVENT = 'jar://debug-fish-positions';
const MOUSE_ENTRY_EVENT = 'jar://debug-mouse-entry';
const MOUSE_POLL_EVENT = 'jar://debug-mouse-poll';

export type FishPositions = Record<CritterId, { x: number; y: number; z: number }>;

export function publishFishPositions(positions: FishPositions): void {
  void emit(FISH_POSITIONS_EVENT, positions);
}

export function onFishPositions(cb: (positions: FishPositions) => void): Promise<UnlistenFn> {
  return listen<FishPositions>(FISH_POSITIONS_EVENT, (e) => cb(e.payload));
}

export interface MouseLogEntry {
  type: string;
  x: number;
  y: number;
  target: string;
  related: string;
  t: number;
}

export function publishMouseLogEntry(entry: MouseLogEntry): void {
  void emit(MOUSE_ENTRY_EVENT, entry);
}

export function onMouseLogEntry(cb: (entry: MouseLogEntry) => void): Promise<UnlistenFn> {
  return listen<MouseLogEntry>(MOUSE_ENTRY_EVENT, (e) => cb(e.payload));
}

export interface MousePollState {
  hoverPoll: boolean | null;
  windowFocused: boolean | null;
}

export function publishMousePollState(state: MousePollState): void {
  void emit(MOUSE_POLL_EVENT, state);
}

export function onMousePollState(cb: (state: MousePollState) => void): Promise<UnlistenFn> {
  return listen<MousePollState>(MOUSE_POLL_EVENT, (e) => cb(e.payload));
}
