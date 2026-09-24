// A generic app-wide toast trigger (SCREENS.md W1's top-centre, 4s pill),
// for callers outside the critter-event stream `Toast.tsx` is otherwise fed
// from (e.g. `TankContextMenu.tsx`'s Screenshot action) — same plain
// listener-set shape as `jarClient.ts`'s own `onCritterEvent`.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

type ToastListener = (text: string) => void;

const listeners = new Set<ToastListener>();

export function pushToast(text: string): void {
  for (const listener of listeners) listener(text);
}

export function onToastPush(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
