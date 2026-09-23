// Shared wrapper for the setup, critter card, and family tree windows
// (SCREENS.md W2-W4). Each satellite window is its own JS realm (see
// `domain/jarClient.ts`'s header) so each mounts its own `DialogShell`
// instance, applying `settings.dialog_theme` to its own `document` the same
// way `TankWindow` applies it to the tank's.
//
// Also mounts `TitleBar` (windowTitle) — these three windows run with
// `decorations: false` (`domain/windows.ts`) specifically so this custom
// bar, not the OS's, is what they show.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { getCurrentWindow } from '@tauri-apps/api/window';
import type { ReactNode } from 'react';
import { useEffect } from 'react';

import { useJarStore } from '../domain/jarClient';
import { applyDialogTheme } from '../theme/theme';
import styles from './DialogShell.module.css';
import { TitleBar } from './TitleBar';

interface DialogShellProps {
  /** The window's own static identity (SPEC.md §2), shown in `TitleBar` —
   * distinct from `title` below, which is dynamic page content (a critter's
   * name, "N ever") and may differ from it. */
  windowTitle: string;
  title?: ReactNode;
  children: ReactNode;
}

export function DialogShell({ windowTitle, title, children }: DialogShellProps) {
  const theme = useJarStore((s) => s.settings.dialog_theme);
  const variant = useJarStore((s) => s.settings.theme_variants[s.settings.dialog_theme]);

  useEffect(() => {
    const { isDark } = applyDialogTheme(theme, variant);
    // Tells the OS window server the app's actual light/dark mode — every
    // platform's native, app-content-blind chrome (context menus, and on
    // Windows the DWM border/shadow colour `domain/windows.ts`'s
    // `shadow: true` gives these windows) otherwise defaults to light
    // regardless of the app's own selected theme.
    void getCurrentWindow().setTheme(isDark ? 'dark' : 'light');
  }, [theme, variant]);

  return (
    <div className={styles.wrapper}>
      <TitleBar title={windowTitle} />
      <div className={styles.shell}>
        {title !== undefined && <h2 className={styles.title}>{title}</h2>}
        {children}
      </div>
    </div>
  );
}
