// Shared, module-level geometry for the extruded vector fish model
// (`FishModel.tsx`) — hand-authored SVG silhouettes
// (`docs/architecture/3d-engine.md` §6.1), parsed once at import time via
// three.js's `SVGLoader` into `THREE.Shape`s and extruded into thin 3D
// slabs. Built once and reused across every fish instance (up to 10 at the
// population cap) rather than re-parsed per fish — only the body (its
// belly-gradient vertex colours differ per fish's hue) and the veil tail
// (its per-frame bend differs per fish) need their own per-instance
// geometry clone, done by `FishModel.tsx` itself; every other piece here
// is safe to share as-is, since nothing mutates it per-fish or per-frame.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

import bodySvg from './fish-svg/body.svg?raw';
import dorsalSvg from './fish-svg/dorsal-fin.svg?raw';
import gillSvg from './fish-svg/gill.svg?raw';
import mouthSvg from './fish-svg/mouth.svg?raw';
import pectoralSvg from './fish-svg/pectoral-fin.svg?raw';
import tailFanSvg from './fish-svg/tail-fan.svg?raw';
import tailForkedSvg from './fish-svg/tail-forked.svg?raw';
import tailVeilSvg from './fish-svg/tail-veil.svg?raw';

const loader = new SVGLoader();

function shapesFromSvg(svg: string): THREE.Shape[] {
  return loader.parse(svg).paths.flatMap((p) => p.toShapes(true));
}

/** SVG's Y grows downward, three.js's Y grows upward — the standard flip
 * (`NOTES.md`) mirrors the geometry, which also reverses its face winding.
 * Rather than rebuild the index buffer to un-reverse it, every fish
 * material renders both faces (`side: THREE.DoubleSide`) — three.js's
 * shader already flips the shading normal per back-facing fragment, so
 * lighting reads correctly without touching winding by hand. */
function extrude(shapes: THREE.Shape[], depth: number, bevel = 0.6): THREE.BufferGeometry {
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

/** Body depth all other pieces' overlaps/welds are measured against
 * (`NOTES.md`'s "every attachment overlaps the body by ~4 units" rule). */
export const BODY_DEPTH = 16;

/** Hinge points, already converted into three.js's post-`extrude()`-flip
 * space (negate the SVG-authored y) — `NOTES.md`: tail pivot (−60,0),
 * pectoral root (52,10), mouth hinge (90,8). */
export const TAIL_PIVOT = { x: -60, y: 0 };
export const PECTORAL_HINGE = { x: 52, y: -10 };
export const MOUTH_HINGE = { x: 90, y: -8 };

/** Geometry shared across fish instances that rotates about a hinge (tail,
 * pectoral, mouth) is pre-translated here, once, so its own local origin
 * *is* the hinge — `wrapInPivot()` below can then just position a Group at
 * the hinge and add a plain `Mesh` with no further mutation, which matters
 * because the same shared geometry gets wrapped in two independent pivots
 * for mirrored pieces (the two pectoral fins): translating inside the wrap
 * step itself would double-translate the second use. */
function extrudeAtHinge(shapes: THREE.Shape[], depth: number, hingeX: number, hingeY: number) {
  const geometry = extrude(shapes, depth);
  geometry.translate(-hingeX, -hingeY, 0);
  return geometry;
}

// `body.svg` carries three named elements (`body-back`, `body-belly`,
// `eye`) in one file — `SVGLoader` exposes the source SVG node on
// `ShapePath.userData`, so one parse of the file can be filtered by id
// rather than needing three separate SVG files for one silhouette. Parse
// once up front and reuse the result.
const bodyParsed = loader.parse(bodySvg);
function bodyShapesById(id: string): THREE.Shape[] {
  return bodyParsed.paths
    .filter((p) => p.userData?.node.id === id)
    .flatMap((p) => p.toShapes(true));
}

/** Shared, read-only — safe to reuse the same geometry across every fish
 * instance (and, for `pectoral`, across both the near and far mirrored
 * copies within one fish) since nothing mutates it per-frame or per-fish.
 * `tailFan`/`tailForked`/`pectoral`/`mouth` are pre-translated to their
 * hinge origin (see `extrudeAtHinge`); `dorsal`/`gill` are rigid (no
 * pivot) and stay in their natural authored coordinates. */
export const SHARED_GEOMETRY = {
  dorsal: extrude(shapesFromSvg(dorsalSvg), 6),
  gill: extrude(shapesFromSvg(gillSvg), 2),
  pectoral: extrudeAtHinge(shapesFromSvg(pectoralSvg), 5, PECTORAL_HINGE.x, PECTORAL_HINGE.y),
  mouth: extrudeAtHinge(shapesFromSvg(mouthSvg), BODY_DEPTH, MOUTH_HINGE.x, MOUTH_HINGE.y),
  tailFan: extrudeAtHinge(shapesFromSvg(tailFanSvg), 8, TAIL_PIVOT.x, TAIL_PIVOT.y),
  tailForked: extrudeAtHinge(shapesFromSvg(tailForkedSvg), 8, TAIL_PIVOT.x, TAIL_PIVOT.y),
};

/** Body's `body-back` shape only — per-fish clones of this are what get
 * vertex-painted with the belly gradient (`paintBellyGradient` below), so
 * this export is the template each fish clones from, not shared directly. */
export function createBodyGeometry(): THREE.BufferGeometry {
  return extrude(bodyShapesById('body-back'), BODY_DEPTH);
}

/** The veil tail needs its own per-fish geometry clone (its per-frame bend
 * differs per fish, unlike the rigid fan/forked shared geometries above) —
 * pre-translated to the tail pivot origin same as the shared tails, so the
 * bend deformer and the pivot rotation both operate in the same
 * hinge-centred local space. */
export function createVeilGeometry(): THREE.BufferGeometry {
  return extrudeAtHinge(shapesFromSvg(tailVeilSvg), 8, TAIL_PIVOT.x, TAIL_PIVOT.y);
}

/** Wraps an already-hinge-centred geometry (see `extrudeAtHinge`) in a
 * pivot `Group` positioned at that same hinge — deliberately does *not*
 * translate the geometry itself, so the same shared geometry can be
 * wrapped more than once (the mirrored pectoral pair) without
 * double-translating. */
export function wrapInPivot(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  hingeX: number,
  hingeY: number,
): THREE.Group {
  const mesh = new THREE.Mesh(geometry, material);
  const pivot = new THREE.Group();
  pivot.position.set(hingeX, hingeY, 0);
  pivot.add(mesh);
  return pivot;
}

/** Belly isn't a flat sticker on one face — it's the body mesh itself,
 * vertex-painted by height, so it wraps the whole rounded volume and reads
 * correctly from every angle (including from underneath and from the back)
 * — matches the vertex-colour belly gradient `docs/architecture/3d-engine.md`
 * §6.4 specifies. `y` here is already in three.js's post-flip space
 * (`extrude()`'s `scale(1,-1,1)`), so low y is the belly and high y is the
 * back. Call once per fish whenever its hue/sex-driven colours change. */
export function paintBellyGradient(
  geometry: THREE.BufferGeometry,
  bodyColour: THREE.Color,
  bellyColour: THREE.Color,
): void {
  const pos = geometry.attributes.position;
  if (!pos) return; // ExtrudeGeometry always has a position attribute; guards the type only
  const colours = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const belly = 1 - THREE.MathUtils.smoothstep(pos.getY(i), -32, -12);
    c.copy(bodyColour).lerp(bellyColour, belly);
    colours[i * 3] = c.r;
    colours[i * 3 + 1] = c.g;
    colours[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
}
