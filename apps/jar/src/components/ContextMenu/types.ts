// Type definitions for the title bar's right-click context menu's data
// model — ported verbatim from Cadence/Threshold's `components/ContextMenu`.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
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
