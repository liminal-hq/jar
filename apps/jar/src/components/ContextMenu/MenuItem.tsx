// Single row within the context menu.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { MouseEvent } from 'react';

import styles from './ContextMenu.module.css';
import { getIconByName } from './iconMapper';
import type { MenuItem as MenuItemType } from './types';

interface MenuItemProps {
  item: MenuItemType;
  onItemClick: (id: string, action?: () => void) => void;
}

export function MenuItem({ item, onItemClick }: MenuItemProps) {
  function handleClick(e: MouseEvent) {
    if (item.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    onItemClick(item.id, item.action);
  }

  const iconNode = getIconByName(item.icon);

  return (
    <button
      className={`${styles.menuItem} ${item.disabled ? styles.disabled : ''}`}
      onClick={handleClick}
      disabled={item.disabled}
      role="menuitem"
    >
      <span className={styles.menuItemIcon}>{iconNode}</span>
      <span className={styles.menuItemLabel}>{item.label}</span>
      {item.shortcut && <span className={styles.menuItemShortcut}>{item.shortcut}</span>}
    </button>
  );
}
