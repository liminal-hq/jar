// Window-control SVG icons for `TitleBar` (Windows/Linux control buttons —
// mac uses plain coloured dots, no icon glyphs).
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

export function WindowMinimizeIcon() {
  return (
    <svg width="10" height="1" viewBox="0 0 10 1" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 0.5H10" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function WindowMaximizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function WindowRestoreIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2.5" y="0.5" width="7" height="7" stroke="currentColor" strokeWidth="1" />
      <path
        d="M0.5 2.5H7.5V9.5H0.5V2.5Z"
        fill="transparent"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

export function WindowCloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M0.5 0.5L9.5 9.5" stroke="currentColor" strokeWidth="1" />
      <path d="M9.5 0.5L0.5 9.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
