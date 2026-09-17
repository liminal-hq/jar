// Shared wrapper for the setup, critter card, and family tree windows
// (SCREENS.md W2-W4). Each satellite window is its own JS realm (see
// `domain/jarClient.ts`'s header) so each mounts its own `DialogShell`
// instance, applying `settings.dialog_theme` to its own `document` the same
// way `TankWindow` applies it to the tank's.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { ReactNode } from 'react';
import { useEffect } from 'react';

import { useJarStore } from '../domain/jarClient';
import { applyDialogTheme } from '../theme/theme';
import styles from './DialogShell.module.css';

interface DialogShellProps {
  title?: ReactNode;
  children: ReactNode;
}

export function DialogShell({ title, children }: DialogShellProps) {
  const theme = useJarStore((s) => s.settings.dialog_theme);
  const variant = useJarStore((s) => s.settings.theme_variants[s.settings.dialog_theme]);

  useEffect(() => {
    applyDialogTheme(theme, variant);
  }, [theme, variant]);

  return (
    <div className={styles.shell}>
      {title !== undefined && <h2 className={styles.title}>{title}</h2>}
      {children}
    </div>
  );
}
