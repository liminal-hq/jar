// W1 · Tank (SCREENS.md). No OS chrome — the frame bezel below is the only
// window decoration, and it doubles as the Tauri drag region. The tank
// *interior* is a 3D scene (`docs/architecture/3d-engine.md`); only the
// bezel, drawer, toasts and status chip here are flat HTML/CSS.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useMemo, useState } from 'react';

import { Drawer } from '../../components/Drawer';
import { ToastLayer } from '../../components/Toast';
import { ensureJarClientStarted, useJarStore } from '../../domain/jarClient';
import { TankScene } from '../../render/tank/TankScene';
import { applyDialogTheme, applyTankFrame } from '../../theme/theme';
import styles from './TankWindow.module.css';

export function TankWindow() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const settings = useJarStore((s) => s.settings);
  const critters = useJarStore((s) => s.critters);
  const hydrated = useJarStore((s) => s.hydrated);

  useEffect(() => {
    void ensureJarClientStarted();
  }, []);

  useEffect(() => {
    applyDialogTheme(settings.dialog_theme);
    applyTankFrame(settings.frame);
  }, [settings.dialog_theme, settings.frame]);

  useEffect(() => {
    // `settings.always_on_top` (SPEC.md §6) is a fact about the window,
    // not just a stored preference — keep the OS-level window flag in sync
    // with it whenever it changes, from any window.
    void getCurrentWindow().setAlwaysOnTop(settings.always_on_top);
  }, [settings.always_on_top]);

  const statusText = useMemo(() => {
    if (!hydrated) return 'loading…';
    const livingCount = Object.values(critters).filter(
      (c) => c.alive && c.species === settings.mode,
    ).length;
    const label = settings.mode === 'Fish' ? 'fish' : 'gecko';
    return `${livingCount} ${label}`;
  }, [critters, hydrated, settings.mode]);

  return (
    <div
      className={styles.bezel}
      data-tauri-drag-region
      onMouseEnter={() => setDrawerOpen(true)}
      onMouseLeave={() => setDrawerOpen(false)}
    >
      <div className={styles.tankInterior}>
        <TankScene />
      </div>

      <ToastLayer />

      {drawerOpen && (
        <div className={styles.drawer}>
          <Drawer />
        </div>
      )}

      <div className={styles.statusChip}>{statusText}</div>
    </div>
  );
}
