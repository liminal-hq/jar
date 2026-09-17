// Theme tokens for SPEC.md §4's two independent axes: the tank frame
// (bezel of the Tank window) and the dialog theme (critter card, family
// tree, setup, and the drawer). Applied as CSS custom properties on
// `document.documentElement` rather than through a CSS-in-JS runtime, so
// plain CSS modules (see `windows/Tank/TankWindow.module.css`) can consume
// them with `var(--jar-...)`.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { DialogTheme } from '../domain/protocol/generated/DialogTheme';
import type { TankFrame } from '../domain/protocol/generated/TankFrame';

export interface DialogThemeTokens {
  background: string;
  ink: string;
  radius: string;
  accent: string;
  shadow: string;
}

/** One entry per `DialogTheme` variant (SPEC.md §4). Variant-specific
 * accents (Lagoon/Bubblegum/Moss/Clementine for Modern, etc.) aren't
 * modelled per-variant yet — `accent` below is each theme's default. */
export const DIALOG_THEMES: Record<DialogTheme, DialogThemeTokens> = {
  Modern: {
    background: '#fbfaf6',
    ink: '#2b2a33',
    radius: '18px',
    accent: '#3a8dde', // Lagoon
    shadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
  },
  ModernDark: {
    background: '#1c1a22',
    ink: '#f1eee6',
    radius: '18px',
    accent: '#3a8dde',
    shadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
  },
  Classic98: {
    background: '#c9c6bd',
    ink: '#101010',
    radius: '0px',
    accent: '#2d3e8f',
    shadow: 'none',
  },
  PaperNotebook: {
    background: '#fff9ec',
    ink: '#3b2f2a',
    radius: '2px',
    accent: '#c2452d',
    shadow: '0 2px 6px rgba(0, 0, 0, 0.15)',
  },
  HandheldLcd: {
    background: '#9bbc0f',
    ink: '#0f380f',
    radius: '4px',
    accent: '#306230',
    shadow: 'none',
  },
  NeonTerminal: {
    background: '#141018',
    ink: '#ff3fd8',
    radius: '6px',
    accent: '#ff3fd8',
    shadow: '0 0 16px rgba(255, 63, 216, 0.5)',
  },
};

/** Bezel treatment per `TankFrame` (SPEC.md §4). Only the CSS-level parts —
 * the 3D-side Neon/CRT scanline pass lives in
 * `render/effects` per `docs/architecture/3d-engine.md` §10.3. */
export const TANK_FRAMES: Record<TankFrame, { bezelWidth: string; bezelColor: string }> = {
  Bevelled98: { bezelWidth: '14px', bezelColor: '#c9c6bd' },
  WoodStand: { bezelWidth: '18px', bezelColor: '#6b4a30' },
  BrushedMetal: { bezelWidth: '10px', bezelColor: '#9a9a9e' },
  RoundedGlass: { bezelWidth: '0px', bezelColor: 'transparent' },
  NeonCrt: { bezelWidth: '12px', bezelColor: '#141018' },
  CardboardCutout: { bezelWidth: '16px', bezelColor: '#b89666' },
};

export function applyDialogTheme(theme: DialogTheme): void {
  const tokens = DIALOG_THEMES[theme];
  const root = document.documentElement;
  // A selector hook for the theme-specific chrome that isn't expressible as
  // a single custom-property value (SPEC.md §4: Classic 98's title bar,
  // Paper notebook's italic titles, Handheld LCD's title strip) — see
  // `components/DialogShell.module.css`.
  root.dataset.dialogTheme = theme;
  const style = root.style;
  style.setProperty('--jar-bg', tokens.background);
  style.setProperty('--jar-ink', tokens.ink);
  style.setProperty('--jar-radius', tokens.radius);
  style.setProperty('--jar-accent', tokens.accent);
  style.setProperty('--jar-shadow', tokens.shadow);
}

export function applyTankFrame(frame: TankFrame): void {
  const tokens = TANK_FRAMES[frame];
  const root = document.documentElement.style;
  root.setProperty('--jar-bezel-width', tokens.bezelWidth);
  root.setProperty('--jar-bezel-color', tokens.bezelColor);
}
