// Custom desktop window title bar for the setup, critter card, and family
// tree windows — ported from Cadence/Threshold's `components/TitleBar`,
// re-themed onto Jar's `--jar-*` tokens instead of those apps' own chrome
// variables. The tank window (W1) doesn't use this: its frameless bezel is
// its only chrome by design (SCREENS.md), with its own drag region.
//
// Replaces OS window decorations entirely (`decorations: false` on these
// windows' `WebviewWindow` specs, `domain/windows.ts`) with per-platform
// controls matching the host OS's own convention — mac traffic lights,
// Windows square buttons on the right, Linux (Adwaita-style) round buttons
// on the right. SPEC.md §4's per-theme title-bar treatments (Classic 98's
// blue gradient + square buttons, Paper notebook's italic title, Handheld
// LCD's dark strip) live in `TitleBar.module.css`, keyed off the
// `data-dialog-theme` attribute `theme/theme.ts` sets on `<html>`.
//
// Right-click opens a context menu (move/minimize/maximize/close) — a
// fallback for when the drag region or buttons themselves are an awkward
// target, matching Cadence/Threshold. Its "Move" action calls
// `startDragging()` explicitly, distinct from the passive
// `data-tauri-drag-region` the bar itself relies on for a direct drag.
//
// `data-tauri-drag-region` doesn't propagate to children or cascade from
// an ancestor: Tauri's drag detection checks the exact element clicked,
// so every draggable region — the outer bar, the inner spacer/title
// elements, and the platform-mirroring `.controlsPlaceholder` — carries
// the attribute itself rather than relying on inheriting it from a
// parent. The window control buttons still work nested inside the outer
// bar's own copy of the attribute: a click that never moves the pointer
// resolves as a click, not a drag, under normal window-manager
// semantics.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { getCurrentWindow } from '@tauri-apps/api/window';
import { platform, version } from '@tauri-apps/plugin-os';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useState } from 'react';

import { ContextMenu } from './ContextMenu/ContextMenu';
import type { MenuModel, MenuPosition } from './ContextMenu/types';
import {
  WindowCloseIcon,
  WindowMaximizeIcon,
  WindowMinimizeIcon,
  WindowRestoreIcon,
} from './Icons';
import styles from './TitleBar.module.css';

type PlatformType = 'mac' | 'linux' | 'win';

const PLATFORM_CLASS: Record<PlatformType, string> = {
  mac: 'isMac',
  linux: 'isLinux',
  win: 'isWin',
};

interface TitleBarProps {
  title: string;
}

export function TitleBar({ title }: TitleBarProps) {
  const [platformType, setPlatformType] = useState<PlatformType>('linux');
  const [isMaximized, setIsMaximized] = useState(false);
  const [isMaximizable, setIsMaximizable] = useState(false);
  const [isMinimizable, setIsMinimizable] = useState(true);
  const [isResizable, setIsResizable] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ x: 0, y: 0 });

  const appWindow = getCurrentWindow();

  // A selector hook, matching theme.ts's data-dialog-theme pattern —
  // DialogShell.module.css uses it to drop the theme's corner radius while
  // maximized, since a maximized window filling the work area shouldn't
  // clip its own corners into transparent notches.
  const applyMaximized = (maximized: boolean) => {
    setIsMaximized(maximized);
    document.documentElement.dataset.maximized = String(maximized);
  };

  useEffect(() => {
    const os = platform();
    const detected = os === 'macos' ? 'mac' : os === 'linux' ? 'linux' : 'win';
    setPlatformType(detected);
    document.documentElement.dataset.platform = detected;
    // A selector hook, matching `applyMaximized`'s `data-maximized` below —
    // `DialogShell.module.css` uses it to drop its own CSS corner-radius
    // only here, where `domain/windows.ts`'s `shadow: true` already gives
    // undecorated windows native DWM rounding (see that file's comment);
    // layering the CSS radius on top there would clip against a second,
    // not-quite-matching curve instead of one clean one. Windows 11 kept
    // Windows 10's `10.0.x` version string, distinguished only by build
    // number — builds 22000+ are Windows 11, so a plain platform check
    // would also (wrongly) square off every Windows 10 window's corners,
    // since DWM only grants that native rounding from build 22000 on.
    const isWindows11 =
      detected === 'win' && (parseInt(version().split('.')[2] ?? '', 10) || 0) >= 22000;
    document.documentElement.dataset.dwmRoundedCorners = String(isWindows11);

    const updateState = async () => {
      try {
        const [maximized, maximizable, minimizable, resizable] = await Promise.all([
          appWindow.isMaximized(),
          appWindow.isMaximizable(),
          appWindow.isMinimizable(),
          appWindow.isResizable(),
        ]);
        applyMaximized(maximized);
        setIsMaximizable(maximizable);
        setIsMinimizable(minimizable);
        setIsResizable(resizable);
      } catch (e) {
        console.error('Failed to check window state', e);
      }
    };

    void updateState();
    const unlistenPromise = appWindow.listen('tauri://resize', () => void updateState());
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
    // `appWindow` is a fresh object each render (getCurrentWindow() doesn't
    // memoize) but always refers to the same underlying window for the
    // lifetime of this component — safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const minimize = () => void appWindow.minimize();
  const toggleMaximize = async () => {
    try {
      await appWindow.toggleMaximize();
      applyMaximized(await appWindow.isMaximized());
    } catch (e) {
      console.error('Failed to toggle maximize', e);
    }
  };
  const close = () => void appWindow.close();

  const handleContextMenu = async (e: ReactMouseEvent) => {
    e.preventDefault();
    try {
      applyMaximized(await appWindow.isMaximized());
    } catch (err) {
      console.error(err);
    }
    setMenuPosition({ x: e.clientX, y: e.clientY });
    setMenuOpen(true);
  };

  const handleMenuAction = (itemId: string) => {
    switch (itemId) {
      case 'restore':
      case 'maximize':
        void toggleMaximize();
        break;
      case 'minimize':
        minimize();
        break;
      case 'move':
        void appWindow.startDragging();
        break;
      case 'close':
        close();
        break;
    }
    setMenuOpen(false);
  };

  const menuModel: MenuModel = {
    sections: [
      {
        items: [
          ...(isMaximizable && isResizable
            ? [
                {
                  id: isMaximized ? 'restore' : 'maximize',
                  label: isMaximized ? 'Restore' : 'Maximize',
                  icon: isMaximized ? 'WindowRestoreIcon' : 'WindowMaximizeIcon',
                },
              ]
            : []),
          ...(isMinimizable
            ? [{ id: 'minimize', label: 'Minimize', icon: 'WindowMinimizeIcon' }]
            : []),
        ],
      },
      { items: [{ id: 'move', label: 'Move', icon: 'MoveIcon' }] },
      { items: [{ id: 'close', label: 'Close', icon: 'WindowCloseIcon' }] },
    ],
  };

  const MacControls = () => (
    <div className={`${styles.windowControls} ${styles.mac}`}>
      <button
        onClick={close}
        className={`${styles.controlButton} ${styles.macClose}`}
        title="Close"
      />
      {isMinimizable && (
        <button
          onClick={minimize}
          className={`${styles.controlButton} ${styles.macMinimize}`}
          title="Minimize"
        />
      )}
      {isMaximizable && isResizable && (
        <button
          onClick={() => void toggleMaximize()}
          className={`${styles.controlButton} ${styles.macMaximize}`}
          title={isMaximized ? 'Restore' : 'Maximize'}
        />
      )}
    </div>
  );

  const WinControls = () => (
    <div className={`${styles.windowControls} ${styles.win}`}>
      {isMinimizable && (
        <button
          onClick={minimize}
          className={`${styles.controlButton} ${styles.winMinimize}`}
          title="Minimize"
        >
          <WindowMinimizeIcon />
        </button>
      )}
      {isMaximizable && isResizable && (
        <button
          onClick={() => void toggleMaximize()}
          className={`${styles.controlButton} ${styles.winMaximize}`}
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? <WindowRestoreIcon /> : <WindowMaximizeIcon />}
        </button>
      )}
      <button
        onClick={close}
        className={`${styles.controlButton} ${styles.winClose}`}
        title="Close"
      >
        <WindowCloseIcon />
      </button>
    </div>
  );

  const LinuxControls = () => (
    <div className={`${styles.windowControls} ${styles.linux}`}>
      {isMinimizable && (
        <button
          onClick={minimize}
          className={`${styles.controlButton} ${styles.linuxMinimize}`}
          title="Minimize"
        >
          <WindowMinimizeIcon />
        </button>
      )}
      {isMaximizable && isResizable && (
        <button
          onClick={() => void toggleMaximize()}
          className={`${styles.controlButton} ${styles.linuxMaximize}`}
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? <WindowRestoreIcon /> : <WindowMaximizeIcon />}
        </button>
      )}
      <button
        onClick={close}
        className={`${styles.controlButton} ${styles.linuxClose}`}
        title="Close"
      >
        <WindowCloseIcon />
      </button>
    </div>
  );

  return (
    <>
      <div
        className={`${styles.titleBar} ${styles[PLATFORM_CLASS[platformType]]}`}
        data-tauri-drag-region
        onContextMenu={(e) => void handleContextMenu(e)}
      >
        {platformType === 'mac' && (
          <>
            <MacControls />
            <div className={styles.dragRegion} data-tauri-drag-region />
            <div className={styles.appTitle} data-tauri-drag-region>
              {title}
            </div>
            <div className={styles.dragRegion} data-tauri-drag-region />
            <div className={styles.controlsPlaceholder} data-tauri-drag-region />
          </>
        )}

        {platformType === 'linux' && (
          <>
            <div className={styles.controlsPlaceholder} data-tauri-drag-region />
            <div className={styles.dragRegion} data-tauri-drag-region />
            <div className={styles.appTitle} data-tauri-drag-region>
              {title}
            </div>
            <div className={styles.dragRegion} data-tauri-drag-region />
            <LinuxControls />
          </>
        )}

        {platformType === 'win' && (
          <>
            <div className={`${styles.appTitle} ${styles.left}`} data-tauri-drag-region>
              {title}
            </div>
            <div className={styles.dragRegion} data-tauri-drag-region />
            <WinControls />
          </>
        )}
      </div>

      {menuOpen && (
        <ContextMenu
          model={menuModel}
          position={menuPosition}
          onClose={() => setMenuOpen(false)}
          onItemClick={handleMenuAction}
        />
      )}
    </>
  );
}
