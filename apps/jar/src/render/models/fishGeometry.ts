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
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';

import bodySvg from './fish-svg/body.svg?raw';
import dorsalSvg from './fish-svg/dorsal-fin.svg?raw';
import gillSvg from './fish-svg/gill.svg?raw';
import mouthSvg from './fish-svg/mouth.svg?raw';
import pectoralSvg from './fish-svg/pectoral-fin.svg?raw';
import tailFanSvg from './fish-svg/tail-fan.svg?raw';
import tailForkedSvg from './fish-svg/tail-forked.svg?raw';
import tailVeilSvg from './fish-svg/tail-veil.svg?raw';
import { extrude, shapesFromSvg, svgLoader } from './svgExtrude';

/** Body depth all other pieces' overlaps/welds are measured against — every
 * attachment overlaps the body by ~4 units. */
export const BODY_DEPTH = 16;

/** Converts the SVG artwork's authored units (`viewBox="-170 -110 340 220"`)
 * into world units — `FishModel.tsx` scales its whole root group by this
 * (times life-stage scale), and `Fish.tsx` needs the same factor to size a
 * collider that actually matches what gets rendered. */
export const SVG_SCALE = 0.004;

/** §6.7's modest fin scale-up for males, applied to the tail group only —
 * shared here (not just local to `FishModel.tsx`) because `Fish.tsx`'s
 * collider sizing needs to account for it too: a male's tail is the single
 * largest thing on the model. */
export const MALE_TAIL_SCALE = 1.2;

/** Raw SVG-space distance from the model's local origin (0,0) to each tail
 * shape's farthest point — read directly off `fish-svg/tail-*.svg`'s own
 * path data (root at the shared `TAIL_PIVOT.x` = −60, tip beyond it). This
 * is always the model's true bounding radius: further out than the nose
 * (body's rightmost point, SVG x=100) in every fin type, and by a wide
 * enough margin that a flat "nose vs. tail, take the max" isn't needed
 * elsewhere — `Fish.tsx`'s collider sizing uses this directly. */
export const TAIL_TIP_SVG_DISTANCE: Record<'Fan' | 'Forked' | 'Veil', number> = {
  Fan: 127,
  Forked: 114,
  Veil: 151,
};

/** Raw SVG-space distance from the model's local origin to (just past) the
 * dorsal crest's highest point — `fish-svg/dorsal-fin.svg`'s crest is
 * built from a cubic Bezier whose middle control point sits at SVG y=−73;
 * the curve's own actual extremum is slightly less extreme than that
 * (a Bezier curve never exceeds its control points' convex hull), so this
 * is a safe, mildly conservative bound on the true silhouette, not a
 * laser-measured one. Still comfortably higher than the belly's own max
 * extent (`body.svg`'s `body-back` path reaches y=46) and a male tail's
 * bottom extent, for every fin/sex combination —
 * `render/tank/fishCollider.ts`'s collider sizing uses this directly. */
export const DORSAL_CREST_SVG_DISTANCE = 73;

/** Hinge points, already converted into three.js's post-`extrude()`-flip
 * space (negate the SVG-authored y): tail pivot (−60,0), pectoral root
 * (52,10), mouth hinge (90,8). */
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
const bodyParsed = svgLoader.parse(bodySvg);
function bodyShapesById(id: string): THREE.Shape[] {
  return bodyParsed.paths
    .filter((p) => p.userData?.node.id === id)
    .flatMap((p) => p.toShapes(true));
}

/** Shared, read-only — safe to reuse across every fish instance (and, for
 * `pectoral`, across both the near and far mirrored copies within one
 * fish) since nothing mutates it per-frame or per-fish. These three sit
 * forward of the swim wave's onset (`swimWave.ts`'s `SWIM_WAVE_ONSET_X`)
 * and stay rigid; the tail and dorsal fin deform per-frame per-fish now,
 * so they're per-fish clones instead (`createTailGeometry`/
 * `createDorsalGeometry` below), not shared here. `pectoral`/`mouth` are
 * pre-translated to their hinge origin (see `extrudeAtHinge`); `gill` is
 * rigid (no pivot) and stays in its natural authored coordinates. */
export const SHARED_GEOMETRY = {
  gill: extrude(shapesFromSvg(gillSvg), 2),
  pectoral: extrudeAtHinge(shapesFromSvg(pectoralSvg), 5, PECTORAL_HINGE.x, PECTORAL_HINGE.y),
  mouth: extrudeAtHinge(shapesFromSvg(mouthSvg), BODY_DEPTH, MOUTH_HINGE.x, MOUTH_HINGE.y),
};

/** Body's `body-back` shape only — per-fish clones of this are what get
 * vertex-painted with the belly gradient (`paintBellyGradient` below), so
 * this export is the template each fish clones from, not shared directly. */
export function createBodyGeometry(): THREE.BufferGeometry {
  return extrude(bodyShapesById('body-back'), BODY_DEPTH);
}

const TAIL_SVG_BY_FIN: Record<'Fan' | 'Forked' | 'Veil', string> = {
  Fan: tailFanSvg,
  Forked: tailForkedSvg,
  Veil: tailVeilSvg,
};

/** Every fin type gets its own per-fish geometry clone — the swim wave
 * deforms all three per-frame per-fish (`swimWave.ts`). Pre-translated to
 * the tail pivot origin (`extrudeAtHinge`) so the wave operates in the same
 * hinge-centred local space `FishModel.tsx` mounts the mesh at.
 * `tailScale` (`MALE_TAIL_SCALE` for males, `1` otherwise) is baked
 * directly into the clone via a uniform scale about that same
 * hinge-centred origin, so `Fish.tsx`'s collider math (which assumes a
 * uniform scale about the hinge) needs no changes. */
export function createTailGeometry(
  finType: 'Fan' | 'Forked' | 'Veil',
  tailScale: number,
): THREE.BufferGeometry {
  const geometry = extrudeAtHinge(
    shapesFromSvg(TAIL_SVG_BY_FIN[finType]),
    8,
    TAIL_PIVOT.x,
    TAIL_PIVOT.y,
  );
  if (tailScale !== 1) geometry.scale(tailScale, tailScale, tailScale);
  return geometry;
}

/** The dorsal fin spans into the swim wave's bend zone (`swimWave.ts`) —
 * left rigid it would visibly shear off the body's back at higher
 * amplitudes, so it needs its own per-fish clone to deform in step with
 * the body, same rationale as the tail above. */
export function createDorsalGeometry(): THREE.BufferGeometry {
  return extrude(shapesFromSvg(dorsalSvg), 6);
}

/** Wraps an already-hinge-centred geometry (see `extrudeAtHinge`) in a
 * pivot `Group` positioned at that same hinge — deliberately does *not*
 * translate the geometry itself, so the same shared geometry can be
 * wrapped more than once (the mirrored pectoral pair) without
 * double-translating. Only ever used for the pectoral fins/mouth
 * (`FishModel.tsx`), both of which flutter/open every frame — no
 * `castShadow` (issue #94: `TankScene.tsx` freezes the tank's shadow map
 * after its first frame, so a moving caster's shadow would freeze
 * mid-motion instead of tracking it). */
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
