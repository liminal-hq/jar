// Where every snail currently is, shared between the `Snail.tsx` instances
// so each can steer around the others (`snailSeparation.ts`).
//
// Deliberately a plain module-level map rather than React state or a
// zustand store: this is written and read inside `useFrame`, every frame,
// and nothing renders off it — the same reasoning that keeps each snail's
// own position in a ref rather than state. It mirrors `critterDebug.ts`'s
// shape (a tiny module-scoped bridge between components that must not
// re-render each other) rather than introducing a second steering registry
// alongside the fish's `useSteeringRegistry`, which carries Yuka vehicles a
// snail deliberately doesn't have.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { Critter } from '../../domain/protocol/generated/Critter';
import type { Vec3 } from '../environment/crawlSurfaces';

/** Owned by this module and mutated in place, never aliased to a caller's
 * own vector — a `Snail.tsx` reuses one `THREE.Vector3` for its whole life,
 * so storing the caller's object would leave every entry pointing at a
 * value that changes underneath the reader. */
const positions = new Map<Critter['id'], { x: number; y: number; z: number }>();

/** Records where `critterId` is now. Call once per frame, whatever the
 * snail is doing — a sleeping or falling snail is still something to crawl
 * around. */
export function publishSnailPosition(critterId: Critter['id'], position: Vec3): void {
  const entry = positions.get(critterId);
  if (entry) {
    entry.x = position.x;
    entry.y = position.y;
    entry.z = position.z;
    return;
  }
  positions.set(critterId, { x: position.x, y: position.y, z: position.z });
}

/** Drops a snail from the registry — unmount, or passing. */
export function forgetSnailPosition(critterId: Critter['id']): void {
  positions.delete(critterId);
}

/** Every *other* snail's position, written into `out` (which is truncated
 * first) so a caller can keep one array for the life of the component
 * rather than allocating per frame. Returns `out`. */
export function otherSnailPositions(critterId: Critter['id'], out: Vec3[]): Vec3[] {
  out.length = 0;
  for (const [id, position] of positions) {
    if (id !== critterId) out.push(position);
  }
  return out;
}
