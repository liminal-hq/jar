// Custom right-click context menu — ported from Cadence/Threshold's
// `components/ContextMenu`, re-themed onto Jar's `--jar-*` tokens.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

import styles from './ContextMenu.module.css';
import { moveFocus, navigableIds } from './keyboardNav';
import { MenuSection } from './MenuSection';
import type { MenuModel, MenuPosition } from './types';

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
      const target = e.target as Node;
      // A submenu (Submenu.tsx) is portaled to document.body as its own
      // sibling, not a DOM descendant of menuRef — checking menuRef alone
      // would treat every click inside an open submenu as "outside" and
      // close everything via mousedown, before the click event even
      // reaches the submenu's own button. Every menu panel (this one, and
      // any open submenu) shares role="menu", so checking all of them
      // covers both without Submenu needing to hand a ref up.
      const panels = document.querySelectorAll('[role="menu"]');
      for (const panel of panels) {
        if (panel.contains(target)) return;
      }
      onClose();
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

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Tab') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    moveFocus(e.key, ids, itemRefs.current);
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
