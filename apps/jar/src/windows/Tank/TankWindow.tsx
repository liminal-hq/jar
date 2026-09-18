// W1 · Tank (SCREENS.md). No OS chrome — the frame bezel below is the only
// window decoration, and it doubles as the Tauri drag region. The tank
// *interior* is a 3D scene (`docs/architecture/3d-engine.md`); only the
// bezel, drawer, toasts and status chip here are flat HTML/CSS.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { useEffect, useMemo, useState } from 'react';

import { Drawer } from '../../components/Drawer';
import { ToastLayer } from '../../components/Toast';
import { ensureJarClientStarted, useJarStore } from '../../domain/jarClient';
import { TankScene } from '../../render/tank/TankScene';
import { applyDialogTheme, applyTankFrame } from '../../theme/theme';
import styles from './TankWindow.module.css';

/** How much wider the window grows to fit the drawer open (SCREENS.md W1) —
 * see `Drawer.tsx` for the button list this needs to comfortably fit
 * ("Switch to gecko" is the long pole), plus its own padding. */
const DRAWER_WIDTH = 180;

export function TankWindow() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The tank's own pixel width, captured right before growing the window
  // for the drawer and pinned via inline style while it's open — without
  // this the 3D scene's container would stretch to fill the wider window
  // too, resizing/reflowing the tank contents on every hover instead of
  // just exposing a new strip on the right for the drawer to occupy.
  const [tankWidth, setTankWidth] = useState<number | null>(null);
  const settings = useJarStore((s) => s.settings);
  const critters = useJarStore((s) => s.critters);
  const hydrated = useJarStore((s) => s.hydrated);

  useEffect(() => {
    void ensureJarClientStarted();
  }, []);

  useEffect(() => {
    applyDialogTheme(settings.dialog_theme, settings.theme_variants[settings.dialog_theme]);
    applyTankFrame(settings.frame);
  }, [settings.dialog_theme, settings.theme_variants, settings.frame]);

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

  // Growing/shrinking the window itself, not moving a second window, is
  // deliberate: Wayland lets a client resize its own window freely, but
  // (confirmed live, not just documentation) silently refuses a client's
  // request to reposition an *existing* window after creation — a
  // hover-positioned floating drawer window is a dead end here. Resizing
  // the tank window right and pinning its own content width instead sits
  // entirely inside what Wayland actually allows a client to do.
  const openDrawer = async () => {
    if (drawerOpen) return;
    const win = getCurrentWindow();
    const [scale, size] = await Promise.all([win.scaleFactor(), win.outerSize()]);
    const width = size.width / scale;
    const height = size.height / scale;
    setTankWidth(width);
    setDrawerOpen(true);
    await win.setSize(new LogicalSize(width + DRAWER_WIDTH, height));
  };

  const closeDrawer = async () => {
    if (!drawerOpen || tankWidth === null) return;
    const win = getCurrentWindow();
    const [scale, size] = await Promise.all([win.scaleFactor(), win.outerSize()]);
    setDrawerOpen(false);
    await win.setSize(new LogicalSize(tankWidth, size.height / scale));
  };

  return (
    <div
      className={styles.bezel}
      data-tauri-drag-region
      onMouseEnter={() => void openDrawer()}
      onMouseLeave={() => void closeDrawer()}
    >
      <div
        className={styles.tankInterior}
        style={tankWidth !== null ? { flex: `0 0 ${tankWidth}px` } : undefined}
      >
        <TankScene />
        <ToastLayer />
        <div className={styles.statusChip}>{statusText}</div>
      </div>

      {drawerOpen && (
        <div className={styles.drawerArea}>
          <Drawer />
        </div>
      )}
    </div>
  );
}
