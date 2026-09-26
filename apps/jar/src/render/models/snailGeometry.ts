// Shared, module-level geometry for the extruded vector snail model
// (`SnailModel.tsx`) — hand-authored SVG silhouettes (`snail-svg/`, issue
// #98's art proposal), parsed once at import time via three.js's
// `SVGLoader` into `THREE.Shape`s and extruded into thin 3D slabs, mirroring
// `fishGeometry.ts`'s own discipline exactly. Shell geometry (base +
// identity/pattern decals + operculum) is shared across every snail of a
// given shell type, since none of it is per-snail vertex-painted; only the
// foot needs a per-snail clone (its sole gets a per-snail hue-derived
// vertex-colour gradient, `paintSoleGradient`, the snail's belly gradient).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as THREE from 'three';

import type { Pattern } from '../../domain/protocol/generated/Pattern';
import type { ShellType } from '../../domain/protocol/generated/ShellType';
import eyestalkSvg from './snail-svg/eyestalk.svg?raw';
import footSvg from './snail-svg/foot.svg?raw';
import shellCoilSvg from './snail-svg/shell-coil.svg?raw';
import shellRamshornSvg from './snail-svg/shell-ramshorn.svg?raw';
import shellTurretSvg from './snail-svg/shell-turret.svg?raw';
import { extrude, extrudeAtHinge, shapesFromSvg, svgLoader } from './svgExtrude';

// Genuinely species-neutral — re-exported unchanged so `SnailModel.tsx` and
// PR 6's `snailCollider.ts` can import it from here, mirroring how
// `fishCollider.ts` imports it from `fishGeometry.ts`.
export { SVG_SCALE } from './svgExtrude';

/** A snail-specific size multiplier, layered on top of the shared
 * `SVG_SCALE`/`lifeStageScale` chain every species otherwise uses
 * unmodified — without it, an adult snail's measured foot span
 * (`FOOT_TOE_X - FOOT_TAIL_TIP_X` below, ×`SVG_SCALE`) lands at ~0.88 world
 * units, the same size class as an adult fish (`fishGeometry.ts`'s own
 * nose/tail-tip constants put a fish at ~0.86–1.00). A snail crawling on the
 * castle reads as a much smaller creature than a fish swimming past it, so
 * this brings an adult snail down to roughly 55–60% of an adult fish's
 * length. Tune by eye; every consumer (`Snail.tsx`, `SnailModel.tsx`,
 * `snailCollider.ts`) must apply this alongside `SVG_SCALE`/`lifeStageScale`
 * so the visible body, its physics collider, and the Critter Card's
 * counter-scaled portrait (`CritterPreview.tsx`) all move together. */
export const SNAIL_BODY_SCALE = 0.6;

/** Foot extrusion depth — the same for every shell type (issue #98's
 * assembly table); the fish body is 16. */
export const FOOT_DEPTH = 18;

/** Eyestalk extrusion depth (the fish's pectoral fin is 5). */
export const EYESTALK_DEPTH = 4;

/** Thin face-decal extrusion depth for shell whorls/rings/bands/spots and
 * the operculum's nucleus marking — the `gill.svg` treatment: mirrored onto
 * both faces, never at full shell depth (issue #98's own flag #1: "must not
 * extrude at full shell depth or they'd stripe the shell's rim"). */
export const DECAL_DEPTH = 2;

/** Shell extrusion depth per shell type (issue #98's assembly table) —
 * Ramshorn's thin 14-unit slab is load-bearing: it's what keeps it reading
 * as a disc, roughly half the Coil's depth, rather than a smaller coil
 * (issue #98's flag #4). */
export const SHELL_EXTRUSION_DEPTH: Record<ShellType, number> = {
  Coil: 34,
  Ramshorn: 14,
  Turret: 24,
};

/** `shell depth − 6` per shell type — the sealed-pose operculum plate sits
 * recessed inside the shell's own extrusion by 3 units on each face rather
 * than capping it proud (issue #98's sealed-pose spec: "operculum extrudes
 * at shell depth − 6"). Derived from `SHELL_EXTRUSION_DEPTH` rather than
 * duplicated as its own literal table, so the two can never drift apart. */
export const OPERCULUM_EXTRUSION_DEPTH: Record<ShellType, number> = Object.fromEntries(
  (Object.entries(SHELL_EXTRUSION_DEPTH) as Array<[ShellType, number]>).map(([shell, depth]) => [
    shell,
    depth - 6,
  ]),
) as Record<ShellType, number>;

/** Apex height above the sole/contact line, in raw SVG units — read
 * directly off each shell path's own topmost control point (issue #98's
 * assembly table), the same "measured off the authored path data" style as
 * `fishGeometry.ts`'s `TAIL_TIP_SVG_DISTANCE`/`DORSAL_CREST_SVG_DISTANCE`.
 * Turret is genuinely the tallest — PR 6's `snailCollider.ts` uses this
 * directly for its per-shell box height. */
export const SHELL_APEX_HEIGHT_ABOVE_SOLE: Record<ShellType, number> = {
  Coil: 66,
  Ramshorn: 66,
  Turret: 83,
};

/** The foot silhouette's raw SVG extremes (`foot.svg`'s own path data) —
 * toe at the front, tail tip at the back; PR 6's `snailCollider.ts` derives
 * its length half-extent from this span, the way `fishCollider.ts` uses
 * `TAIL_TIP_SVG_DISTANCE`. */
export const FOOT_TOE_X = 96;
export const FOOT_TAIL_TIP_X = -125;

/** The foot's sole — the crawl-surface contact line every surface in
 * `crawlSurfaces.ts` (PR 4) sits the snail on — authored as a dead-flat
 * line at raw SVG `y=70`. `extrude()`'s y-flip (`svgExtrude.ts`) puts it
 * here, in this module's local (pre-`SVG_SCALE`, pre-life-stage-scale)
 * space. Every other constant below that's "in three.js space" uses this
 * same convention: raw SVG y, negated. */
export const SOLE_Y = -70;

/** The foot's raised top plateau (raw SVG `y=34`) — the shell's resting
 * seat while awake. */
export const FOOT_PLATEAU_Y = -34;

/** Every shell's own authored base line (raw SVG `y=40`), overlapping the
 * foot's plateau by 6 units so the extruded slabs weld seamlessly (the
 * fish's own overlap rule is ~4; shells are bigger pieces). */
export const SHELL_BASE_Y = -40;

/** How far the shell assembly drops while sealing, so its base lands
 * exactly on the sole/contact line — derived (not a second literal) so it's
 * always consistent with `SHELL_BASE_Y`/`SOLE_Y`: `SHELL_BASE_Y -
 * SHELL_SEALED_DROP === SOLE_Y`. Matches issue #98's spec of "30 units."
 * Applied as a negative y offset on the shell group (three.js y decreases
 * as the raw-SVG shell moves further down the page). */
export const SHELL_SEALED_DROP = SHELL_BASE_Y - SOLE_Y;

/** Hinge point, already converted into three.js's post-`extrude()`-flip
 * space (negate the SVG-authored y) — mirrors `fishGeometry.ts`'s
 * `TAIL_PIVOT`/`PECTORAL_HINGE`/`MOUTH_HINGE` convention. */
export const EYESTALK_HINGE = { x: 84, y: -6 };

/** Eye bulb position, already hinge-relative (the raw stalk's own absolute
 * tip position, `(106, 55)` in this module's three.js-space convention,
 * minus `EYESTALK_HINGE`) — `SnailModel.tsx` adds a small sphere as an
 * extra child of the same pivot `wrapInPivot` (`svgExtrude.ts`) returns for
 * the stalk mesh, at this local position, so eye and stalk sway and fold
 * together. */
export const EYESTALK_EYE = { x: 22, y: 61, r: 7 };

/** Rotating the stalk pivot by (the negative of) its own resting angle —
 * `atan2` of the hinge-relative eye position above — lays the stalk down
 * flat along local +x, folding it toward the head, rather than an
 * arbitrary hand-picked angle. Used by `SnailModel.tsx`'s sleep/startle
 * tuck animation. */
export const EYESTALK_FOLD_ROTATION_Z = -Math.atan2(EYESTALK_EYE.y, EYESTALK_EYE.x);

/** The lighter sole band's height, in raw SVG units, off the foot's own
 * bottom edge (issue #98's assembly table: "bottom ~14 units of the foot")
 * — in 3D this isn't its own extruded shape (`foot-sole` in `foot.svg` is a
 * 2D stand-in only), it's the vertex-colour gradient `paintSoleGradient`
 * paints onto the foot mesh itself, the snail's belly-gradient equivalent
 * (`fishGeometry.ts`'s `paintBellyGradient`). */
export const FOOT_SOLE_GRADIENT_HEIGHT = 14;

const footParsed = svgLoader.parse(footSvg);
function footShapesById(id: string): THREE.Shape[] {
  return footParsed.paths
    .filter((p) => p.userData?.node.id === id)
    .flatMap((p) => p.toShapes(true));
}

/** Per-snail clone template: each snail's own hue drives `paintSoleGradient`
 * below, so (like the fish body) this can't be shared read-only across
 * instances. */
export function createFootGeometry(): THREE.BufferGeometry {
  return extrude(footShapesById('foot'), FOOT_DEPTH);
}

/** Sole isn't a flat sticker on one face — it's the foot mesh itself,
 * vertex-painted by height, mirroring `fishGeometry.ts`'s
 * `paintBellyGradient` exactly (see that function's own doc comment for why
 * a vertex gradient reads correctly from every angle where a decal
 * wouldn't). `y` is already in this module's three.js-space convention
 * (`SOLE_Y`), so low y is the sole and high y is the rest of the foot. Call
 * once per snail whenever its hue-driven colours change. */
export function paintSoleGradient(
  geometry: THREE.BufferGeometry,
  footColour: THREE.Color,
  soleColour: THREE.Color,
): void {
  const pos = geometry.attributes.position;
  if (!pos) return; // ExtrudeGeometry always has a position attribute; guards the type only
  const colours = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const soleness =
      1 - THREE.MathUtils.smoothstep(pos.getY(i), SOLE_Y, SOLE_Y + FOOT_SOLE_GRADIENT_HEIGHT);
    c.copy(footColour).lerp(soleColour, soleness);
    colours[i * 3] = c.r;
    colours[i * 3 + 1] = c.g;
    colours[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
}

/** Shared, read-only — safe to reuse across every snail instance sharing an
 * eyestalk (both the near and far mirrored copies within one snail, and
 * across every snail), since nothing mutates it per-frame or per-snail;
 * sway/fold is a pivot-group rotation, not a geometry rewrite. */
export const EYESTALK_GEOMETRY = extrudeAtHinge(
  shapesFromSvg(eyestalkSvg),
  EYESTALK_DEPTH,
  EYESTALK_HINGE.x,
  EYESTALK_HINGE.y,
);

const SHELL_SVG: Record<ShellType, string> = {
  Coil: shellCoilSvg,
  Ramshorn: shellRamshornSvg,
  Turret: shellTurretSvg,
};

const shellParsedByType: Record<ShellType, ReturnType<typeof svgLoader.parse>> = {
  Coil: svgLoader.parse(SHELL_SVG.Coil),
  Ramshorn: svgLoader.parse(SHELL_SVG.Ramshorn),
  Turret: svgLoader.parse(SHELL_SVG.Turret),
};

function shellShapesById(shell: ShellType, id: string): THREE.Shape[] {
  return shellParsedByType[shell].paths
    .filter((p) => p.userData?.node.id === id)
    .flatMap((p) => p.toShapes(true));
}

/** Always-shown shell-identity decals — each shell type's own whorl/rings/
 * core/tip, riding the base `shell` silhouette the way `gill.svg` rides the
 * fish body: present regardless of the `Pattern` gene (that's
 * `shellPatternDecalIds` below), thin face decals mirrored onto both
 * faces. */
const SHELL_IDENTITY_DECAL_IDS: Record<ShellType, string[]> = {
  Coil: ['shell-whorl'],
  Ramshorn: ['shell-ring-outer', 'shell-ring-inner', 'shell-core'],
  Turret: ['shell-tip'],
};

const SHELL_BANDED_DECAL_IDS: Record<ShellType, string[]> = {
  Coil: ['shell-band'],
  Ramshorn: ['shell-band'],
  Turret: ['shell-band-1', 'shell-band-2', 'shell-band-3', 'shell-band-4'],
};

const SHELL_SPOTTED_DECAL_IDS: Record<ShellType, string[]> = {
  Coil: [
    'shell-spot-1',
    'shell-spot-2',
    'shell-spot-3',
    'shell-spot-4',
    'shell-spot-5',
    'shell-spot-6',
  ],
  Ramshorn: ['shell-spot-1', 'shell-spot-2', 'shell-spot-3', 'shell-spot-4'],
  Turret: ['shell-spot-1', 'shell-spot-2', 'shell-spot-3', 'shell-spot-4'],
};

/** Path ids always shown for a shell type, regardless of the `Pattern`
 * gene. Pure and three-free — testable without touching `SVGLoader`. */
export function shellIdentityDecalIds(shell: ShellType): string[] {
  return SHELL_IDENTITY_DECAL_IDS[shell];
}

/** Path ids for the `Pattern`-gated decal layer — `[]` for `Solid`. Pure
 * and three-free, same rationale as `shellIdentityDecalIds`. */
export function shellPatternDecalIds(shell: ShellType, pattern: Pattern): string[] {
  if (pattern === 'Banded') return SHELL_BANDED_DECAL_IDS[shell];
  if (pattern === 'Spotted') return SHELL_SPOTTED_DECAL_IDS[shell];
  return [];
}

interface ShellDecal {
  id: string;
  geometry: THREE.BufferGeometry;
}

export interface ShellAssets {
  base: THREE.BufferGeometry;
  identityDecals: ShellDecal[];
  patternDecals: Record<'Banded' | 'Spotted', ShellDecal[]>;
  operculum: THREE.BufferGeometry;
  operculumNucleus: THREE.BufferGeometry;
}

function decalsFor(shell: ShellType, ids: string[]): ShellDecal[] {
  return ids.map((id) => ({ id, geometry: extrude(shellShapesById(shell, id), DECAL_DEPTH) }));
}

function buildShellAssets(shell: ShellType): ShellAssets {
  return {
    base: extrude(shellShapesById(shell, 'shell'), SHELL_EXTRUSION_DEPTH[shell]),
    identityDecals: decalsFor(shell, shellIdentityDecalIds(shell)),
    patternDecals: {
      Banded: decalsFor(shell, shellPatternDecalIds(shell, 'Banded')),
      Spotted: decalsFor(shell, shellPatternDecalIds(shell, 'Spotted')),
    },
    operculum: extrude(shellShapesById(shell, 'operculum'), OPERCULUM_EXTRUSION_DEPTH[shell]),
    operculumNucleus: extrude(shellShapesById(shell, 'operculum-nucleus'), DECAL_DEPTH),
  };
}

/** Shared, read-only per shell type — safe to reuse across every snail
 * instance with that shell (nothing here is per-snail vertex-painted or
 * per-frame deformed), mirroring `fishGeometry.ts`'s `SHARED_GEOMETRY`. */
export const SHELL_ASSETS: Record<ShellType, ShellAssets> = {
  Coil: buildShellAssets('Coil'),
  Ramshorn: buildShellAssets('Ramshorn'),
  Turret: buildShellAssets('Turret'),
};

export interface TuckPose {
  eyestalkFold: number;
  footWithdraw: number;
  shellSettle: number;
  operculumSeal: number;
}

/** Fixed phase windows over the sleep/wake timeline's normalized `t` (0 =
 * fully awake/emerged, 1 = fully sealed) — issue #98's settled spec: "stalks
 * fold over the first 45%, foot withdraws from 10–72%, operculum slides +
 * fades over the last 30%." Shell settling isn't separately specified in
 * the issue — a judgement call ties it to the same window as the foot
 * withdrawal: the foot drawing up is literally what lets the shell drop
 * onto the contact line, so the two progress together, finishing just as
 * the operculum begins sealing. */
const EYESTALK_FOLD_WINDOW: readonly [number, number] = [0, 0.45];
const FOOT_WITHDRAW_WINDOW: readonly [number, number] = [0.1, 0.72];
const SHELL_SETTLE_WINDOW: readonly [number, number] = FOOT_WITHDRAW_WINDOW;
const OPERCULUM_SEAL_WINDOW: readonly [number, number] = [0.7, 1];

function windowProgress(t: number, [start, end]: readonly [number, number]): number {
  return THREE.MathUtils.clamp((t - start) / (end - start), 0, 1);
}

/** The tuck timeline at normalized progress `t` — a pure function with no
 * three.js side effects, so `SnailModel.tsx` (and later `Snail.tsx`'s state
 * machine, PR 6) can drive `t` from any easing/duration they choose. */
export function tuckPose(t: number): TuckPose {
  return {
    eyestalkFold: windowProgress(t, EYESTALK_FOLD_WINDOW),
    footWithdraw: windowProgress(t, FOOT_WITHDRAW_WINDOW),
    shellSettle: windowProgress(t, SHELL_SETTLE_WINDOW),
    operculumSeal: windowProgress(t, OPERCULUM_SEAL_WINDOW),
  };
}

/** The startle reaction is "the identical rig, shorter run, no operculum
 * phase" (issue #98) — the same timeline, just never driven past the start
 * of the operculum-seal window, so the operculum never begins sealing.
 * (Not the end of the foot-withdrawal window: that window runs to `0.72`,
 * past the operculum window's own `0.7` start, so capping there would still
 * let a sliver of seal through.) */
export const STARTLE_MAX_PROGRESS = OPERCULUM_SEAL_WINDOW[0];

export function tuckPoseForMode(t: number, mode: 'sleep' | 'startle'): TuckPose {
  return tuckPose(mode === 'startle' ? Math.min(t, STARTLE_MAX_PROGRESS) : t);
}
