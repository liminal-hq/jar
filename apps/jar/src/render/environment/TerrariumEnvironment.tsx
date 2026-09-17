// Placeholder terrarium backdrop. Replace with the real substrate/mossy
// wall/branch (a real static collider)/foliage/heat-lamp glow per
// `docs/architecture/3d-engine.md` §8.2.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

export function TerrariumEnvironment() {
  return (
    <mesh position={[0, -1, 0]}>
      <boxGeometry args={[6, 0.2, 3]} />
      <meshStandardMaterial color="#6b5842" />
    </mesh>
  );
}
