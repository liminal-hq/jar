// Single row within the context menu.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';

import styles from './ContextMenu.module.css';
import { getIconByName } from './iconMapper';
import { Submenu } from './Submenu';
import type { MenuItem as MenuItemType } from './types';

interface MenuItemProps {
  item: MenuItemType;
  onItemClick: (id: string, action?: () => void) => void;
  registerItemRef: (id: string, el: HTMLButtonElement | null) => void;
}

// How long a hover has to linger before it opens/closes the submenu — long
// enough that moving the mouse diagonally toward the submenu itself (which
// necessarily drifts off the parent row briefly) doesn't flicker it shut.
const SUBMENU_OPEN_DELAY_MS = 250;
const SUBMENU_CLOSE_DELAY_MS = 300;

export function MenuItem({ item, onItemClick, registerItemRef }: MenuItemProps) {
  const [showSubmenu, setShowSubmenu] = useState(false);
  const itemRef = useRef<HTMLButtonElement | null>(null);
  const submenuTimerRef = useRef<number | null>(null);
  const hasSubmenu = !!item.children?.length;

  useEffect(() => {
    return () => {
      if (submenuTimerRef.current !== null) window.clearTimeout(submenuTimerRef.current);
    };
  }, []);

  function clearSubmenuTimer() {
    if (submenuTimerRef.current !== null) {
      window.clearTimeout(submenuTimerRef.current);
      submenuTimerRef.current = null;
    }
  }

  function handleClick(e: MouseEvent) {
    if (item.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    if (hasSubmenu) {
      setShowSubmenu(true);
      return;
    }
    onItemClick(item.id, item.action);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (!hasSubmenu || e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    setShowSubmenu(true);
  }

  function handleMouseEnter() {
    if (!hasSubmenu) return;
    clearSubmenuTimer();
    submenuTimerRef.current = window.setTimeout(() => setShowSubmenu(true), SUBMENU_OPEN_DELAY_MS);
  }

  function handleMouseLeave() {
    if (!hasSubmenu) return;
    clearSubmenuTimer();
    submenuTimerRef.current = window.setTimeout(
      () => setShowSubmenu(false),
      SUBMENU_CLOSE_DELAY_MS,
    );
  }

  function handleSubmenuMouseEnter() {
    // Cancels the close timer `handleMouseLeave` started when the cursor
    // left this row on its way to the submenu.
    clearSubmenuTimer();
  }

  function handleSubmenuMouseLeave() {
    clearSubmenuTimer();
    submenuTimerRef.current = window.setTimeout(
      () => setShowSubmenu(false),
      SUBMENU_CLOSE_DELAY_MS,
    );
  }

  function closeSubmenuAndReturnFocus() {
    setShowSubmenu(false);
    itemRef.current?.focus();
  }

  const isCheckable = item.checked !== undefined;
  const iconNode = getIconByName(item.icon);

  return (
    <>
      <button
        ref={(el) => {
          itemRef.current = el;
          registerItemRef(item.id, el);
        }}
        className={`${styles.menuItem} ${item.disabled ? styles.disabled : ''}`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        disabled={item.disabled}
        role={isCheckable ? 'menuitemcheckbox' : 'menuitem'}
        aria-checked={isCheckable ? item.checked : undefined}
        aria-haspopup={hasSubmenu || undefined}
        aria-expanded={hasSubmenu ? showSubmenu : undefined}
      >
        <span className={styles.menuItemIcon}>
          {isCheckable ? (
            <span
              className={`${styles.menuItemCheckbox} ${item.checked ? styles.checked : ''}`}
              aria-hidden="true"
            />
          ) : (
            iconNode
          )}
        </span>
        <span className={styles.menuItemLabel}>{item.label}</span>
        {item.shortcut && <span className={styles.menuItemShortcut}>{item.shortcut}</span>}
        {hasSubmenu && (
          <span className={styles.menuItemChevron} aria-hidden="true">
            ›
          </span>
        )}
      </button>

      {hasSubmenu && showSubmenu && itemRef.current && (
        <Submenu
          items={item.children!}
          parentRect={itemRef.current.getBoundingClientRect()}
          onItemClick={onItemClick}
          onClose={closeSubmenuAndReturnFocus}
          onMouseEnter={handleSubmenuMouseEnter}
          onMouseLeave={handleSubmenuMouseLeave}
        />
      )}
    </>
  );
}
