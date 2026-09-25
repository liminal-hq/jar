// Type definitions for the title bar's right-click context menu's data
// model — ported verbatim from Cadence/Threshold's `components/ContextMenu`.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  /** Marks this row as a checkable toggle rather than a plain action —
   * renders a checkbox glyph in the icon slot instead of `icon`. Whether
   * this row renders as a checkbox at all is inferred from `checked` being
   * defined, so there's currently no way to render a checkbox with an
   * indeterminate state — every checkable item in this codebase always has
   * a real boolean to show, so this hasn't come up in practice. */
  checked?: boolean;
  action?: () => void;
}

export interface MenuSeparator {
  type: 'separator';
}

export interface MenuSection {
  title?: string;
  items: (MenuItem | MenuSeparator)[];
}

export interface MenuModel {
  sections: MenuSection[];
}

export interface MenuPosition {
  x: number;
  y: number;
}

export function isSeparator(item: MenuItem | MenuSeparator): item is MenuSeparator {
  return 'type' in item && item.type === 'separator';
}
