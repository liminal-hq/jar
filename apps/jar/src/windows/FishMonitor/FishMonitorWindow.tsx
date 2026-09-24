// Fish tuning rig (opened via the drawer's always-available "Fish monitor"
// button, `Drawer.tsx`) — a live table plus top-down and front maps of
// every fish's steering/animation state, for tuning wander/rest/pause
// behaviour against real numbers instead of guessing from screen
// recordings, and the home for the manual fish pilot's own "take over this
// one" control — you're already looking at each fish's live row here, so
// arming pilot mode belongs next to it rather than in a different window.
// Not part of SPEC.md/SCREENS.md — supplementary tooling rather than a core
// product screen, but not gated behind a dev build either: it's
// self-contained (opening it is what turns telemetry publishing on, and
// closing it resets the day/night override, and releases the pilot back to
// `'auto'`/`null` unless the fish-eye window is still watching, both via the
// mount effect below) and just as useful for a curious owner as for tuning.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState } from 'react';

import { DialogShell } from '../../components/DialogShell';
import {
  isFishEyeEnabled,
  setDayNightOverride,
  setFishMonitorEnabled,
  setPilotedFishId,
  useDayNightOverride,
  usePilotedFishId,
} from '../../domain/devSettings';
import { onFishDebug, type FishDebugEntry, type FishDebugSnapshot } from '../../domain/fishDebug';
import { ensureJarClientStarted, useJarStore } from '../../domain/jarClient';
import { usePilotKeyForwarding } from '../../domain/usePilotKeyForwarding';
import { openSatelliteWindow } from '../../domain/windows';
import { TANK_INNER_BOUNDS } from '../../render/physics/coordinates';

/** SVG viewBox units — arbitrary, each map just needs to be square-ish and
 * proportional to the tank's own footprint on its own two axes. */
const MAP_SIZE = 160;
const MAP_MARGIN = 8;

const MODE_COLOUR: Record<string, string> = {
  active: '#3fb950',
  paused: '#d29922',
  settling: '#58a6ff',
  settled: '#8b949e',
  chasing: '#f85149',
};

/** Maps a fish's position on some horizontal/vertical world-axis pair onto
 * an SVG viewBox — `hBound`/`vBound` are half-extents (`TANK_INNER_BOUNDS`),
 * so this is a straight linear remap centred on the map's own centre.
 * Higher world values always map to a smaller SVG Y (i.e. "up" on the map,
 * whether that axis is world +Z or world +Y) — this just needs to be a
 * consistent, readable layout, not a physically exact projection. */
function toMapCoords(h: number, v: number, hBound: number, vBound: number): [number, number] {
  const usable = MAP_SIZE - MAP_MARGIN * 2;
  const mapH = MAP_MARGIN + usable / 2 + (h / hBound) * (usable / 2);
  const mapV = MAP_MARGIN + usable / 2 - (v / vBound) * (usable / 2);
  return [mapH, mapV];
}

interface FishMapProps {
  title: string;
  entries: FishDebugEntry[];
  /** Extracts this map's horizontal/vertical world coordinates from a
   * fish's `pos`, and its own heading-tick direction (also
   * horizontal/vertical on this same plane) from its yaw/pitch. */
  project: (f: FishDebugEntry) => { h: number; v: number; tickH: number; tickV: number };
  hBound: number;
  vBound: number;
  /** Draws a dashed highlight ring around the piloted fish's dot, if any —
   * `null`/`undefined` (nobody piloted) draws no ring at all. */
  pilotedFishId?: number | null;
}

function FishMap({ title, entries, project, hBound, vBound, pilotedFishId }: FishMapProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ opacity: 0.6, fontSize: 11 }}>{title}</div>
      <svg
        width={MAP_SIZE}
        height={MAP_SIZE}
        viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`}
        style={{ background: 'rgba(127,127,127,0.12)', borderRadius: 6, flexShrink: 0 }}
      >
        <rect
          x={MAP_MARGIN}
          y={MAP_MARGIN}
          width={MAP_SIZE - MAP_MARGIN * 2}
          height={MAP_SIZE - MAP_MARGIN * 2}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.3}
        />
        {entries.map((f) => {
          const { h, v, tickH, tickV } = project(f);
          const [mh, mv] = toMapCoords(h, v, hBound, vBound);
          const tickX = mh + tickH * 6;
          const tickY = mv - tickV * 6;
          return (
            <g key={f.id}>
              <line
                x1={mh}
                y1={mv}
                x2={tickX}
                y2={tickY}
                stroke={MODE_COLOUR[f.mode] ?? '#fff'}
                strokeWidth={1.5}
              />
              <circle
                cx={mh}
                cy={mv}
                r={f.isResting ? 2 : 3}
                fill={`hsl(${f.hue}, 65%, 55%)`}
                stroke={MODE_COLOUR[f.mode] ?? '#fff'}
                strokeWidth={1}
              />
              {f.id === pilotedFishId && (
                <circle
                  cx={mh}
                  cy={mv}
                  r={6}
                  fill="none"
                  stroke="#fff"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function FishMonitorWindow() {
  const [snapshot, setSnapshot] = useState<FishDebugSnapshot | null>(null);
  const dayNightOverride = useDayNightOverride();
  const pilotedFishId = usePilotedFishId();
  const critters = useJarStore((s) => s.critters);
  const receivedAtRef = useRef(0);
  const [, forceRerender] = useState(0);

  useEffect(() => {
    void ensureJarClientStarted();
    // Tells the tank window's `SteeringSystem` to start (and, on unmount,
    // stop) publishing — no telemetry cost while this window isn't open.
    setFishMonitorEnabled(true);
    let unlisten: (() => void) | undefined;
    void onFishDebug((s) => {
      setSnapshot(s);
      receivedAtRef.current = performance.now();
    }).then((fn) => {
      unlisten = fn;
    });
    // A lightweight re-render tick so the "Nms ago" staleness readout below
    // updates even between snapshots (e.g. once the tank window closes and
    // publishing stops entirely).
    const tick = setInterval(() => forceRerender((n) => n + 1), 500);
    // The day/night override is a real, product-affecting setting
    // (`Fish.tsx`/`SteeringSystem.tsx` both consume it), not just a debug
    // overlay — resetting it is what keeps this window self-contained:
    // closing it always leaves the jar's own real day/night clock in
    // control again, never stuck pinned to whatever was last selected.
    // Piloting a fish is the same kind of running override — releasing it
    // here means a fish never keeps ignoring its own AI just because the
    // window that armed it happened to close. *Unless* the fish-eye window
    // is still open watching that same fish: it drives the pilot from its
    // own forwarded keyboard too (`usePilotKeyForwarding`) and has its own
    // liveness check (`FishEyeWindow.tsx`) to release the pilot later if the
    // fish itself dies — releasing unconditionally here would otherwise yank
    // the watched fish back to AI control mid-drive just because the
    // *monitor* window (not fish-eye) happened to be the one that closed.
    const resetOnClose = () => {
      setFishMonitorEnabled(false);
      setDayNightOverride('auto');
      if (!isFishEyeEnabled()) {
        setPilotedFishId(null);
      }
    };
    // The title bar's close button destroys this webview directly
    // (`TitleBar.tsx`'s `close`, `appWindow.close()`) rather than going
    // through React, so the unmount cleanup below never runs on that path —
    // `onCloseRequested` fires first regardless of how the window closes
    // (title bar, taskbar, OS shortcut), so it's the one reliable hook for
    // this reset. `@tauri-apps/api`'s own `onCloseRequested` completes the
    // close by calling `destroy()` once every listener returns without
    // `preventDefault()` — needs `core:window:allow-destroy`
    // (`capabilities/default.json`), or that final `destroy()` silently
    // fails and this fires the reset on every close attempt without the
    // window ever actually closing.
    const unlistenClose = getCurrentWindow().onCloseRequested(() => {
      resetOnClose();
    });
    return () => {
      resetOnClose();
      unlisten?.();
      void unlistenClose.then((fn) => fn());
      clearInterval(tick);
    };
  }, []);

  // Releases the pilot the moment its fish is no longer in a fresh
  // snapshot — passed or despawned mid-drive, most likely — rather than
  // leaving `pilotedFishId` pointed at a fish that no longer exists.
  // Guarded on `snapshot` actually being present so a momentarily-stopped
  // publisher (e.g. the tank window itself closing) can't be mistaken for
  // "the fish is gone" and release a pilot that's still perfectly valid.
  useEffect(() => {
    if (pilotedFishId === null || !snapshot) return;
    if (!snapshot.entries.some((f) => f.id === pilotedFishId)) {
      setPilotedFishId(null);
    }
  }, [snapshot, pilotedFishId]);

  // While a fish is piloted, this window's own keyboard drives it too —
  // shared with the fish-eye window (`domain/usePilotKeyForwarding.ts`),
  // which also scopes its blur handler to release only the keys *this*
  // window holds, not the entire cross-window pressed-key set.
  usePilotKeyForwarding(pilotedFishId !== null);

  const staleMs = snapshot ? performance.now() - receivedAtRef.current : null;

  return (
    <DialogShell windowTitle="Fish monitor" title="Fish monitor">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, font: '12px monospace' }}>
        <div
          style={{
            display: 'flex',
            gap: 12,
            font: '13px "Nunito", sans-serif',
            alignItems: 'center',
          }}
        >
          <span style={{ opacity: 0.7 }}>Day/night:</span>
          {(['auto', 'day', 'night'] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="dayNightOverride"
                checked={dayNightOverride === value}
                onChange={() => setDayNightOverride(value)}
              />{' '}
              {value === 'auto' ? 'Auto' : value === 'day' ? 'Always day' : 'Always night'}
            </label>
          ))}
        </div>

        {!snapshot && <div>Waiting for the tank window to publish…</div>}

        {snapshot && (
          <>
            <div style={{ color: staleMs !== null && staleMs > 2000 ? '#d29922' : undefined }}>
              {snapshot.entries.length} fish · sim {Math.round(snapshot.simSeconds)}s ·{' '}
              {snapshot.isNight ? 'night' : 'day'}
              {staleMs !== null && staleMs > 2000 ? ` · stale (${Math.round(staleMs)}ms)` : ''}
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <FishMap
                  title="Top-down (X/Z)"
                  entries={snapshot.entries}
                  hBound={TANK_INNER_BOUNDS.x}
                  vBound={TANK_INNER_BOUNDS.z}
                  pilotedFishId={pilotedFishId}
                  project={(f) => {
                    const rad = (f.yawDeg * Math.PI) / 180;
                    return {
                      h: f.pos[0],
                      v: f.pos[2],
                      tickH: Math.sin(rad),
                      tickV: Math.cos(rad),
                    };
                  }}
                />
                <FishMap
                  title="Front (X/Y)"
                  entries={snapshot.entries}
                  hBound={TANK_INNER_BOUNDS.x}
                  vBound={TANK_INNER_BOUNDS.y}
                  pilotedFishId={pilotedFishId}
                  project={(f) => {
                    const yawRad = (f.yawDeg * Math.PI) / 180;
                    const pitchRad = (f.pitchDeg * Math.PI) / 180;
                    return {
                      h: f.pos[0],
                      v: f.pos[1],
                      tickH: Math.sin(yawRad) * Math.cos(pitchRad),
                      tickV: Math.sin(pitchRad),
                    };
                  }}
                />
              </div>

              <div style={{ overflowY: 'auto', maxHeight: MAP_SIZE * 2 + 20, flex: 1 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', opacity: 0.7 }}>
                      <th>id</th>
                      <th>name</th>
                      <th>mode</th>
                      <th>rest</th>
                      <th>speed</th>
                      <th title="Peak turn rate over the last ~1s, not instantaneous">turn (pk)</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.entries.map((f) => {
                      const isPiloted = f.id === pilotedFishId;
                      return (
                        <tr
                          key={f.id}
                          style={isPiloted ? { background: 'rgba(88, 166, 255, 0.15)' } : undefined}
                        >
                          <td>
                            <span
                              style={{
                                display: 'inline-block',
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: `hsl(${f.hue}, 65%, 55%)`,
                                marginRight: 4,
                              }}
                            />
                            {f.id}
                          </td>
                          <td>{critters[f.id]?.name ?? '—'}</td>
                          <td style={{ color: MODE_COLOUR[f.mode] }}>{f.mode}</td>
                          <td>{f.isResting ? '●' : ''}</td>
                          <td>{f.speed.toFixed(2)}</td>
                          <td>{f.turnRate.toFixed(1)}</td>
                          <td style={{ display: 'flex', gap: 4 }}>
                            <button
                              style={{ font: 'inherit' }}
                              onClick={() => setPilotedFishId(isPiloted ? null : f.id)}
                            >
                              {isPiloted ? 'Release' : 'Pilot'}
                            </button>
                            <button
                              style={{ font: 'inherit' }}
                              title="Pilot this fish and open the fish-eye window watching it"
                              onClick={() => {
                                setPilotedFishId(f.id);
                                void openSatelliteWindow('fish-eye');
                              }}
                            >
                              Watch
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div
              style={{
                font: '12px "Nunito", sans-serif',
                opacity: pilotedFishId === null ? 0.6 : 1,
              }}
            >
              {pilotedFishId === null ? (
                'Pilot a fish from its row to drive it manually.'
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div>
                    Piloting: {critters[pilotedFishId]?.name ?? '—'} (#{pilotedFishId}){' '}
                    <button style={{ font: 'inherit' }} onClick={() => setPilotedFishId(null)}>
                      Release
                    </button>
                  </div>
                  <div style={{ font: '11px monospace', opacity: 0.7 }}>
                    W/S forward/back · A/D turn · R/F up/down
                  </div>
                  <div style={{ opacity: 0.5 }}>Keys work in this window or the tank.</div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </DialogShell>
  );
}
