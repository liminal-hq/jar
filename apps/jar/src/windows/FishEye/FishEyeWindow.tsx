// First-person "fish eye" view (opened via a "Watch" link next to a fish's
// own row in the Tank monitor window, `windows/TankMonitor/TankMonitorWindow.tsx`)
// — a second, independent 3D scene (`FishEyeScene.tsx`) with the camera
// glued to whichever fish is currently piloted, driven by a dedicated
// ~30Hz pose broadcast (`domain/fishPose.ts`) rather than the Tank
// monitor's own 5Hz telemetry, which is too coarse to drive a camera
// smoothly. Not part of SPEC.md/SCREENS.md — supplementary tooling, same
// stance as Tank monitor: opening it is what turns pose publishing on, and
// closing it turns it back off.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { DialogShell } from '../../components/DialogShell';
import {
  isTankMonitorEnabled,
  setFishEyeEnabled,
  setPilotedFishId,
  usePilotedFishId,
} from '../../domain/devSettings';
import { onFishPoses, type FishPoseSnapshot } from '../../domain/fishPose';
import { ensureJarClientStarted, useJarStore } from '../../domain/jarClient';
import { usePilotKeyForwarding } from '../../domain/usePilotKeyForwarding';
import { FishEyeScene, type PoseBuffer } from './FishEyeScene';

const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: 16,
  font: '13px "Nunito", sans-serif',
  opacity: 0.7,
  pointerEvents: 'none',
};

function sameIds(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export function FishEyeWindow() {
  const pilotedFishId = usePilotedFishId();
  const critters = useJarStore((s) => s.critters);

  // Lets the window stay useful even with nobody piloted right now — a
  // manual pick from whatever's currently alive. The piloted fish always
  // wins once one exists (see `cameraFishId` below); this is purely a
  // fallback default view.
  const [manualPick, setManualPick] = useState<number | null>(null);
  const cameraFishId = pilotedFishId ?? manualPick;

  // Not React state — a 30Hz pose stream re-rendering this component that
  // often would be pure waste. `FishEyeScene`'s own `useFrame` reads this
  // ref directly every frame instead.
  const posesRef = useRef<PoseBuffer>({ prev: null, curr: null, receivedAtMs: 0 });
  // The *set* of fish ids currently posed, kept as real state specifically
  // so React knows when to mount/unmount a `<Tankmate>` — updated only when
  // the id set actually changes (a fish born/passed), not on every 30Hz
  // snapshot, which would otherwise thrash this component's render loop for
  // no visual benefit (position/orientation updates happen imperatively in
  // `FishEyeScene`'s own frame loop, not via React state).
  const [tankmateIds, setTankmateIds] = useState<number[]>([]);

  useEffect(() => {
    void ensureJarClientStarted();
    setFishEyeEnabled(true);

    let unlisten: (() => void) | undefined;
    void onFishPoses((snapshot: FishPoseSnapshot) => {
      posesRef.current = {
        prev: posesRef.current.curr,
        curr: snapshot,
        receivedAtMs: performance.now(),
      };
      const ids = snapshot.poses.map((p) => p.id).sort((a, b) => a - b);
      setTankmateIds((prev) => (sameIds(prev, ids) ? prev : ids));
    }).then((fn) => {
      unlisten = fn;
    });

    // Mirrors `TankMonitorWindow.tsx`'s own check in the other direction:
    // closing fish-eye alone shouldn't yank a fish back to AI control while
    // the monitor window is still open and actively driving it — only
    // release the pilot here when the monitor isn't around to own that
    // responsibility itself. Without this, a fish opened only from here
    // (Tank monitor already closed) would stay "piloted" forever once this
    // window closes too, with neither window left to ever release it.
    const resetOnClose = () => {
      setFishEyeEnabled(false);
      if (!isTankMonitorEnabled()) {
        setPilotedFishId(null);
      }
    };
    // Same rationale as `TankMonitorWindow.tsx`'s own `onCloseRequested`
    // hook — the title bar's close button destroys this webview directly,
    // bypassing the unmount cleanup below, so `onCloseRequested` is the one
    // reliable hook regardless of how the window closes.
    const unlistenClose = getCurrentWindow().onCloseRequested(() => {
      resetOnClose();
    });
    return () => {
      resetOnClose();
      unlisten?.();
      void unlistenClose.then((fn) => fn());
    };
  }, []);

  // Lets this window's own keyboard drive the piloted fish too, same as
  // the Tank monitor window.
  usePilotKeyForwarding(pilotedFishId !== null);

  // Releases a camera target the instant its fish is no longer alive —
  // passed or despawned, most likely. `TankMonitorWindow.tsx` runs its own
  // version of this for `pilotedFishId`, but only while it's actually
  // mounted, and closing it no longer force-releases the pilot while this
  // window is still watching (see `TankMonitorWindow.tsx`'s own
  // `resetOnClose`) — so a fish that dies with only this window open would
  // otherwise freeze the camera on its last known pose forever, with no way
  // back to the picker. Covers `manualPick` too, which has no other
  // liveness check anywhere.
  useEffect(() => {
    if (cameraFishId === null) return;
    if (critters[cameraFishId]?.alive) return;
    if (pilotedFishId === cameraFishId) {
      setPilotedFishId(null);
    } else {
      setManualPick(null);
    }
  }, [cameraFishId, critters, pilotedFishId]);

  const livingFish = useMemo(
    () =>
      Object.values(critters)
        .filter((c) => c.alive && c.species === 'Fish')
        .sort((a, b) => a.id - b.id),
    [critters],
  );

  return (
    <DialogShell windowTitle="Fish eye" title="Fish eye">
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '4 / 3',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--jar-preview-bg, rgba(0, 0, 0, 0.06))',
        }}
      >
        <FishEyeScene posesRef={posesRef} cameraFishId={cameraFishId} tankmateIds={tankmateIds} />
        {cameraFishId === null && (
          <div style={overlayStyle}>
            Pilot a fish from the Tank monitor window, or pick one below, to watch through its eyes.
          </div>
        )}
      </div>
      <div style={{ marginTop: 10, font: '13px "Nunito", sans-serif' }}>
        {pilotedFishId !== null ? (
          <span style={{ opacity: 0.7 }}>
            Watching {critters[pilotedFishId]?.name ?? '—'} (#{pilotedFishId}) — piloted from the
            Tank monitor window.
          </span>
        ) : (
          <label>
            Watch:{' '}
            <select
              value={manualPick ?? ''}
              onChange={(e) => setManualPick(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— pick a fish —</option>
              {livingFish.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (#{c.id})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </DialogShell>
  );
}
