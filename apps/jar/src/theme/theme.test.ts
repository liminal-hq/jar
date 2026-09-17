// Tests for the theme token tables and their CSS-custom-property
// application (SPEC.md §4). jsdom-only — see `vitest.config.ts`.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import type { DialogTheme } from '../domain/protocol/generated/DialogTheme';
import type { TankFrame } from '../domain/protocol/generated/TankFrame';
import { applyDialogTheme, applyTankFrame, DIALOG_THEMES, TANK_FRAMES } from './theme';

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
});

describe('applyTankFrame', () => {
  it('sets the bezel width and colour custom properties', () => {
    applyTankFrame('WoodStand');
    const root = document.documentElement.style;

    expect(root.getPropertyValue('--jar-bezel-width')).toBe(TANK_FRAMES.WoodStand.bezelWidth);
    expect(root.getPropertyValue('--jar-bezel-color')).toBe(TANK_FRAMES.WoodStand.bezelColor);
  });
});
