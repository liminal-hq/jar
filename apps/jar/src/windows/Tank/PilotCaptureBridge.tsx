// Headless — feeds `render/steering/pilotInputState.ts` from two sources:
// this window's own keyboard (when the tank happens to be focused) and key
// transitions forwarded from the Fish monitor window, where the pilot
// control actually lives (`domain/pilotInput.ts`). Both write into the same
// shared pressed-key set — deliberately simple for a debug tool, not
// namespaced per source, since a key "stuck" across a source switch
// self-heals on the next press/release either side sends.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect } from 'react';

import { usePilotedFishId } from '../../domain/devSettings';
import { onPilotKey } from '../../domain/pilotInput';
import { clearKeys, setKey, setPilotedId } from '../../render/steering/pilotInputState';

export function PilotCaptureBridge() {
  const pilotedFishId = usePilotedFishId();

  useEffect(() => {
    setPilotedId(pilotedFishId);
  }, [pilotedFishId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      setKey(e.code, true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      setKey(e.code, false);
    };
    // A held key whose keyup this window never sees (focus moved to the Fish
    // monitor window, or the OS itself, before releasing) would otherwise
    // drive the fish forever — clearing on blur is the same stuck-key
    // protection `MouseDebugCapture.tsx` applies to its own focus tracking.
    const onBlur = () => clearKeys();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    // Chained onto the promise itself (`CritterCardWindow.tsx`'s own
    // `onCritterSelected` pattern), not stashed into a captured variable for
    // the cleanup to read later — under StrictMode's mount/unmount/remount
    // double-invoke, cleanup can run before this promise resolves, and a
    // captured variable would still be `undefined` at that point, leaking
    // the first invocation's listener with nothing left able to call it.
    const unlistenPilotKey = onPilotKey((event) => {
      if ('clear' in event) {
        clearKeys();
      } else {
        setKey(event.code, event.pressed);
      }
    });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      void unlistenPilotKey.then((unlisten) => unlisten());
      clearKeys();
    };
  }, []);

  return null;
}
