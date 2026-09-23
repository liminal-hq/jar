// Maps a MenuItem's icon name string to its rendered icon component.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { ReactNode } from 'react';

import {
  WindowCloseIcon,
  WindowMaximizeIcon,
  WindowMinimizeIcon,
  WindowRestoreIcon,
} from '../Icons';

function MoveIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="5 9 2 12 5 15" />
      <polyline points="9 5 12 2 15 5" />
      <polyline points="15 19 12 22 9 19" />
      <polyline points="19 9 22 12 19 15" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="12" y1="2" x2="12" y2="22" />
    </svg>
  );
}

export function getIconByName(name?: string): ReactNode {
  switch (name) {
    case 'WindowRestoreIcon':
      return <WindowRestoreIcon />;
    case 'WindowMaximizeIcon':
      return <WindowMaximizeIcon />;
    case 'WindowMinimizeIcon':
      return <WindowMinimizeIcon />;
    case 'WindowCloseIcon':
      return <WindowCloseIcon />;
    case 'MoveIcon':
      return <MoveIcon />;
    default:
      return null;
  }
}
