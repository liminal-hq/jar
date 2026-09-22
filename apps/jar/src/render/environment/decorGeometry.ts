// Shared, module-level geometry for the aquarium's hand-authored decor —
// castle, plants, sand overlay — built the same way `fishGeometry.ts` builds
// the fish model: flat SVG silhouettes (`decor-svg/`) parsed once via
// `svgExtrude.ts` and extruded into thin 3D slabs. Built once at import time
// and reused across mounts, same rationale as `fishGeometry.ts`'s own
// `SHARED_GEOMETRY` (nothing here mutates per-frame or per-instance, except
// each plant blade's own per-vertex sway — see `Plants.tsx`).
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';

import castleSvg from './decor-svg/castle.svg?raw';
import plantBladeBroadSvg from './decor-svg/plant-blade-broad.svg?raw';
import plantBladeKelpSvg from './decor-svg/plant-blade-kelp.svg?raw';
import sandTopSvg from './decor-svg/sand-top.svg?raw';
import { extrude, shapesFromSvg, svgLoader } from '../models/svgExtrude';

/** Converts the decor SVGs' authored units into world units — the same
 * role `fishGeometry.ts`'s `SVG_SCALE` plays for the fish, a separate
 * constant since the two art sets were authored at different scales.
 * `decorLayout.ts`'s positions/sizes are expressed in world units already
 * derived from this. */
export const DECOR_SVG_SCALE = 0.005;

/** `sand-top.svg` was authored at its own 600×300-unit viewBox, sized so
 * that at this (larger) scale it spans roughly 85% of the tank's actual
 * 6×3 floor — a separate constant from `DECOR_SVG_SCALE` rather than
 * redrawing the SVG at that scale's much larger unit count. */
export const SAND_SVG_SCALE = 0.0083;

// `castle.svg` carries multiple named pieces in one file (`keep-body`,
// `merlons`, `tower-body`, `tower-roof`) — same id-filtering pattern as
// `fishGeometry.ts`'s `bodyShapesById`, since `SVGLoader` exposes the
// source SVG node on `ShapePath.userData`.
const castleParsed = svgLoader.parse(castleSvg);
function shapesById(parsed: ReturnType<typeof svgLoader.parse>, id: string): THREE.Shape[] {
  return parsed.paths.filter((p) => p.userData?.node.id === id).flatMap((p) => p.toShapes(true));
}

const sandTopParsed = svgLoader.parse(sandTopSvg);

/** Shared, read-only — safe to reuse across every mount, same rationale as
 * `fishGeometry.ts`'s `SHARED_GEOMETRY`. `towerBody`/`towerRoof` are
 * authored at their own local origin (tower base centre) and positioned
 * twice by `Castle.tsx`, the same "one shared geometry, two placed
 * instances" pattern `fishGeometry.ts` uses for the mirrored pectoral fin. */
export const CASTLE_GEOMETRY = {
  // A real cut-through hole for the doorway (`castle.svg`'s own header
  // comment) — depth matches the keep wall's own thickness.
  keepBody: extrude(shapesById(castleParsed, 'keep-body'), 110),
  merlons: extrude(shapesById(castleParsed, 'merlons'), 110),
  towerBody: extrude(shapesById(castleParsed, 'tower-body'), 90),
  towerRoof: extrude(shapesById(castleParsed, 'tower-roof'), 90),
};

/** A single kelp/broadleaf blade's rest-pose geometry — `Plants.tsx` clones
 * one of these per blade instance (its per-frame sway bend differs per
 * blade, same reason `fishGeometry.ts`'s veil tail needs its own clone
 * rather than sharing one mutable geometry across fish). */
export function createKelpBladeGeometry(): THREE.BufferGeometry {
  return extrude(shapesFromSvg(plantBladeKelpSvg), 7);
}

export function createBroadBladeGeometry(): THREE.BufferGeometry {
  return extrude(shapesFromSvg(plantBladeBroadSvg), 7);
}

/** Shared — the sand overlay and its pebbles never move or differ per
 * instance (there's exactly one sand floor). */
export const SAND_GEOMETRY = {
  top: extrude(shapesById(sandTopParsed, 'sand-top'), 10),
  rock: extrude(shapesById(sandTopParsed, 'rock'), 26),
  pebbles: extrude(shapesById(sandTopParsed, 'pebbles'), 18),
};
