// Grouped section of items within the context menu.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import styles from './ContextMenu.module.css';
import { MenuItem } from './MenuItem';
import {
  isSeparator,
  type MenuItem as MenuItemType,
  type MenuSection as MenuSectionType,
} from './types';

interface MenuSectionProps {
  section: MenuSectionType;
  onItemClick: (itemId: string, action?: () => void) => void;
  registerItemRef: (id: string, el: HTMLButtonElement | null) => void;
}

export function MenuSection({ section, onItemClick, registerItemRef }: MenuSectionProps) {
  return (
    <div className={styles.menuSection}>
      {section.title && <div className={styles.menuSectionTitle}>{section.title}</div>}
      {section.items.map((item, idx) => {
        if (isSeparator(item)) {
          return <div key={idx} className={styles.menuSeparator} />;
        }

        const menuItem = item as MenuItemType;
        return (
          <MenuItem
            key={menuItem.id}
            item={menuItem}
            onItemClick={onItemClick}
            registerItemRef={registerItemRef}
          />
        );
      })}
    </div>
  );
}
