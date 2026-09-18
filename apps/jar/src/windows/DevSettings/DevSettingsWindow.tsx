// Dev-only window (opened from the drawer's "Dev" button, itself only
// shown in dev builds — see `Drawer.tsx`) for toggling debugging aids
// that live in `localStorage` rather than the wire protocol
// (`domain/devSettings.ts`) — not part of SPEC.md/SCREENS.md, since
// there's nothing here a shipped build ever shows a real user.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect } from 'react';

import { DialogShell } from '../../components/DialogShell';
import { isMouseOverlayEnabled, setMouseOverlayEnabled } from '../../domain/devSettings';
import { ensureJarClientStarted } from '../../domain/jarClient';

export function DevSettingsWindow() {
  useEffect(() => {
    void ensureJarClientStarted();
  }, []);

  return (
    <DialogShell windowTitle="Dev settings" title="Dev settings">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>
          <input
            type="checkbox"
            defaultChecked={isMouseOverlayEnabled()}
            onChange={(e) => setMouseOverlayEnabled(e.target.checked)}
          />{' '}
          Mouse event debug overlay (tank window)
        </label>
      </div>
    </DialogShell>
  );
}
