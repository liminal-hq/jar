// Single row within the context menu.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { MouseEvent } from 'react';

import styles from './ContextMenu.module.css';
import { getIconByName } from './iconMapper';
import type { MenuItem as MenuItemType } from './types';

interface MenuItemProps {
  item: MenuItemType;
  onItemClick: (id: string, action?: () => void) => void;
  registerItemRef: (id: string, el: HTMLButtonElement | null) => void;
}

export function MenuItem({ item, onItemClick, registerItemRef }: MenuItemProps) {
  function handleClick(e: MouseEvent) {
    if (item.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    onItemClick(item.id, item.action);
  }

  const isCheckable = item.checked !== undefined;
  const iconNode = getIconByName(item.icon);

  return (
    <button
      ref={(el) => registerItemRef(item.id, el)}
      className={`${styles.menuItem} ${item.disabled ? styles.disabled : ''}`}
      onClick={handleClick}
      disabled={item.disabled}
      role={isCheckable ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={isCheckable ? item.checked : undefined}
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
    </button>
  );
}
