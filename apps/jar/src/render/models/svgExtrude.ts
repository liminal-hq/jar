// Shared SVG-parse-and-extrude primitives — split out of `fishGeometry.ts`
// so any hand-authored flat-vector piece (fish, or tank decor in
// `render/environment/`) can use the same technique without importing a
// fish-named module. Nothing here is fish-specific.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

export const svgLoader = new SVGLoader();

export function shapesFromSvg(svg: string): THREE.Shape[] {
  return svgLoader.parse(svg).paths.flatMap((p) => p.toShapes(true));
}

/** A Y-mirror (`scale(1,-1,1)`) transforms an existing normal attribute via
 * the matrix's normal matrix, same as it transforms positions — but a
 * mirror is a reflection (negative determinant), and a reflection inverts
 * handedness: the transformed normals end up geometrically inward-facing
 * relative to the now-mirrored triangle winding, not outward, unless the
 * winding itself is also reversed to match. Three.js's `BufferGeometry`
 * transform methods only ever touch attribute *values*, never index
 * *topology*, so nothing does that second half automatically — this does
 * it by hand.
 *
 * `THREE.ExtrudeGeometry` builds *non-indexed* geometry (`geometry.index`
 * is `null`), so an index-only implementation here would be a silent
 * no-op for every caller. Every 3 consecutive vertices form one triangle
 * in non-indexed geometry, so "reverse the winding" here means swapping
 * each attribute's own values (position, normal, uv — whatever
 * `ExtrudeGeometry` populated) between a triangle's 2nd and 3rd vertex,
 * not touching an index buffer that doesn't exist. */
function reverseWinding(geometry: THREE.BufferGeometry): void {
  const index = geometry.index;
  if (index) {
    const array = index.array;
    for (let i = 0; i + 2 < array.length; i += 3) {
      const b = array[i + 1]!;
      array[i + 1] = array[i + 2]!;
      array[i + 2] = b;
    }
    index.needsUpdate = true;
    return;
  }

  const position = geometry.attributes.position;
  if (!position) return;
  const vertexCount = position.count;
  for (const attribute of Object.values(geometry.attributes)) {
    if (!(attribute instanceof THREE.BufferAttribute)) continue; // not used by extrude()'s output
    const itemSize = attribute.itemSize;
    const array = attribute.array;
    const scratch = new Array<number>(itemSize);
    for (let v = 0; v + 2 < vertexCount; v += 3) {
      const bStart = (v + 1) * itemSize;
      const cStart = (v + 2) * itemSize;
      for (let k = 0; k < itemSize; k++) scratch[k] = array[bStart + k]!;
      for (let k = 0; k < itemSize; k++) array[bStart + k] = array[cStart + k]!;
      for (let k = 0; k < itemSize; k++) array[cStart + k] = scratch[k]!;
    }
    attribute.needsUpdate = true;
  }
}

/** SVG's Y grows downward, three.js's Y grows upward — the standard flip
 * mirrors the geometry, and `reverseWinding` un-reverses the winding that
 * mirror flips, so the resulting normal is genuinely outward-facing from
 * every angle rather than only *looking* right from whichever direction
 * the camera happens to view it from — see `reverseWinding`'s own doc
 * comment for why a plain mirror alone isn't enough. */
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
  reverseWinding(geometry);
  return geometry;
}
