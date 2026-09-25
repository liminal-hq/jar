// Shared, tank-realm-only state for the manual fish pilot — a plain module
// singleton, not React state or a Tauri-synced value, since only two things
// in this realm ever touch it: `PilotCaptureBridge.tsx` (writes, from both
// local key events and ones forwarded from the Tank monitor window over
// `domain/pilotInput.ts`) and `SteeringSystem.tsx`/`ManualPilotBehaviour`
// (read, once per fish per frame). Keeping it a plain object rather than
// routing through `localStorage`/Tauri events for every keystroke is what
// keeps a held key cheap enough to read every frame for every fish.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

/** A car/boat control scheme, not fixed world axes: `KeyW`/`KeyS` thrust
 * forward/backward along the fish's own *current heading*, `KeyA`/`KeyD`
 * turn it in place, `KeyR`/`KeyF` stay world-space up/down (a yaw-only,
 * dorsal-up fish has no meaningful "local up" distinct from world up).
 * `PILOT_KEY_CODES` (below) still lists exactly these six codes, so
 * `TankMonitorWindow.tsx`'s forwarding filter needs no changes. */
const THRUST_KEYS = ['KeyW', 'KeyS', 'KeyR', 'KeyF'] as const;
const TURN_KEYS = ['KeyA', 'KeyD'] as const;

export const PILOT_KEY_CODES: readonly string[] = [...THRUST_KEYS, ...TURN_KEYS];

/** How fast `KeyA`/`KeyD` turn the fish — snappy enough to visibly read as
 * "turning", not a slow drift. */
const PILOT_TURN_RATE = 2.2;

/** `KeyS`'s thrust relative to `KeyW`'s — real fish don't really reverse-
 * swim, and a full-strength brake would fight escaping the exact nose-in
 * wall-stall corner this tool exists to force. Weak, not zero: a fish
 * should still be able to back itself out of a corner. Exported for
 * `manualPilotBehaviour.test.ts`'s own assertions. */
export const REVERSE_THRUST_FACTOR = 0.4;

let pilotedFishId: number | null = null;
const pressed = new Set<string>();

/** The fish's driven heading angle (radians, `heading.ts`'s `yaw` convention
 * — `forward = (sin(yaw), 0, cos(yaw))`), or `null` when unseeded. Turning
 * in place has no velocity to derive a heading from (`heading.ts`'s normal
 * `computeTargetHeading` needs one), so a piloted fish's heading is driven
 * by this instead of derived — `SteeringSystem.tsx` seeds it from the
 * fish's actual rendered heading the moment piloting engages (no visible
 * snap), advances it here each frame, and reads it back to override that
 * fish's rendered orientation while a key is held. */
let pilotYaw: number | null = null;

/** Called whenever `domain/devSettings.ts`'s `pilotedFishId` changes —
 * clearing held keys on every retarget is what stops a key held down while
 * switching fish (or releasing the pilot entirely) from carrying over as a
 * stuck input onto whichever fish is piloted next. Clearing keys also
 * un-seeds `pilotYaw` (below), so the next fish to be piloted seeds fresh
 * from its own heading rather than inheriting the previous fish's. */
export function setPilotedId(id: number | null): void {
  pilotedFishId = id;
  pressed.clear();
  pilotYaw = null;
}

export function setKey(code: string, down: boolean): void {
  if (!PILOT_KEY_CODES.includes(code)) return;
  if (down) {
    pressed.add(code);
  } else {
    pressed.delete(code);
  }
  // Un-seeding on every release-to-empty (not just on retarget) is what
  // makes every fresh engagement — not just the first one after selecting a
  // fish — reseed from wherever the fish's heading actually is now, rather
  // than resuming from a stale angle it may have long since drifted away
  // from under normal AI control between drives.
  if (pressed.size === 0) pilotYaw = null;
}

export function clearKeys(): void {
  pressed.clear();
  pilotYaw = null;
}

export function getPilotedFishId(): number | null {
  return pilotedFishId;
}

export function getPilotYaw(): number | null {
  return pilotYaw;
}

export function seedPilotYaw(yaw: number): void {
  pilotYaw = yaw;
}

/** Integrates `pilotYaw` by however much `KeyA`/`KeyD` call for this frame —
 * called from `SteeringSystem.tsx`'s `useFrame`, not from
 * `ManualPilotBehaviour.calculate()`: Yuka's `SteeringManager` stops calling
 * later behaviours in a frame the instant an earlier one's force exhausts
 * `vehicle.maxForce` (`_calculateByOrder`'s own `_accumulate(force) ===
 * false` early return), which can skip `calculate()` entirely in a tight
 * avoidance corner — turning would silently stall if it depended on that
 * call happening. `useFrame` always runs, so turning always works even when
 * avoidance is starving the pilot's own thrust. No-op while unseeded (a
 * fish that isn't actively piloted yet has nothing to turn). */
export function advancePilotYaw(delta: number): void {
  if (pilotYaw === null) return;
  const turnInput = (pressed.has('KeyA') ? 1 : 0) - (pressed.has('KeyD') ? 1 : 0);
  if (turnInput === 0) return;
  pilotYaw += PILOT_TURN_RATE * turnInput * delta;
}

/** The current pilot thrust, in world space, or `null` when nobody's
 * piloted, no thrust key is held, or `pilotYaw` isn't seeded yet (thrust
 * direction comes from the driven yaw, never `vehicle.velocity` — deriving
 * it from velocity would lag a frame behind whatever `advancePilotYaw` just
 * turned to). `ManualPilotBehaviour` treats `null` as "contribute nothing",
 * not "contribute a zero vector", so it can skip the force entirely. */
export function getPilotThrust(): { x: number; y: number; z: number } | null {
  const vertical = (pressed.has('KeyR') ? 1 : 0) - (pressed.has('KeyF') ? 1 : 0);
  const forwardInput = pressed.has('KeyW') ? 1 : pressed.has('KeyS') ? -REVERSE_THRUST_FACTOR : 0;
  if (forwardInput === 0 && vertical === 0) return null;
  if (forwardInput !== 0 && pilotYaw === null) return null;

  const x = forwardInput !== 0 ? Math.sin(pilotYaw!) * forwardInput : 0;
  const z = forwardInput !== 0 ? Math.cos(pilotYaw!) * forwardInput : 0;
  const lengthSq = x * x + vertical * vertical + z * z;
  if (lengthSq === 0) return null;
  // Clamped to at most unit length, not forced *to* it — forcing it would
  // normalize `KeyS`'s deliberately weaker `REVERSE_THRUST_FACTOR` back up
  // to full strength on a pure backward press. A diagonal (e.g. `W`+`R`)
  // can still exceed length 1 before this and gets scaled down, same as
  // the old world-axis version always did.
  if (lengthSq > 1) {
    const length = Math.sqrt(lengthSq);
    return { x: x / length, y: vertical / length, z: z / length };
  }
  return { x, y: vertical, z };
}

/** Whether `critterId` is both the piloted fish *and* currently being
 * actively driven (a mapped key is down right now) — `SteeringSystem.tsx`
 * uses this to skip its non-self-propelled velocity decay and its own
 * force-budget widening (`PILOTED_MAX_FORCE`) only while a key is genuinely
 * held, not just while a fish is selected but idle, so a paused piloted
 * fish still decays and budgets normally between drives. */
export function isActivelyPiloted(critterId: number): boolean {
  return pilotedFishId === critterId && pressed.size > 0;
}
