// Shared, tank-realm-only state for the manual fish pilot — a plain module
// singleton, not React state or a Tauri-synced value, since only two things
// in this realm ever touch it: `PilotCaptureBridge.tsx` (writes, from both
// local key events and ones forwarded from the Fish monitor window over
// `domain/pilotInput.ts`) and `ManualPilotBehaviour.calculate()` (reads,
// once per fish per frame). Keeping it a plain object rather than routing
// through `localStorage`/Tauri events for every keystroke is what keeps a
// held key cheap enough to read every frame for every fish.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

/** World-axis direction each key contributes — `useFishSteering.ts`'s
 * `ManualPilotBehaviour` sums and normalizes whatever's currently held.
 * Matches the tank camera's fixed view (`[0, 2, 9]` looking at the origin,
 * `TankScene.tsx`): `KeyA`/`KeyD` are screen left/right, `KeyW`/`KeyS` are
 * away-from/toward the viewer (`KeyS` alone drives a fish straight into the
 * front glass), `KeyR`/`KeyF` are up/down. */
const KEY_AXES: Record<string, { x: number; y: number; z: number }> = {
  KeyA: { x: -1, y: 0, z: 0 },
  KeyD: { x: 1, y: 0, z: 0 },
  KeyW: { x: 0, y: 0, z: -1 },
  KeyS: { x: 0, y: 0, z: 1 },
  KeyR: { x: 0, y: 1, z: 0 },
  KeyF: { x: 0, y: -1, z: 0 },
};

/** The mapped key codes, for anything that needs to filter events down to
 * "keys this feature cares about" without duplicating `KEY_AXES`'s literal
 * list — the Fish monitor window's own key capture
 * (`FishMonitorWindow.tsx`) forwards events rather than calling `setKey`
 * directly (it runs in a separate realm from this module's singleton), but
 * still needs to know which codes are worth forwarding at all. */
export const PILOT_KEY_CODES: readonly string[] = Object.keys(KEY_AXES);

let pilotedFishId: number | null = null;
const pressed = new Set<string>();

/** Called whenever `domain/devSettings.ts`'s `pilotedFishId` changes —
 * clearing held keys on every retarget is what stops a key held down while
 * switching fish (or releasing the pilot entirely) from carrying over as a
 * stuck input onto whichever fish is piloted next. */
export function setPilotedId(id: number | null): void {
  pilotedFishId = id;
  pressed.clear();
}

export function setKey(code: string, down: boolean): void {
  if (!(code in KEY_AXES)) return;
  if (down) {
    pressed.add(code);
  } else {
    pressed.delete(code);
  }
}

export function clearKeys(): void {
  pressed.clear();
}

/** The current pilot direction, or `null` if nobody's piloted or no mapped
 * key is held — `ManualPilotBehaviour` treats `null` as "contribute
 * nothing", not "contribute a zero vector", so it can skip the force
 * entirely rather than let a zero-length normalize divide by zero. */
export function getPilotDirection(): { x: number; y: number; z: number } | null {
  if (pressed.size === 0) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const code of pressed) {
    const axis = KEY_AXES[code];
    if (!axis) continue;
    x += axis.x;
    y += axis.y;
    z += axis.z;
  }
  const lengthSq = x * x + y * y + z * z;
  if (lengthSq === 0) return null;
  const length = Math.sqrt(lengthSq);
  return { x: x / length, y: y / length, z: z / length };
}

export function getPilotedFishId(): number | null {
  return pilotedFishId;
}

/** Whether `critterId` is both the piloted fish *and* currently being
 * actively driven (a mapped key is down right now) — `SteeringSystem.tsx`
 * uses this to skip its non-self-propelled velocity decay only while a key
 * is genuinely held, not just while a fish is selected but idle, so a
 * paused piloted fish still decays normally between drives. */
export function isActivelyPiloted(critterId: number): boolean {
  return pilotedFishId === critterId && pressed.size > 0;
}
