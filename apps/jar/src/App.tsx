// All of Jar's windows (SPEC.md §2/§3: tank, critter card, family tree,
// setup) share this one frontend bundle — Tauri points every
// `WebviewWindow` at the same `index.html`, so routing happens here by the
// current window's label rather than by URL path.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';

import { CritterCardWindow } from './windows/CritterCard/CritterCardWindow';
import { DevSettingsWindow } from './windows/DevSettings/DevSettingsWindow';
import { FamilyTreeWindow } from './windows/FamilyTree/FamilyTreeWindow';
import { FishMonitorWindow } from './windows/FishMonitor/FishMonitorWindow';
import { SetupWindow } from './windows/Setup/SetupWindow';
import { TankWindow } from './windows/Tank/TankWindow';

export function App() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    setLabel(getCurrentWindow().label);
  }, []);

  switch (label) {
    case 'critter-card':
      return <CritterCardWindow />;
    case 'family-tree':
      return <FamilyTreeWindow />;
    case 'setup':
      return <SetupWindow />;
    case 'dev-settings':
      return <DevSettingsWindow />;
    case 'fish-monitor':
      return <FishMonitorWindow />;
    case 'tank':
    // The dev server (no Tauri window context yet) falls through to the
    // tank view too, so `bun run dev` shows something meaningful.
    // eslint-disable-next-line no-fallthrough
    default:
      return <TankWindow />;
  }
}
