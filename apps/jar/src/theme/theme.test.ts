// Tests for the theme token tables and their CSS-custom-property
// application (SPEC.md §4). jsdom-only — see `vitest.config.ts`.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import type { DialogTheme } from '../domain/protocol/generated/DialogTheme';
import type { TankFrame } from '../domain/protocol/generated/TankFrame';
import {
  applyDialogTheme,
  applyTankFrame,
  defaultVariantOf,
  DIALOG_THEME_VARIANTS,
  DIALOG_THEMES,
  TANK_FRAMES,
  variantNamesFor,
} from './theme';

const ALL_DIALOG_THEMES: DialogTheme[] = [
  'Modern',
  'ModernDark',
  'Classic98',
  'PaperNotebook',
  'HandheldLcd',
  'NeonTerminal',
];

const ALL_TANK_FRAMES: TankFrame[] = [
  'Bevelled98',
  'WoodStand',
  'BrushedMetal',
  'RoundedGlass',
  'NeonCrt',
  'CardboardCutout',
];

describe('DIALOG_THEMES', () => {
  it('has a complete, non-empty token set for every theme', () => {
    for (const theme of ALL_DIALOG_THEMES) {
      const tokens = DIALOG_THEMES[theme];
      expect(tokens.background).toBeTruthy();
      expect(tokens.ink).toBeTruthy();
      expect(tokens.radius).toBeTruthy();
      expect(tokens.accent).toBeTruthy();
      expect(tokens.shadow).toBeTruthy();
    }
  });
});

describe('TANK_FRAMES', () => {
  it('has a bezel width and colour for every frame', () => {
    for (const frame of ALL_TANK_FRAMES) {
      const tokens = TANK_FRAMES[frame];
      expect(tokens.bezelWidth).toBeTruthy();
      expect(tokens.bezelColor).toBeTruthy();
    }
  });
});

describe('applyDialogTheme', () => {
  it('sets the --jar-* custom properties on the document root', () => {
    applyDialogTheme('Modern');
    const root = document.documentElement.style;

    expect(root.getPropertyValue('--jar-bg')).toBe(DIALOG_THEMES.Modern.background);
    expect(root.getPropertyValue('--jar-ink')).toBe(DIALOG_THEMES.Modern.ink);
    expect(root.getPropertyValue('--jar-radius')).toBe(DIALOG_THEMES.Modern.radius);
    expect(root.getPropertyValue('--jar-accent')).toBe(DIALOG_THEMES.Modern.accent);
    expect(root.getPropertyValue('--jar-shadow')).toBe(DIALOG_THEMES.Modern.shadow);
  });

  it('overwrites the previous theme when switched', () => {
    applyDialogTheme('Modern');
    applyDialogTheme('NeonTerminal');

    expect(document.documentElement.style.getPropertyValue('--jar-bg')).toBe(
      DIALOG_THEMES.NeonTerminal.background,
    );
  });

  it('sets a data-dialog-theme attribute on <html> for per-theme chrome selectors', () => {
    applyDialogTheme('Classic98');
    expect(document.documentElement.dataset.dialogTheme).toBe('Classic98');
  });

  it('overrides background/ink/accent with the given variant, leaving radius/shadow theme-level', () => {
    applyDialogTheme('Modern', 'Bubblegum');
    const root = document.documentElement.style;
    // Non-null: 'Bubblegum' is one of Modern's own static keys above.
    const bubblegum = DIALOG_THEME_VARIANTS.Modern.Bubblegum!;

    expect(root.getPropertyValue('--jar-bg')).toBe(bubblegum.background);
    expect(root.getPropertyValue('--jar-ink')).toBe(bubblegum.ink);
    expect(root.getPropertyValue('--jar-accent')).toBe(bubblegum.accent);
    expect(root.getPropertyValue('--jar-radius')).toBe(DIALOG_THEMES.Modern.radius);
    expect(root.getPropertyValue('--jar-shadow')).toBe(DIALOG_THEMES.Modern.shadow);
  });

  it('falls back to the theme base tokens when no variant is given', () => {
    applyDialogTheme('Modern');
    const root = document.documentElement.style;

    expect(root.getPropertyValue('--jar-accent')).toBe(DIALOG_THEMES.Modern.accent);
  });

  it("falls back to the theme base tokens when the variant name isn't found", () => {
    applyDialogTheme('Modern', 'Not A Real Variant');
    const root = document.documentElement.style;

    expect(root.getPropertyValue('--jar-bg')).toBe(DIALOG_THEMES.Modern.background);
    expect(root.getPropertyValue('--jar-accent')).toBe(DIALOG_THEMES.Modern.accent);
  });

  it('sets the color-scheme property so native form controls follow the theme', () => {
    applyDialogTheme('Modern');
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('light');

    applyDialogTheme('NeonTerminal');
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('dark');
  });

  it('reports isDark matching each theme base background, for Window.setTheme()', () => {
    // Modern/Classic98/PaperNotebook/HandheldLcd read light even though
    // HandheldLcd's title strip is dark — it's the *background* token
    // (its light LCD-green screen) that drives this, not the accent chrome.
    expect(applyDialogTheme('Modern').isDark).toBe(false);
    expect(applyDialogTheme('ModernDark').isDark).toBe(true);
    expect(applyDialogTheme('Classic98').isDark).toBe(false);
    expect(applyDialogTheme('PaperNotebook').isDark).toBe(false);
    expect(applyDialogTheme('HandheldLcd').isDark).toBe(false);
    expect(applyDialogTheme('NeonTerminal').isDark).toBe(true);
  });
});

describe('DIALOG_THEME_VARIANTS', () => {
  it('has at least one complete, non-empty variant per theme', () => {
    for (const theme of ALL_DIALOG_THEMES) {
      const variants = DIALOG_THEME_VARIANTS[theme];
      expect(Object.keys(variants).length).toBeGreaterThan(0);
      for (const tokens of Object.values(variants)) {
        expect(tokens.background).toBeTruthy();
        expect(tokens.ink).toBeTruthy();
        expect(tokens.accent).toBeTruthy();
      }
    }
  });

  it('gives Modern and Modern dark independent variant tables with the same names', () => {
    expect(Object.keys(DIALOG_THEME_VARIANTS.Modern)).toEqual(
      Object.keys(DIALOG_THEME_VARIANTS.ModernDark),
    );
    expect(DIALOG_THEME_VARIANTS.Modern.Lagoon).not.toEqual(
      DIALOG_THEME_VARIANTS.ModernDark.Lagoon,
    );
  });
});

describe('variantNamesFor / defaultVariantOf', () => {
  it('returns the display-order variant names for a theme', () => {
    expect(variantNamesFor('Classic98')).toEqual([
      'Classic blue',
      'Teal desktop',
      'Brick',
      'Rainy day',
      'High contrast',
    ]);
  });

  it('returns the first variant name as the default, matching SPEC.md §4', () => {
    expect(defaultVariantOf('Modern')).toBe('Lagoon');
    expect(defaultVariantOf('PaperNotebook')).toBe('Ruled cream');
    expect(defaultVariantOf('HandheldLcd')).toBe('Pea soup');
    expect(defaultVariantOf('NeonTerminal')).toBe('Magenta');
  });
});

describe('applyTankFrame', () => {
  it('sets the bezel width and colour custom properties', () => {
    applyTankFrame('WoodStand');
    const root = document.documentElement.style;

    expect(root.getPropertyValue('--jar-bezel-width')).toBe(TANK_FRAMES.WoodStand.bezelWidth);
    expect(root.getPropertyValue('--jar-bezel-color')).toBe(TANK_FRAMES.WoodStand.bezelColor);
  });
});
