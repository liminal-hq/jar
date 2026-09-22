// Fish tuning rig (opened via the drawer's always-available "Fish monitor"
// button, `Drawer.tsx`) — a live table plus top-down and front maps of
// every fish's steering/animation state, for tuning wander/rest/pause
// behaviour against real numbers instead of guessing from screen
// recordings. Not part of SPEC.md/SCREENS.md — supplementary tooling
// rather than a core product screen, but not gated behind a dev build
// either: it's self-contained (opening it is what turns telemetry
// publishing on, via the mount effect below) and just as useful for a
// curious owner as for tuning.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useRef, useState } from 'react';

import { DialogShell } from '../../components/DialogShell';
import {
  setDayNightOverride,
  setFishMonitorEnabled,
  useDayNightOverride,
} from '../../domain/devSettings';
import { onFishDebug, type FishDebugEntry, type FishDebugSnapshot } from '../../domain/fishDebug';
import { ensureJarClientStarted } from '../../domain/jarClient';
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
}

function FishMap({ title, entries, project, hBound, vBound }: FishMapProps) {
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
    return () => {
      setFishMonitorEnabled(false);
      unlisten?.();
      clearInterval(tick);
    };
  }, []);

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
                      <th>mode</th>
                      <th>rest</th>
                      <th>speed</th>
                      <th title="Peak turn rate over the last ~1s, not instantaneous">turn (pk)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.entries.map((f) => (
                      <tr key={f.id}>
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
                        <td style={{ color: MODE_COLOUR[f.mode] }}>{f.mode}</td>
                        <td>{f.isResting ? '●' : ''}</td>
                        <td>{f.speed.toFixed(2)}</td>
                        <td>{f.turnRate.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </DialogShell>
  );
}
