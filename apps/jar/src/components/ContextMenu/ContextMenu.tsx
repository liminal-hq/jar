// Custom right-click context menu — ported from Cadence/Threshold's
// `components/ContextMenu`, re-themed onto Jar's `--jar-*` tokens.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

import styles from './ContextMenu.module.css';
import { MenuSection } from './MenuSection';
import type { MenuModel, MenuPosition, MenuItem as MenuItemType, MenuSeparator } from './types';

interface ContextMenuProps {
  model: MenuModel;
  position: MenuPosition;
  onClose: () => void;
  onItemClick: (itemId: string, action?: () => void) => void;
}

function isSeparator(item: MenuItemType | MenuSeparator): item is MenuSeparator {
  return 'type' in item && item.type === 'separator';
}

/** Ids of every enabled, non-separator item, in the same order they render
 * — the order arrow keys move through. Recomputed each render (cheap, and
 * needs to reflect e.g. a checkbox's own re-render), but only actually used
 * by `handleKeyDown`, so a stale value between renders is never observable. */
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

export function ContextMenu({ model, position, onClose, onItemClick }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const ids = useMemo(() => navigableIds(model), [model]);

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

  // Focus the first item as soon as the menu opens, so arrow keys work
  // immediately without first needing a mouse hover. Deliberately mount-only
  // (empty deps) — re-running this on every model change would steal focus
  // back to the first item whenever e.g. a checkbox re-renders mid-navigation.
  useEffect(() => {
    const firstId = navigableIds(model)[0];
    if (firstId) itemRefs.current.get(firstId)?.focus();
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
    if (nextId) itemRefs.current.get(nextId)?.focus();
  }

  function handleItemClick(itemId: string, action?: () => void) {
    onItemClick(itemId, action);
    onClose();
  }

  return createPortal(
    <div ref={menuRef} className={styles.contextMenu} role="menu" onKeyDown={handleKeyDown}>
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
