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
    // This window's own contribution to the shared pressed-key set —
    // `render/steering/pilotInputState.ts`'s `pressed` set also holds keys
    // forwarded from whichever *other* window is driving (the tank's own
    // keyboard via `PilotCaptureBridge.tsx`, or this same hook running in a
    // second caller window). A blur here used to send `{ clear: true }`
    // unconditionally, which reset that ENTIRE shared set — including a key
    // still genuinely held elsewhere — the instant focus left this one
    // window, e.g. alt-tabbing to watch the tank while still driving from
    // it. Releasing only the keys *this* hook instance actually holds
    // leaves any other source's own input alone.
    const heldHere = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || !PILOT_KEY_CODES.includes(e.code)) return;
      e.preventDefault();
      heldHere.add(e.code);
      void emitPilotKey({ code: e.code, pressed: true });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!PILOT_KEY_CODES.includes(e.code)) return;
      e.preventDefault();
      heldHere.delete(e.code);
      void emitPilotKey({ code: e.code, pressed: false });
    };
    const releaseHeldHere = () => {
      heldHere.forEach((code) => void emitPilotKey({ code, pressed: false }));
      heldHere.clear();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseHeldHere);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseHeldHere);
      // Unmount (window closing or `enabled` flipping false) still does a
      // full `clear: true` — unlike blur, this is meant to fully reset the
      // pilot's control state, matching `setPilotedId`'s own `clearKeys()`
      // on the tank side for the same transition.
      void emitPilotKey({ clear: true });
    };
  }, [enabled]);
}
