// Theme tokens for SPEC.md §4's two independent axes: the tank frame
// (bezel of the Tank window) and the dialog theme (critter card, family
// tree, setup, and the tank's right-click menu). Applied as CSS custom
// properties on `document.documentElement` rather than through a
// CSS-in-JS runtime, so plain CSS modules (see
// `windows/Tank/TankWindow.module.css`) can consume them with
// `var(--jar-...)`.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
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

/** Each theme's base tokens — overridden by the currently-selected variant's
 * background/ink/accent in `applyDialogTheme` (see `DIALOG_THEME_VARIANTS`
 * below); `accent` here is only the fallback used before a variant hydrates. */
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

export interface DialogThemeVariantTokens {
  background: string;
  ink: string;
  accent: string;
}

/** Named variant lists per `DialogTheme` (SPEC.md §4's "Variants" table) —
 * one remembered pick per theme, per `JarSettings.theme_variants`. Each
 * entry's key order is display order (the first is that theme's documented
 * default). Only background/ink/accent vary by variant; radius and shadow
 * stay theme-level (`DIALOG_THEMES`). Modern and Modern dark share the same
 * accent vocabulary but pick independently, matching `theme_variants` being
 * keyed by theme rather than by variant list. */
export const DIALOG_THEME_VARIANTS: Record<
  DialogTheme,
  Record<string, DialogThemeVariantTokens>
> = {
  Modern: {
    Lagoon: { background: '#fbfaf6', ink: '#2b2a33', accent: '#3a8dde' },
    Bubblegum: { background: '#fbfaf6', ink: '#2b2a33', accent: '#ff3fd8' },
    Moss: { background: '#fbfaf6', ink: '#2b2a33', accent: '#4caf50' },
    Clementine: { background: '#fbfaf6', ink: '#2b2a33', accent: '#e07a2c' },
  },
  ModernDark: {
    Lagoon: { background: '#1c1a22', ink: '#f1eee6', accent: '#3a8dde' },
    Bubblegum: { background: '#1c1a22', ink: '#f1eee6', accent: '#ff3fd8' },
    Moss: { background: '#1c1a22', ink: '#f1eee6', accent: '#4caf50' },
    Clementine: { background: '#1c1a22', ink: '#f1eee6', accent: '#e07a2c' },
  },
  Classic98: {
    'Classic blue': { background: '#c9c6bd', ink: '#101010', accent: '#2d3e8f' },
    'Teal desktop': { background: '#bcd2ce', ink: '#0d2b28', accent: '#1f7a6c' },
    Brick: { background: '#d9c3b0', ink: '#3a1c12', accent: '#a13d24' },
    'Rainy day': { background: '#c7ccd1', ink: '#20272d', accent: '#51697f' },
    'High contrast': { background: '#000000', ink: '#ffffff', accent: '#ffe600' },
  },
  PaperNotebook: {
    'Ruled cream': { background: '#fff9ec', ink: '#3b2f2a', accent: '#c2452d' },
    'Graph paper': { background: '#f2f7f7', ink: '#2c3b3b', accent: '#2f7d7d' },
    'Legal pad': { background: '#fdf6c9', ink: '#3a3115', accent: '#c98a12' },
    Kraft: { background: '#d9c19a', ink: '#3a2c19', accent: '#7a4a25' },
  },
  HandheldLcd: {
    'Pea soup': { background: '#9bbc0f', ink: '#0f380f', accent: '#306230' },
    'Pocket grey': { background: '#c8cbc0', ink: '#2b2d28', accent: '#5a5d54' },
    Berry: { background: '#d68fc2', ink: '#3a0f2b', accent: '#8a2a63' },
    Glacier: { background: '#9fd0e0', ink: '#0f2f38', accent: '#2b7f97' },
  },
  NeonTerminal: {
    Magenta: { background: '#141018', ink: '#ff3fd8', accent: '#ff3fd8' },
    Amber: { background: '#141018', ink: '#ffb000', accent: '#ffb000' },
    'Phosphor green': { background: '#0d1410', ink: '#39ff14', accent: '#39ff14' },
    Cyan: { background: '#0d1418', ink: '#00e5ff', accent: '#00e5ff' },
  },
};

/** Display-order variant names for a theme — the first is its documented
 * default (SPEC.md §4). Useful as a fallback when `theme_variants` has no
 * entry yet for a theme (shouldn't happen once `JarSettings::default()`/
 * `migrate_v1` have run, but keeps the UI from indexing a missing key). */
export function variantNamesFor(theme: DialogTheme): string[] {
  return Object.keys(DIALOG_THEME_VARIANTS[theme]);
}

/** A theme's documented default variant (SPEC.md §4) — the non-null
 * assertion reflects that every theme's variant list is a non-empty static
 * literal above, not a runtime guess. */
export function defaultVariantOf(theme: DialogTheme): string {
  return variantNamesFor(theme)[0]!;
}

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

/** Perceived brightness (ITU-R BT.601 luma, not full WCAG relative
 * luminance — a binary light/dark split doesn't need contrast-ratio
 * accuracy) of a `#rrggbb` colour. Under 128 reads as dark. */
function isDarkBackground(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

export interface AppliedDialogTheme {
  /** Whether the resolved background (variant-aware) reads as dark —
   * callers use this to tell the OS window server the app's actual
   * light/dark mode (`Window.setTheme()`). Every platform's native,
   * app-content-blind chrome (window border/shadow colour, native context
   * menus, etc.) otherwise defaults to light regardless of the selected
   * theme; on Windows this is `domain/windows.ts`'s `shadow: true` DWM
   * border staying light-coloured under a dark theme. */
  isDark: boolean;
}

/** `variant`, if given, should be one of `variantNamesFor(theme)` — SPEC.md
 * §4's named per-theme accent/palette pick. Falls back to the theme's base
 * tokens when omitted or not found (e.g. before `theme_variants` hydrates). */
export function applyDialogTheme(theme: DialogTheme, variant?: string): AppliedDialogTheme {
  const tokens = DIALOG_THEMES[theme];
  const variantTokens = variant ? DIALOG_THEME_VARIANTS[theme][variant] : undefined;
  const background = variantTokens?.background ?? tokens.background;
  const root = document.documentElement;
  // A selector hook for the theme-specific chrome that isn't expressible as
  // a single custom-property value (SPEC.md §4: Classic 98's title bar,
  // Paper notebook's italic titles, Handheld LCD's title strip) — see
  // `components/DialogShell.module.css`.
  root.dataset.dialogTheme = theme;
  const style = root.style;
  style.setProperty('--jar-bg', background);
  style.setProperty('--jar-ink', variantTokens?.ink ?? tokens.ink);
  style.setProperty('--jar-radius', tokens.radius);
  style.setProperty('--jar-accent', variantTokens?.accent ?? tokens.accent);
  style.setProperty('--jar-shadow', tokens.shadow);
  const isDark = isDarkBackground(background);
  // Native, unstyled form controls (`<select>`, checkboxes, scrollbars) are
  // drawn by the browser/OS's own widget theming, which `--jar-*` custom
  // properties never reach — they stay light regardless of the selected
  // theme until the engine is told the page itself is dark. Identical
  // effect across WebKitGTK and WebView2, since it's a standard CSS
  // property, not a platform-specific API.
  style.setProperty('color-scheme', isDark ? 'dark' : 'light');
  return { isDark };
}

export function applyTankFrame(frame: TankFrame): void {
  const tokens = TANK_FRAMES[frame];
  const root = document.documentElement.style;
  root.setProperty('--jar-bezel-width', tokens.bezelWidth);
  root.setProperty('--jar-bezel-color', tokens.bezelColor);
}
