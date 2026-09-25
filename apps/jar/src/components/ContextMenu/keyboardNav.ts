// Shared roving-focus keyboard-nav logic for ContextMenu's top-level list
// and Submenu's flyout list — both keep a flat ordered list of navigable
// item ids and a Map of their button elements, and move real DOM focus
// between them the same way.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { isSeparator, type MenuItem, type MenuModel, type MenuSeparator } from './types';

function isNavigable(item: MenuItem | MenuSeparator): item is MenuItem {
  return !isSeparator(item) && !item.disabled;
}

/** Ids of every enabled, non-separator item across all of a menu's
 * sections, in the same order they render — the order arrow keys move
 * through. Callers construct a fresh `model` on every render, so this is
 * cheap on purpose rather than memoized — memoizing on `[model]` would
 * never actually hit. */
export function navigableIds(model: MenuModel): string[] {
  const ids: string[] = [];
  for (const section of model.sections) {
    for (const item of section.items) {
      if (isNavigable(item)) ids.push(item.id);
    }
  }
  return ids;
}

/** Same as `navigableIds`, for a flat item list — a submenu's own
 * `children`, which has no sections to flatten. */
export function navigableItemIds(items: (MenuItem | MenuSeparator)[]): string[] {
  return items.filter(isNavigable).map((item) => item.id);
}

export function focusItem(id: string, itemRefs: Map<string, HTMLButtonElement>): void {
  const el = itemRefs.get(id);
  el?.focus();
  // Keeps the newly-focused item visible once its own menu is scrolling
  // (ContextMenu.module.css's max-height/overflow-y) — relying on each
  // engine's default focus-follows-scroll alone is one less cross-engine
  // assumption to make.
  el?.scrollIntoView({ block: 'nearest' });
}

/** Moves focus for ArrowDown/ArrowUp/Home/End, wrapping at both ends.
 * `key` is expected to already be one of these four — callers filter
 * before calling. */
export function moveFocus(
  key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End',
  ids: string[],
  itemRefs: Map<string, HTMLButtonElement>,
): void {
  const active = document.activeElement;
  const currentIndex = ids.findIndex((id) => itemRefs.get(id) === active);
  let nextIndex: number;
  if (key === 'Home') nextIndex = 0;
  else if (key === 'End') nextIndex = ids.length - 1;
  else if (key === 'ArrowDown')
    nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % ids.length;
  else
    nextIndex = currentIndex === -1 ? ids.length - 1 : (currentIndex - 1 + ids.length) % ids.length;

  const nextId = ids[nextIndex];
  if (nextId) focusItem(nextId, itemRefs);
}
