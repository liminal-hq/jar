// Shared SVG-parse-and-extrude primitives — split out of `fishGeometry.ts`
// so any hand-authored flat-vector piece (fish, or tank decor in
// `render/environment/`) can use the same technique without importing a
// fish-named module. Nothing here is fish-specific.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

export const svgLoader = new SVGLoader();

export function shapesFromSvg(svg: string): THREE.Shape[] {
  return svgLoader.parse(svg).paths.flatMap((p) => p.toShapes(true));
}

/** SVG's Y grows downward, three.js's Y grows upward — the standard flip
 * mirrors the geometry, which also reverses its face winding. Rather than
 * rebuild the index buffer to un-reverse it, every piece built from this
 * renders both faces (`side: THREE.DoubleSide`) — three.js's shader already
 * flips the shading normal per back-facing fragment, so lighting reads
 * correctly without touching winding by hand. */
export function extrude(shapes: THREE.Shape[], depth: number, bevel = 0.6): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 20,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.scale(1, -1, 1);
  return geometry;
}
