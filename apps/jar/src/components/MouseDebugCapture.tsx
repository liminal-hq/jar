// Dev-only, headless — captures raw mouse events and hover/focus polling
// at *this* window's own boundary and relays them to the Dev settings
// window (`domain/debugChannel.ts`) for display, rather than rendering an
// in-place overlay itself. A general-purpose tool for diagnosing
// WebKitGTK's silent mouse/focus events at a window's own outer edge (see
// `TankWindow.tsx`'s `toggleDrawer`), useful for the same class of
// platform quirk wherever else it turns up.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useRef } from 'react';

import { publishMouseLogEntry, publishMousePollState } from '../domain/debugChannel';

function describe(el: EventTarget | null): string {
  if (!(el instanceof Element)) return String(el);
  const cls =
    el.className && typeof el.className === 'string' ? `.${el.className.slice(0, 24)}` : '';
  return `${el.tagName}${cls}`;
}

export function MouseDebugCapture() {
  const lastRef = useRef(0);

  useEffect(() => {
    const push = (e: MouseEvent) => {
      const now = performance.now();
      publishMouseLogEntry({
        type: e.type,
        x: e.clientX,
        y: e.clientY,
        target: describe(e.target),
        related: describe(e.relatedTarget),
        t: lastRef.current === 0 ? 0 : Math.round(now - lastRef.current),
      });
      lastRef.current = now;
    };
    const types: (keyof DocumentEventMap)[] = [
      'mouseenter',
      'mouseleave',
      'mouseover',
      'mouseout',
      'mousemove',
    ];
    types.forEach((type) => document.addEventListener(type, push as EventListener, true));

    let windowFocused: boolean | null = null;
    const onBlur = () => {
      windowFocused = false;
    };
    const onFocus = () => {
      windowFocused = true;
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);

    const poll = setInterval(() => {
      const bezel = document.querySelector('[data-tauri-drag-region]');
      publishMousePollState({
        hoverPoll: bezel ? bezel.matches(':hover') : null,
        windowFocused,
      });
    }, 200);

    return () => {
      types.forEach((type) => document.removeEventListener(type, push as EventListener, true));
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      clearInterval(poll);
    };
  }, []);

  return null;
}
