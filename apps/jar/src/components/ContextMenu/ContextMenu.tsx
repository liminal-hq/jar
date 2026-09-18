// Custom right-click context menu — ported from Cadence/Threshold's
// `components/ContextMenu`, re-themed onto Jar's `--jar-*` tokens.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import styles from './ContextMenu.module.css';
import { MenuSection } from './MenuSection';
import type { MenuModel, MenuPosition } from './types';

interface ContextMenuProps {
  model: MenuModel;
  position: MenuPosition;
  onClose: () => void;
  onItemClick: (itemId: string, action?: () => void) => void;
}

export function ContextMenu({ model, position, onClose, onItemClick }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

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

  function handleItemClick(itemId: string, action?: () => void) {
    onItemClick(itemId, action);
    onClose();
  }

  return createPortal(
    <div ref={menuRef} className={styles.contextMenu} role="menu">
      {model.sections.map((section, idx) => (
        <MenuSection key={idx} section={section} onItemClick={handleItemClick} />
      ))}
    </div>,
    document.body,
  );
}
