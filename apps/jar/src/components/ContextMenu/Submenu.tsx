// Flyout submenu opened from a MenuItem with `children` — a second
// portaled panel positioned relative to its parent row rather than the
// cursor. Reuses ContextMenu's own visual styling (`.submenu` composes
// `.contextMenu`, ContextMenu.module.css) and roving-focus keyboard nav
// (keyboardNav.ts), rather than the flatter, click/hover-only version
// `ScottMorris/liminal-notes`' own Submenu.tsx has.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

import styles from './ContextMenu.module.css';
import { moveFocus, navigableItemIds } from './keyboardNav';
import { MenuItem } from './MenuItem';
import { isSeparator, type MenuItem as MenuItemType, type MenuSeparator } from './types';

interface SubmenuProps {
  items: (MenuItemType | MenuSeparator)[];
  parentRect: DOMRect;
  onItemClick: (id: string, action?: () => void) => void;
  onClose: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function Submenu({
  items,
  parentRect,
  onItemClick,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: SubmenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const ids = navigableItemIds(items);

  // Position relative to the parent row: right of it by default, flipping
  // to the left and clamping vertically/to a minimum inset on overflow —
  // same shape as ContextMenu.tsx's own viewport clamp for the top-level
  // menu, just anchored to `parentRect` instead of the cursor position.
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    let x = parentRect.right - 4;
    let y = parentRect.top - 4;
    if (x + rect.width > viewport.width) x = parentRect.left - rect.width + 4;
    if (y + rect.height > viewport.height) y = viewport.height - rect.height - 8;
    x = Math.max(8, x);
    y = Math.max(8, y);

    setPosition({ x, y });
  }, [parentRect]);

  // Auto-focus the first item as soon as the submenu opens — unlike the
  // top-level menu's mouse-vs-keyboard distinction, opening a submenu (by
  // hover, click, or ArrowRight) always warrants highlighting its first
  // choice; there's no "was this opened via keyboard" ambiguity here.
  useEffect(() => {
    const firstId = ids[0];
    itemRefs.current.get(firstId ?? '')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function registerItemRef(id: string, el: HTMLButtonElement | null) {
    if (el) itemRefs.current.set(id, el);
    else itemRefs.current.delete(id);
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    // Deliberately not handled here: Escape. ContextMenu.tsx's own
    // Escape listener is a plain `document.addEventListener`, entirely
    // outside React's synthetic event system — a React `stopPropagation`
    // here can't stop it from also firing, so Escape always closes the
    // whole menu (this submenu included), never just this level. Accepted
    // as the simpler behavior rather than adding cross-component state to
    // suppress that document-level listener for one 3-item submenu.
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    moveFocus(e.key, ids, itemRefs.current);
  }

  return createPortal(
    <div
      ref={menuRef}
      className={styles.submenu}
      role="menu"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      onKeyDown={handleKeyDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {items.map((item, idx) => {
        if (isSeparator(item)) return <div key={idx} className={styles.menuSeparator} />;
        return (
          <MenuItem
            key={item.id}
            item={item}
            onItemClick={onItemClick}
            registerItemRef={registerItemRef}
          />
        );
      })}
    </div>,
    document.body,
  );
}
