// Custom right-click context menu — ported from Cadence/Threshold's
// `components/ContextMenu`, re-themed onto Jar's `--jar-*` tokens.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

import styles from './ContextMenu.module.css';
import { MenuSection } from './MenuSection';
import { isSeparator, type MenuModel, type MenuPosition } from './types';

interface ContextMenuProps {
  model: MenuModel;
  position: MenuPosition;
  onClose: () => void;
  onItemClick: (itemId: string, action?: () => void) => void;
  /** Whether to pre-focus (and visually highlight) the first item as soon
   * as the menu opens. Only true for a keyboard-triggered open (Shift+F10/
   * Menu key) — matches native OS context menus (e.g. Windows Explorer),
   * which pre-select the first item for a keyboard-triggered open but show
   * no selection at all for a real right-click. */
  autoFocusFirstItem: boolean;
}

/** Ids of every enabled, non-separator item, in the same order they render
 * — the order arrow keys move through. Both call sites construct a fresh
 * `model` object on every render, so this is cheap on purpose rather than
 * memoized — memoizing on `[model]` would never actually hit. */
function navigableIds(model: MenuModel): string[] {
  const ids: string[] = [];
  for (const section of model.sections) {
    for (const item of section.items) {
      if (isSeparator(item)) continue;
      if (!item.disabled) ids.push(item.id);
    }
  }
  return ids;
}

export function ContextMenu({
  model,
  position,
  onClose,
  onItemClick,
  autoFocusFirstItem,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const ids = navigableIds(model);

  // Position the menu and clamp it to the viewport.
  useEffect(() => {
    if (!menuRef.current) return;

    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    let { x, y } = position;
    if (x + rect.width > viewport.width) x = viewport.width - rect.width - 8;
    if (y + rect.height > viewport.height) y = viewport.height - rect.height - 8;
    // Right-click near the left/top edge of Jar's small satellite windows can
    // otherwise still overflow the opposite side once the width/height clamp
    // above pushes it negative — clamp back to a minimum inset too.
    x = Math.max(8, x);
    y = Math.max(8, y);

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }, [position]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  useEffect(() => {
    window.addEventListener('blur', onClose);
    return () => window.removeEventListener('blur', onClose);
  }, [onClose]);

  // For a keyboard-triggered open, pre-focus (and visually highlight) the
  // first item so arrow keys work immediately. For a real right-click,
  // focus the menu's own container instead — invisible (nothing about the
  // container has a focus style), but still enough to catch the first
  // arrow-key press, since `handleKeyDown` below already treats "nothing
  // in the list is focused yet" as index -1 and moves to the first/last
  // item accordingly. Deliberately mount-only (empty deps) — re-running
  // this on every model change would steal focus back whenever e.g. a
  // checkbox re-renders mid-navigation.
  useEffect(() => {
    if (autoFocusFirstItem) {
      const firstId = navigableIds(model)[0];
      const el = firstId ? itemRefs.current.get(firstId) : undefined;
      if (el) {
        el.focus();
        return;
      }
    }
    menuRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function registerItemRef(id: string, el: HTMLButtonElement | null) {
    if (el) itemRefs.current.set(id, el);
    else itemRefs.current.delete(id);
  }

  function focusItem(id: string) {
    const el = itemRefs.current.get(id);
    el?.focus();
    // Keeps the newly-focused item visible once the overflow-scrolling menu
    // (ContextMenu.module.css's max-height/overflow-y) is actually
    // scrolled — relying on each engine's default focus-follows-scroll
    // alone is one less cross-engine assumption to make.
    el?.scrollIntoView({ block: 'nearest' });
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Tab') {
      e.preventDefault();
      onClose();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();

    const active = document.activeElement;
    const currentIndex = ids.findIndex((id) => itemRefs.current.get(id) === active);
    let nextIndex: number;
    if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = ids.length - 1;
    else if (e.key === 'ArrowDown')
      nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % ids.length;
    else
      nextIndex =
        currentIndex === -1 ? ids.length - 1 : (currentIndex - 1 + ids.length) % ids.length;

    const nextId = ids[nextIndex];
    if (nextId) focusItem(nextId);
  }

  function handleItemClick(itemId: string, action?: () => void) {
    onItemClick(itemId, action);
    onClose();
  }

  return createPortal(
    <div
      ref={menuRef}
      className={styles.contextMenu}
      role="menu"
      // Not in the natural tab order (-1), but still a valid target for the
      // imperative `.focus()` call above, on a real right-click open.
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {model.sections.map((section, idx) => (
        <MenuSection
          key={idx}
          section={section}
          onItemClick={handleItemClick}
          registerItemRef={registerItemRef}
        />
      ))}
    </div>,
    document.body,
  );
}
