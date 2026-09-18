// Dev-only debug overlay, toggled from the Dev settings window
// (`domain/devSettings.ts`) — built to diagnose the drawer's mouse/hover
// reliability bug (confirmed live: WebKitGTK never fires any boundary
// event, not even a window blur, when the cursor crosses the *outer
// window edge*, only internal DOM ones), kept around since it's a handy
// general-purpose tool for the same class of platform quirk elsewhere.
// Shows every raw mouse event this webview receives (type + coordinates
// + time since the last one) plus a live poll of the bezel's `:hover`
// state.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useRef, useState } from 'react';

interface LogEntry {
  type: string;
  x: number;
  y: number;
  target: string;
  related: string;
  t: number;
}

function describe(el: EventTarget | null): string {
  if (!(el instanceof Element)) return String(el);
  const cls =
    el.className && typeof el.className === 'string' ? `.${el.className.slice(0, 24)}` : '';
  return `${el.tagName}${cls}`;
}

export function MouseDebugOverlay() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [hoverPoll, setHoverPoll] = useState<boolean | null>(null);
  const [windowFocused, setWindowFocused] = useState<boolean | null>(null);
  const lastRef = useRef(0);

  useEffect(() => {
    const push = (e: MouseEvent) => {
      const now = performance.now();
      setLog((prev) => {
        const entry: LogEntry = {
          type: e.type,
          x: e.clientX,
          y: e.clientY,
          target: describe(e.target),
          related: describe(e.relatedTarget),
          t: lastRef.current === 0 ? 0 : Math.round(now - lastRef.current),
        };
        lastRef.current = now;
        return [entry, ...prev].slice(0, 12);
      });
    };
    const types: (keyof DocumentEventMap)[] = [
      'mouseenter',
      'mouseleave',
      'mouseover',
      'mouseout',
      'mousemove',
    ];
    types.forEach((type) => document.addEventListener(type, push as EventListener, true));

    const onBlur = () => setWindowFocused(false);
    const onFocus = () => setWindowFocused(true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);

    const poll = setInterval(() => {
      const bezel = document.querySelector('[data-tauri-drag-region]');
      setHoverPoll(bezel ? bezel.matches(':hover') : null);
    }, 200);

    return () => {
      types.forEach((type) => document.removeEventListener(type, push as EventListener, true));
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      clearInterval(poll);
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        top: 4,
        left: 4,
        zIndex: 99999,
        background: 'rgba(0,0,0,0.85)',
        color: '#0f0',
        font: '10px monospace',
        padding: '6px 8px',
        borderRadius: 4,
        pointerEvents: 'none',
        maxWidth: 380,
        lineHeight: 1.4,
      }}
    >
      <div>
        :hover poll = {String(hoverPoll)} | doc focused = {String(windowFocused)}
      </div>
      {log.map((entry, i) => (
        <div key={i}>
          +{entry.t}ms {entry.type} ({entry.x},{entry.y}) target={entry.target} related=
          {entry.related}
        </div>
      ))}
    </div>
  );
}
