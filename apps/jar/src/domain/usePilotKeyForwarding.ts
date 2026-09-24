// Shared by any window besides the tank that wants to drive the manual
// fish pilot from its own keyboard — the Fish monitor window
// (`windows/FishMonitor/FishMonitorWindow.tsx`) and the fish-eye window
// (`windows/FishEye/FishEyeWindow.tsx`) both use this. Forwards key
// transitions to the tank window (`windows/Tank/PilotCaptureBridge.tsx`)
// over `domain/pilotInput.ts` rather than mutating
// `render/steering/pilotInputState.ts` directly, since that module is
// realm-local (each window's bundle gets its own copy) and the Yuka
// vehicles only exist in the tank's realm.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect } from 'react';

import { emitPilotKey } from './pilotInput';
import { PILOT_KEY_CODES } from '../render/steering/pilotInputState';

/** `enabled`: only capture keys while a fish is actually piloted — a
 * caller typically passes `pilotedFishId !== null`. `preventDefault()` on
 * the six mapped keys keeps them from also scrolling/interacting with
 * whatever's underneath. */
export function usePilotKeyForwarding(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || !PILOT_KEY_CODES.includes(e.code)) return;
      e.preventDefault();
      void emitPilotKey({ code: e.code, pressed: true });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!PILOT_KEY_CODES.includes(e.code)) return;
      e.preventDefault();
      void emitPilotKey({ code: e.code, pressed: false });
    };
    const onBlur = () => void emitPilotKey({ clear: true });

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      void emitPilotKey({ clear: true });
    };
  }, [enabled]);
}
