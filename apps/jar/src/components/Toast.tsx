// Event toasts (W1 · Tank, SCREENS.md: "top-centre, 4 s"). Fed from
// `domain/jarClient.ts`'s `onCritterEvent` — a `Born`/`Passed`/`Added`
// firing is exactly the "moment in time" that hook exists for, as opposed
// to `useJarStore`'s continuously-current state.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useState } from 'react';

import { onCritterEvent, useJarStore } from '../domain/jarClient';

const TOAST_DURATION_MS = 4000;

interface ToastMessage {
  id: number;
  text: string;
}

let nextToastId = 0;

export function ToastLayer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(
    () =>
      onCritterEvent((event) => {
        const critters = useJarStore.getState().critters;
        let text: string;

        switch (event.kind) {
          case 'born': {
            const parentA = critters[event.parentA]?.name ?? 'Someone';
            const parentB = critters[event.parentB]?.name ?? 'someone';
            text = `${parentA} & ${parentB} had a fry: ${event.child.name}`;
            break;
          }
          case 'passed': {
            const name = critters[event.id]?.name ?? 'A critter';
            text = `${name} has passed on, gently.`;
            break;
          }
          case 'added':
            text = `${event.critter.name} settled into the jar.`;
            break;
        }

        const id = nextToastId++;
        setToasts((prev) => [...prev, { id, text }]);
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, TOAST_DURATION_MS);
      }),
    [],
  );

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: 'rgba(0, 0, 0, 0.6)',
            color: '#fff',
            fontSize: 12,
            padding: '4px 10px',
            borderRadius: 999,
            whiteSpace: 'nowrap',
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
