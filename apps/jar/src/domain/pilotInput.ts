// Cross-window key-event bridge for the manual fish pilot — the Tank
// monitor window (`windows/TankMonitor/TankMonitorWindow.tsx`) is where the
// pilot control lives, but the tank window is where the Yuka vehicles
// actually run, so key transitions captured in the monitor get forwarded
// here for `PilotCaptureBridge.tsx` to fold into the shared pilot input
// state (`render/steering/pilotInputState.ts`). Discrete key transitions
// only — a few events per second while actively driving, nothing like the
// 5Hz/30Hz telemetry channels (`critterDebug.ts`) — so this is cheap on the
// Tauri event bridge even though it crosses windows.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';

const PILOT_KEY_EVENT = 'jar://pilot-key';

export type PilotKeyEvent = { code: string; pressed: boolean } | { clear: true };

export async function emitPilotKey(event: PilotKeyEvent): Promise<void> {
  await emit(PILOT_KEY_EVENT, event);
}

export function onPilotKey(callback: (event: PilotKeyEvent) => void): Promise<UnlistenFn> {
  return listen<PilotKeyEvent>(PILOT_KEY_EVENT, (e) => callback(e.payload));
}
