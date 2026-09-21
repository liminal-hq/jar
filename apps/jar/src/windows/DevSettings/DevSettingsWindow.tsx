// Dev-only window (opened from the drawer's "Dev" button, itself only
// shown in dev builds — see `Drawer.tsx`) for toggling debugging aids that
// live in `localStorage` rather than the wire protocol
// (`domain/devSettings.ts`) — not part of SPEC.md/SCREENS.md, since
// there's nothing here a shipped build ever shows a real user. Also where
// both aids' captured data actually gets *displayed*: the tank window
// captures it (mouse events at its own boundary; live fish RigidBody
// positions), but an in-tank overlay would cover the very content it's
// meant to help debug on a window this small, so it's relayed here instead
// (`domain/debugChannel.ts`).
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useState, type CSSProperties } from 'react';

import { DialogShell } from '../../components/DialogShell';
import {
  onFishPositions,
  onMouseLogEntry,
  onMousePollState,
  type FishPositions,
  type MouseLogEntry,
} from '../../domain/debugChannel';
import {
  isFishPositionOverlayEnabled,
  isMouseOverlayEnabled,
  setFishPositionOverlayEnabled,
  setMouseOverlayEnabled,
} from '../../domain/devSettings';
import { ensureJarClientStarted } from '../../domain/jarClient';
import { TANK_INNER_BOUNDS } from '../../render/physics/coordinates';

const MOUSE_LOG_LIMIT = 12;

const panelStyle: CSSProperties = {
  background: 'rgba(0, 0, 0, 0.06)',
  borderRadius: 6,
  padding: '6px 8px',
  font: '10px monospace',
  lineHeight: 1.4,
  maxHeight: 160,
  overflow: 'auto',
};

function MouseDebugPanel() {
  const [log, setLog] = useState<MouseLogEntry[]>([]);
  const [hoverPoll, setHoverPoll] = useState<boolean | null>(null);
  const [windowFocused, setWindowFocused] = useState<boolean | null>(null);

  useEffect(() => {
    const unlistenEntry = onMouseLogEntry((entry) => {
      setLog((prev) => [entry, ...prev].slice(0, MOUSE_LOG_LIMIT));
    });
    const unlistenPoll = onMousePollState((state) => {
      setHoverPoll(state.hoverPoll);
      setWindowFocused(state.windowFocused);
    });
    return () => {
      void unlistenEntry.then((f) => f());
      void unlistenPoll.then((f) => f());
    };
  }, []);

  return (
    <div style={panelStyle}>
      <div>
        :hover poll = {String(hoverPoll)} | doc focused = {String(windowFocused)}
      </div>
      {log.map((entry, i) => (
        <div key={i}>
          +{entry.t}ms {entry.type} ({entry.x},{entry.y}) target={entry.target} related=
          {entry.related}
        </div>
      ))}
    </div>
  );
}

/** A fish's centre outside this is a fish outside the tank — the glass
 * walls (`AquariumEnvironment.tsx`) are built from this same constant, so
 * this is the real boundary, not a re-guessed one. */
const B = TANK_INNER_BOUNDS;

function isOutOfBounds(p: { x: number; y: number; z: number }): boolean {
  return Math.abs(p.x) > B.x || Math.abs(p.y) > B.y || Math.abs(p.z) > B.z;
}

function FishPositionPanel() {
  const [positions, setPositions] = useState<FishPositions>({});

  useEffect(() => {
    const unlisten = onFishPositions(setPositions);
    return () => void unlisten.then((f) => f());
  }, []);

  const ids = Object.keys(positions)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <div style={panelStyle}>
      <div>
        {ids.length} fish · bounds ±{B.x.toFixed(2)}, ±{B.y.toFixed(2)}, ±{B.z.toFixed(2)}
      </div>
      {ids.map((id) => {
        const p = positions[id]!;
        const outOfBounds = isOutOfBounds(p);
        return (
          <div key={id} style={outOfBounds ? { color: '#f66', fontWeight: 700 } : undefined}>
            #{id} {p.x.toFixed(2)}, {p.y.toFixed(2)}, {p.z.toFixed(2)}
            {outOfBounds ? ' OUT OF BOUNDS' : ''}
          </div>
        );
      })}
    </div>
  );
}

export function DevSettingsWindow() {
  const [mouseOverlayEnabled, setMouseOverlayEnabledState] = useState(isMouseOverlayEnabled);
  const [fishPositionOverlayEnabled, setFishPositionOverlayEnabledState] = useState(
    isFishPositionOverlayEnabled,
  );

  useEffect(() => {
    void ensureJarClientStarted();
  }, []);

  return (
    <DialogShell windowTitle="Dev settings" title="Dev settings">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>
          <input
            type="checkbox"
            checked={mouseOverlayEnabled}
            onChange={(e) => {
              setMouseOverlayEnabled(e.target.checked);
              setMouseOverlayEnabledState(e.target.checked);
            }}
          />{' '}
          Mouse event debug (captured in tank window)
        </label>
        {mouseOverlayEnabled && <MouseDebugPanel />}

        <label>
          <input
            type="checkbox"
            checked={fishPositionOverlayEnabled}
            onChange={(e) => {
              setFishPositionOverlayEnabled(e.target.checked);
              setFishPositionOverlayEnabledState(e.target.checked);
            }}
          />{' '}
          Fish position debug (captured in tank window)
        </label>
        {fishPositionOverlayEnabled && <FishPositionPanel />}
      </div>
    </DialogShell>
  );
}
