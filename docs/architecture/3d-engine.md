# Jar — 3D engine & model spec (companion to `SPEC.md`)

This document augments `SPEC.md` and `SCREENS.md`. It does not replace anything in them — the positioning (§1), platforms (§2), theme system (§4), persistence (§6) and out-of-scope list (§7) of `SPEC.md`, and the full window/screen inventory in `SCREENS.md`, all stand as written. This doc replaces **only** the _rendering_ half of `SCREENS.md`'s W1 (Tank) and the _movement/render_ half of `SPEC.md` §5 (Simulation) — i.e. everything downstream of "here is a critter's state," not the state itself.

Hand this file, `SPEC.md` and `SCREENS.md` together to the implementing agent. Where they disagree, this file wins for anything 3D/render/physics; `SPEC.md`/`SCREENS.md` win for everything else (windows, themes, persistence, sim rules for aging/breeding/mood). The Rust simulation core (`docs/architecture/rust-core.md`) owns the discrete sim-tick logic this file's §3 bridges to; see that document for the process/language boundary.

Audience: an AI coding agent (or a human) implementing this cold in a Tauri v2 + React app. Nothing here is conservative by design — this is the "build it properly" version, not the minimum viable slice. Sequencing that into a hobby-pace roadmap is a separate exercise; this doc just specifies the target.

---

## 0. What's changing and why

`Jar.dc.html` is a Claude Design authoring-tool artifact, not application code — it's built on that tool's own preview runtime (`<x-dc>`, `<sc-if>`, `<sc-for>`, `{{ }}` template bindings, a `DCLogic`-derived `Component` class) so a design doc can render as a live mock. None of that scaffolding exists in a real Tauri/React app and nothing in the file should be ported, adapted, or structurally mirrored — an implementor should not be reaching into it for code to reuse, and shouldn't feel bound by how it happens to be organized.

What _is_ worth pulling from it is the **behavior it specifies**: the sim's rules and constants (aging/mood/energy/breeding/passing, the genetics formulas in `make()`, jar-day timing), the theme/frame color and layout values, and the window/dialog content — in other words, everything `SPEC.md` describes in prose, which `Jar.dc.html` happens to also render as a working mock. Treat the file the same way you'd treat a screenshot with annotations: authoritative about what the thing should look like and do, silent on how the real implementation should be built. The one part of its actual rendering approach worth naming explicitly as _not_ carrying forward is the movement/render loop — `requestAnimationFrame` + `forceUpdate()` driving a `svg()` function that draws flat SVG at CSS `left/top` percentages. Section 3 below specifies its replacement from scratch.

Net effect: W1's tank interior becomes a `@react-three/fiber` `<Canvas>` sitting inside the existing bezel chrome. W2/W3/W4 (critter card, family tree, setup) and the drawer stay exactly as designed — flat HTML/CSS, built fresh in idiomatic React rather than adapted from the prototype's template markup, themed per §4 of `SPEC.md`. The one exception: W2's portrait is a second, small `<Canvas>` reusing `FishModel` as-is (`CritterPreview.tsx`) rather than a flattened sprite, so the card shows the exact same rig/hue/gene-driven shape the tank does, rotatable via `OrbitControls`. Everything else about W2, and all of W3/W4, stays flat HTML/CSS.

---

## 1. Rendering stack

- **Renderer:** `@react-three/fiber` (R3F) over `three.js`. Not Babylon, not a full game engine — R3F drops a scene graph into the existing React tree the same way the drawer and dialog windows already live there. No second UI paradigm, no imperative bridge to maintain.
- **Backend:** WebGL2 as the baseline, unconditionally. three's `WebGPURenderer` with automatic WebGL2 fallback may be adopted later as a progressive enhancement once WebGPU support is verified stable across both WebView2 (Windows) and WebKitGTK (Linux) targets — do not gate v1 on it.
- **Helpers:** `@react-three/drei` (loaders, `useGLTF`, `Sparkles` as a fallback particle primitive), `@react-three/rapier` (physics, §5), `@react-three/postprocessing` (CRT/neon frame effect only, §10.3).
- **Steering/AI:** `yuka` (engine-agnostic, MIT). Not a peer of R3F — it's a plain TS library that computes desired velocities; nothing about it touches the renderer.

### 1.1 Transparency (the tank window is see-through by design)

`SPEC.md` §2 already requires `transparent: true`, `decorations: false` on the W1 `WebviewWindow`. The 3D canvas must be transparent _inside_ that window too, or the "glass"/"cardboard"/etc. bezel will show a black box instead of the tank contents. Required, in this order:

```jsx
<Canvas
  gl={{
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
    powerPreference: 'low-power', // this is a background desktop toy, not a game
  }}
  onCreated={({ gl, scene }) => {
    gl.setClearColor(0x000000, 0); // fully transparent clear
    scene.background = null;
    scene.environment = null;
  }}
/>
```

`THREE.ColorManagement.enabled = false` before the `Canvas` mounts, and avoid R3F's `legacy` prop unless a specific color-management symptom (washed-out or oversaturated hues) forces it — try without first, since newer R3F/three versions have largely fixed the transparency-vs-color-space conflict that made `legacy={true}` necessary in older stacks. Verify visually on both target platforms before assuming either setting is right.

### 1.2 Linux (WebKitGTK) note

Transparency on Linux is already known-good here from prior Tauri builds, so this isn't tracked as an open risk. Worth keeping on hand regardless: WebKitGTK has a documented history of WebGL/compositing issues on some GPU/driver combinations (blank windows, resize crashes, NVIDIA DMABUF errors), and if one ever turns up, the standard fixes are env vars set before the webview is created — `WEBKIT_DISABLE_DMABUF_RENDERER=1`, or `WEBKIT_DISABLE_COMPOSITING_MODE=1` as a last resort (disables acceleration entirely). Windows (WebView2) has no equivalent history.

### 1.3 Render-loop policy

- `frameloop="always"` while the tank is visible and any critter is moving or a particle system is active (bubbles/mist run continuously, so in practice this means "always" whenever the window is on-screen).
- Pause the render loop entirely when the Tauri window is hidden/minimized or occluded — listen for Tauri's window visibility/focus events and drive R3F's `frameloop` between `"always"` and `"never"` accordingly. This is the one non-negotiable perf guard even at "worry about cost later" — an invisible window rendering 3D forever is pure waste, not a design choice.
- **This pause is render/physics-only — the sim tick keeps running regardless of window visibility.** `frameloop="never"` stops R3F's draw calls (and, in turn, there's no reason to keep stepping Rapier or updating Yuka just to feed a renderer that isn't drawing), but the 1 Hz sim tick from §3 (aging, mood/energy drift, breeding, passing) is a separate timer with no rendering dependency and must not be touched by this — a jar minimized for an hour should age and breed exactly as much as one left visible for an hour, per `SPEC.md` §5's "real time" model. Only a fully closed app stops simulated time, per `SPEC.md` §6 ("elapsed real time while closed is **not** simulated"); hidden/minimized is not closed. When the window becomes visible again, physics/steering simply resume from wherever the sim state currently is — no need to "catch up" any visual animation, since position/pose were never part of persisted state to begin with (§3's table — only stats are).
- Physics tick rate is independent of render frame rate (§5.1).

---

## 2. Coordinate system — mapping the existing 2D sim onto a 3D volume

The sim already produces `c.x`, `c.y` (both 0–100, percent of tank), `c.dir` (±1, facing left/right), and `c.wob` (a phase accumulator originally used to bob/tilt the flat sprite). None of that is thrown away — it's the input to a 3D presentation layer, not a competing system.

### 2.1 New axis: depth

`SCREENS.md` (W2, critter card) already lists **"Favourite spot (left/middle/right + depth)"** — depth was part of the design's vocabulary even though the 2D prototype never implemented it (fish only had x/y). This spec formalizes it as a real third axis rather than inventing a new concept:

- Add `c.z` (0–100, percent of tank depth) alongside `c.x`/`c.y` in the sim state, generated and wandered exactly like `c.x`/`c.y` are today.
- `fav.z` joins `fav.x`/`fav.y` on the favourite-spot object.
- Fish roam all three axes. Geckos are still primarily floor/branch bound (§4.2), so their `z` stays close to a fixed "on the glass wall / on the branch" band rather than roaming freely — this matches the original design intent (2D gecko art was explicitly "top-down, as if on the glass") while letting them read as sitting _in_ a real terrarium instead of painted on its front pane.

### 2.2 World space

- Define a **tank volume** in world units: width `W` (maps from `x`), height `H` (maps from `y`, inverted — `y=0` is the surface/top in the sim, which is `+H` in a Y-up scene), depth `D` (maps from `z`).
- Scale convention: **1 world unit ≈ 10 cm**, so a modest desktop tank is roughly 6×4×3 units. This isn't cosmetic — Rapier's gravity, damping and impulse magnitudes (§5) are tuned assuming roughly real-world scale, and picking an arbitrary unit size now means re-tuning every force constant later.
- Conversion is a pure function, `simPercentToWorld(x, y, z, clearance) → Vector3`, called once per critter per physics step to feed the target the steering layer chases. Physics/render positions are the source of truth once a critter exists (§3); the sim's `x/y/z` fields become the _intent_ signal (favourite spot, spawn point), not a per-frame authority.
- The 0-100 range maps onto the tank's walls, not the full `W`/`H`/`D` volume — and not even the walls' own inset (`TANK_INNER_BOUNDS`) by itself. The wall colliders have their own thickness (`WALL_THICKNESS`), so `TANK_INNER_BOUNDS` is each wall collider's _centre_ plane, not its clear inner face; a fish's own `BallCollider` then has its own radius beyond its centre point (up to ~0.72 world units for a male Veil-tailed adult). `simPercentToWorld`'s `clearance` parameter — a caller's own collider radius plus half the wall thickness — is what keeps a favourite spot or spawn point rolled near 0%/100% from still overlapping a wall once the fish's actual collider is accounted for.

### 2.3 Camera

- **Fixed, perspective, frontal** — no orbit controls, no user camera interaction. This is a toy you glance at, not a scene you explore (`SPEC.md` §1: "no goal, no win state"); an explorable camera fights that tone and re-opens the whole "what if they scroll behind the backdrop" problem the flat 2D version never had.
- Narrow-ish FOV (~35–40°) with camera distance chosen so the near/far clipping planes comfortably contain the tank depth without visible perspective distortion at the edges — the original art direction is a flat aquarium-glass view, and a wide FOV would undercut that on a wide/short window.
- On window resize, scale the tank volume (not the camera) to fit the new aspect ratio within the frame bezel's interior — this preserves `SPEC.md`'s "percentage-based" resizing intent (§2) directly: a critter at `x=50` is always centered regardless of window size, exactly as it is in the 2D prototype's `left: c.x + '%'`.

---

## 3. Simulation ↔ render bridge — the exact seam

Write the sim tick (1 Hz: aging, mood/energy drift, breeding, passing, naming, genetics roll) as a fresh, framework-agnostic TS module (`/src/sim/`) implementing the rules and constants `SPEC.md` §5 specifies — `Jar.dc.html`'s `simTick()`/`make()` are a working reference for what those rules produce, not code to adapt. This module has no rendering knowledge and shouldn't gain any. What's being newly built, with no prototype code to draw from at all, is everything downstream of "a critter object exists with these fields" — the replacement for the prototype's `frame()` loop and `svg()` function, specified from here on.

**Per-critter runtime split, once a critter is spawned:**

| Owns                                           | Field(s)                                                                                     | Lives in                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------- |
| Identity & stats (unchanged from `SPEC.md` §5) | `id, sp, name, hue, fin, spots, sex, trait, mood, energy, ageSec, life, gen, parents, alive` | `/src/sim` (tick-driven, 1 Hz)      |
| Intent (where does it _want_ to be)            | `x, y, z, fav.{x,y,z}` (target percents, not live position)                                  | `/src/sim`, read by steering        |
| Steering (how does it get there)               | `YUKA.Vehicle` position/velocity, active behaviors                                           | `/src/render/steering`              |
| Physical truth (where is it _actually_)        | `RigidBody` translation/rotation                                                             | Rapier world, `@react-three/rapier` |
| Presentation (how does it look doing that)     | GLTF pose, spine-wave phase, material uniforms                                               | R3F component                       |

Per frame: read the `RigidBody`'s actual position → feed it into the `YUKA.Vehicle` so steering always reasons from ground truth → `vehicle.update(delta)` produces a desired velocity → apply as a damped impulse to the `RigidBody` (§5.2) → the R3F component reads the same `RigidBody` transform to place and orient the model, and reads `desired velocity` / `turnRate` to drive the procedural animation (§6.6). Sim-tick fields (`mood`, `energy`, `trait`) modulate steering parameters (§4.1) but are never touched by the render loop — the 1 Hz tick is still the only thing that ages, breeds, or kills a critter, exactly as `SPEC.md` §5 specifies.

`c.wob` and `c.dir` from the 2D prototype are superseded: `wob` (a raw sine phase used to bob the whole sprite) is replaced by the richer procedural spine animation in §6.6, and `dir` (left/right sprite flip) is replaced by an actual heading quaternion computed from the steering velocity vector.

---

## 4. AI / steering (Yuka)

### 4.1 Fish

- **Active behaviors: `WanderBehavior` + `SeparationBehavior` + a custom `TankContainmentBehaviour`.** Deliberately _not_ `CohesionBehavior` or `AlignmentBehavior` — Jar's critters are named, individual pets, not an anonymous school; boid flocking makes multiple named fish move in lockstep, which reads as less alive, not more. `TankContainmentBehaviour` (anticipatory wall-avoidance, pushing a fish back toward centre once within a margin of any wall) is the one behavior of the three that's never mode-gated — it stays at a fixed weight of 1 in every motion mode, including `paused`/`settled`, since even a resting fish shouldn't be able to drift into the glass. `Wander`/`Separation` (and, mode-dependent, `Arrive`) instead fade their own `.weight` toward a per-mode target over time rather than snapping on/off — an instant behavior-set flip was a real, fixed stutter bug (a full-strength `ArriveBehavior` force landing in one frame at every night settle/wake transition).
  - _Stretch, explicitly opt-in later:_ a per-relationship "bonded pair" attraction (e.g. parent/child, or two critters flagged as attached) as a small custom steering force scoped to that one relationship — not a global flock behavior. Not required for v1.
- **Arrival at favourite spot:** ~30% of the time a fish's current wander/target cycle resolves, redirect it to `fav.{x,y,z}` using an `ArriveBehavior` (slowing radius) rather than snapping — reproducing the same 30%-of-the-time rule `Jar.dc.html`'s mock uses, re-expressed as a proper steering behavior instead of a linear-interpolation target.
- **Trait modulation** (traits are already defined in `SPEC.md` §5 — this table says how each one bends the _steering_ parameters, since the 2D version only had ad-hoc movement tweaks):

  | Trait      | Steering effect                                                                                                                                                                                    |
  | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `bold`     | Larger wander circle radius; roams full tank height _and_ depth (2D-only version restricted this to height)                                                                                        |
  | `shy`      | Separation radius scales up with population count — mirrors the existing mood formula's `-3×population` penalty, so shy fish are visibly keeping their distance, not just quietly unhappy about it |
  | `curious`  | Separation radius scales down with population — tolerates (seeks out) crowding                                                                                                                     |
  | `sleepy`   | Higher probability of a zero-length pause between wander-circle updates                                                                                                                            |
  | `dramatic` | Wander jitter (the circle's angular displacement per step) at ~4× the base rate, matching the existing `4× noise` on its mood stat                                                                 |
  | `greedy`   | No steering effect (its penalty is mood-only per `SPEC.md` §5)                                                                                                                                     |

- **Energy coupling:** `vehicle.maxSpeed` scales with `energy` — low energy slows movement, exactly as `SPEC.md` §5 already specifies ("Low energy slows movement and drops mood"); it's the same existing rule, not a new one, just expressed as a steering parameter instead of an ad-hoc movement tweak.
- **Night:** steering is fully overridden, not just slowed. On the night transition, cancel active behaviors, set a one-shot `ArriveBehavior` targeting `fav.{x,y,z}`, and once arrived (within a small radius) zero the vehicle's velocity and mark the critter "settled" — no wander, no separation, until day. This matches `SPEC.md` §5's "drifts to their favourite spot and sleeps... indefinite in sim terms."

### 4.2 Gecko

- **Navigation:** a `NavMesh` covering two connected surfaces — the floor and the branch — built once from the terrarium's static geometry. Yuka's navmesh + pathfinding classes handle the floor↔branch transition as an ordinary path rather than a special-cased jump, which is the one piece of genuine pathfinding complexity in the whole spec (versus the fish, which just wander a volume).
- **Climb probability:** ~35% chance of pathing to the branch when a wander cycle resolves, matching `SPEC.md` §5 exactly ("climb to the branch ~35% of the time").
- **Pause behavior:** 1–4 s pause at each stop, same range `SPEC.md` §5 already specifies.
- **Orientation:** blend the gecko's up-vector to the surface normal at its current navmesh position (floor normal = world up; branch normal = the branch cylinder's local outward normal) so it visibly clings to whatever it's standing on rather than always standing world-upright. This is the same quaternion-lerp-toward-target pattern used for fish turn-banking (§6.6), generalized from "bank into a turn" to "orient to a surface."

---

## 5. Physics (Rapier via `@react-three/rapier`)

### 5.1 World setup

- Physics steps at a fixed lower rate than the render loop (Rapier's default fixed-timestep behavior is fine — don't tie physics to display refresh rate). Rapier is chosen over `@react-three/cannon`: it's the actively maintained option in the R3F ecosystem (current major version targets R3F v9/React 19), where cannon's wrapper has stalled.
- `gravityScale: 0` on every critter `RigidBody`. Steering (§4) owns vertical position entirely for locomotion — do not run real gravity against a counteracting buoyancy force; that produces a slow permanent drift bug (fish sinking or rising indefinitely) that's tedious to debug because it's two opposing systems fighting rather than one broken rule.
- Static/fixed bodies: tank walls (invisible box, inset slightly from the visible glass so no clipping is visible at the boundary), floor, rock, branch, foliage clusters — anything a critter shouldn't pass through. These give free containment/collision without hand-written bounds checks.

### 5.2 Per-critter body

- Dynamic `RigidBody`. Fish use a hand-placed `BallCollider` sized to the model's rough visual bounds, not `colliders="hull"` — auto-hull generation misreads `FishModel`'s nested tail-pivot `<group>` transform and produces a malformed, overlapping collider that Rapier's solver resolves with a violent corrective impulse on the very first physics step, ejecting the fish from the tank (see `Fish.tsx`'s `COLLIDER_RADIUS` comment). Gecko can use a box/capsule chain for its legs if a full articulated body is eventually wanted — a single hand-placed collider is sufficient for v1.
- `linearDamping` ~2–3, `angularDamping` ~5 as starting points — this is the "how heavy/sluggish does swimming feel" dial; tune by eye once a fish is actually on screen, don't over-fit these numbers in the abstract.
- Every render frame: apply the steering layer's desired velocity as an impulse (not a position snap), and set rotation from the heading computed off that same velocity vector. See the worked example already established for this project — `gravityScale={0}`, damped impulse, quaternion-from-heading — that pattern is the reference implementation; don't re-derive it differently per critter type.

### 5.3 Secondary motion (the "not rigid" feel)

- A small, **idle-only** oscillating vertical force (real buoyancy math: `submergedFraction × fluidDensity × displacedVolume × gravity`, opposed by damping) applied only while a fish's steering-driven speed is near zero — a gentle bob, not the primary motion source. Applying this constantly alongside gravity-zero steering is redundant with §4.1's night/idle handling; keep it as flavor on top, not a second locomotion system.
- **Stretch, optional:** a Rapier sensor volume around the bubble emitter that applies a small upward impulse to any fish `RigidBody` passing through it — this is the literal "a bubble stream physically lifts a fish" moment. Genuinely nice if it happens naturally as fish wander near the airstone; not worth engineering wander behavior specifically to trigger it.
- Bubbles/mist themselves are **not** physics bodies (§9) — they're cheaper as pure visual particles, and running a physics body per particle for ambient decoration is wasted simulation cost regardless of how "later" the optimization pass is.

---

## 6. Fish 3D model

### 6.1 Base archetypes

**As shipped, this diverges from the rigged/morph-target approach originally specified below** — no rigged GLTF asset pipeline exists, so the model is built entirely from hand-authored flat SVG silhouettes (`apps/jar/src/render/models/fish-svg/`), parsed with three.js's `SVGLoader` and extruded into thin 3D slabs (`fishGeometry.ts`). Body, dorsal, gill, mouth and pectoral are one silhouette each, extruded once and shared read-only across every fish instance; the `fin` gene (`SPEC.md` §5: `Fan | Forked | Veil`) selects which of three separately-authored tail silhouettes gets mounted at the tail pivot for a given fish — a geometry swap picked once at spawn, not a runtime blend, since the gene doesn't change after birth (`docs/architecture/rust-core.md` §6.1's "never re-rolled" genes). There is no body-shape gene (§6.7 is explicit that sex dimorphism is deliberately not a body-shape change either) — one shared body silhouette covers every fish.

### 6.2 Rig

**No skeleton.** In place of the bone chain originally specified here, five pieces that need to rotate — the tail, both pectoral fins (mirrored), and the mouth — are each pre-translated so their own local origin sits exactly at their hinge point (`fishGeometry.ts`'s `extrudeAtHinge`), then wrapped in a `THREE.Group` positioned at that same hinge (`wrapInPivot`); rotating the group rotates the geometry about the hinge with no further bookkeeping. Body, dorsal and both gills are rigid meshes with no pivot at all. The veil tail is the one piece that goes beyond a single rigid hinge: it gets an additional per-frame per-vertex bend (§6.6) layered on top of its own pivot rotation, approximating a second joint without actually adding one. Authored facing `+X` (`fish-svg/body.svg`'s own header comment) — this must line up with how the heading quaternion in §5.2 is computed, or every fish swims backwards.

### 6.3 Life-stage scaling

Same size curve `SPEC.md` already specifies (and `Jar.dc.html`'s mock renders at): fry ×0.45, juvenile ×0.75, adult ×1.0, elder ×1.0 (no separate elder scale currently defined — keep parity unless a visual case emerges for shrinking/graying elders). A single uniform scale on `FishModel`'s root `<group>` (`lifeStageScale(critter.life_stage)`, composed with the SVG-to-world unit conversion below) is what's actually applied; proportion changes (bigger eyes on fry, etc.) remain a nice stretch, not built. `life_stage` itself is a sim fact pushed from `jar-core` (`docs/architecture/rust-core.md` §3.1), not derived from `age_sec` client-side.

### 6.4 Materials — flat, not PBR

The 2D art direction is flat vector colour, not realism (`SPEC.md` §1: "nicer interface and flat vector art"). As shipped this is plain `MeshStandardMaterial` (`roughness: 0.6`, `side: THREE.DoubleSide` — needed because `fishGeometry.ts`'s SVG-to-three.js Y-flip reverses face winding, see that file's own comment) rather than `MeshToonMaterial`; the flat-art read comes from the low roughness and the deliberately simple geometry, not a toon shader:

- **Hue (gene):** `material.color.setHSL(hue/360, sat, 0.55)` on the body/fin materials at spawn (`FishModel.tsx`) — the model's base material is a neutral single-tone surface designed for exactly this, never a painted/textured skin.
- **Belly gradient:** the body mesh is vertex-painted per fish (`fishGeometry.ts`'s `paintBellyGradient`, run once whenever hue/sex-driven colour changes) rather than a static two-zone paint baked at authoring time — it wraps the whole rounded volume via `THREE.MathUtils.smoothstep()` on vertex Y, so the gradient reads correctly from underneath and from the back too, not just face-on.
- **Spots (gene):** 4 small dark sphere primitives, mirrored front/back, at fixed authored positions (`FishModel.tsx`'s `SPOTS` constant, sourced from the design notes), toggled by the `spots` boolean — a deliberately low-tech match for the original SVG's literal `<circle>` spots.
- **Eyes:** a white-less black sphere pair (pupil only, no separate sclera mesh) at fixed authored positions, mirrored front/back. **Not yet built:** an asleep/closed-eyelid state — every fish's eyes currently render "awake" regardless of `mood`/energy or the tank's day/night state.

### 6.5 Genetics → visual mapping (reference table)

| Gene (from `SPEC.md` §5) | 2D implementation                                                                                                                                     | 3D implementation                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `hue`                    | CSS `hsl(H, %, %)` per SVG element                                                                                                                    | `material.color.setHSL()` on the body/fin materials (§6.4)                            |
| `fin` (Fan/Forked/Veil)  | Different SVG `path` per value                                                                                                                        | Which pre-built tail geometry mounts at the tail pivot (§6.1) — a swap, not a blend   |
| `spots` (bool)           | 3–4 SVG `<circle>` overlays                                                                                                                           | 4 small sphere primitives, visibility-toggled                                         |
| `sex` (male/female)      | Not modeled in the 2D prototype; now tracked in the sim (`SPEC.md` §5) and shown in the critter card (`SCREENS.md` W2), but never had a _visual_ form | Subtle dimorphism per §6.7 — tail-scale and saturation multipliers, not a second mesh |
| `trait`                  | Movement-loop branching                                                                                                                               | Yuka steering parameter modulation (§4.1)                                             |
| life stage               | SVG size multiplier                                                                                                                                   | Root-group uniform scale (§6.3)                                                       |
| `mood`/`energy`          | (not visually shown beyond card UI)                                                                                                                   | Same — stats stay in the critter card, not the 3D model                               |

### 6.6 Animation — per-hinge oscillation (no skeleton), plus one per-vertex secondary

Since there's no bone chain (§6.2), the traveling-spine-wave technique originally specified here doesn't apply — instead, each hinge gets its own independent sine oscillation, all driven off the same `speed`/`turnRate` inputs and a per-fish `phaseSeed`, composed on `FishModel`'s single `useFrame` callback:

- **Tail** (`tailPivotRef.rotation.y`): `Math.sin(t * frequency + phaseSeed) * amplitude`, where `frequency = 4 + speed * 2` and `amplitude` widens with `turnRate` (capped) when actively swimming, or drops to a low `0.08` idle flutter at `speed < 0.05` — the idle-flutter rule from the original spec survives unchanged; a motionless fish still reads as dead, not asleep.
- **Veil tail only** (`veilGeometry`'s vertex positions, `fishGeometry.ts`): a genuine per-vertex bend on top of the pivot rotation above — each vertex's local `x` (distance from the tail tip) sets how much extra angle it picks up, phase-lagged by `1.1` rad per the original spec's stagger constant, so the tail reads as one continuous wave rather than a rigid paddle. Fan/Forked stay rigid single-pivot; only Veil's shape calls for the extra motion.
- **Pectoral fins** (`pectoralPivotRef`/`pectoralFarPivotRef.rotation.z`): a smaller, faster flutter (`phase * 1.3`), independent of the tail's own phase.
- **Mouth** (`mouthPivotRef.rotation.z`): its own slower period (`t * 0.9 + phaseSeed`), unrelated to the tail beat — opens toward the belly side (sign verified by tracing the jaw-tip vertex's trajectory) then closes, never fully idle.
- **Whole-body bank/bob** (`FishModel`'s root `<group>.rotation.z`/`.position.y`): a small (`0.05` rad / `0.02` unit) wobble at the tail's own frequency, substituting for the originally-specified root-bone roll-into-turns — deliberately local and layered inside `Fish.tsx`'s `RigidBody`, which alone owns the fish's actual world position/heading; this never fights it.
- `phaseSeed`: one random value per fish, fixed at spawn (`Math.random()` in `FishModel`'s first render) — without it, every fish beats in perfect unison whenever they share a speed, reading as robotic rather than alive. Cheap, easy to forget, disproportionately important — carried over from the original spec unchanged.
- Not built: baked `AnimationMixer` clips from a generator's auto-rig/auto-animate output — moot now that there's no rigged asset pipeline at all (§6.1).

### 6.7 Sex-based visual dimorphism

`sex` (male/female, `SPEC.md` §5) is tracked by the sim and shown on the critter card, but the 2D prototype never gave it a visual form at all — nothing in `svg()` reads it. As shipped (`FishModel.tsx`):

- **Fins:** males get `MALE_TAIL_SCALE = 1.2×` on the tail pivot's own scale (`fishGeometry.ts`, shared with `Fish.tsx`'s collider sizing — see §5.2); females stay at 1×. Only the tail scales, not the dorsal fin (the original spec's "tail and dorsal" was narrowed to tail-only during implementation).
- **Saturation:** males render at `sat = 0.75`, females at `0.62`, both at the same `hue` — a larger split than the original spec's "a few percentage points," landing on it by eye once real fish were on screen rather than deriving it on paper.
- Both are fixed constants applied once at spawn alongside the `fin`/`spots` visual setup (§6.5) — no runtime cost, no interaction with steering or animation.
- Explicitly **not** doing: a separate body shape, a separate rig, or any behavioral difference — `sex` affects breeding eligibility (`SPEC.md` §5) and this one visual pass, nothing else.

---

## 7. Gecko 3D model

- **Rig:** `root → spine1 → spine2`, 4 legs (`upperLeg → lowerLeg` each), `neck → head`, `tailBase → tailTip`. No fin/tail-type gene applies to geckos (`SPEC.md` §5's `fin` gene is fish-only) — one base mesh, no morph-target tail variants needed.
- **Genetics:** same hue-via-material-color and spot-via-toggleable-primitive approach as fish (§6.4/6.5). Gecko originals roll hue from the fixed palette already specified in `SPEC.md`/`Jar.dc.html` (`[28, 42, 75, 110, 150]`) rather than a free 0–360 roll — carry that constraint forward unchanged.
- **Gait:** procedural alternating-diagonal-pair leg rotation (same sine- wave technique as the fish spine, applied per-leg-pair with a phase offset) — no inverse kinematics needed for a stylized, low-poly creature at this scale; IK would be real added complexity for a difference few users would consciously notice.
- **Surface orientation:** per §4.2, blend up-vector to the current surface normal (floor vs. branch) so the gecko visibly clings rather than floating world-upright above whatever it's standing on.
- **Sleep:** same closed-eye swap mechanism as fish (§6.4).
- **Sex dimorphism:** same approach as §6.7 — a modest tail/scale multiplier and saturation nudge for males, nothing structural.

---

## 8. Environment models

The **frame bezel** (Bevelled 98 / Wood stand / Brushed metal / Rounded glass / Neon-CRT / Cardboard cutout, `SPEC.md` §4) is HTML/CSS window chrome around the 3D canvas — it does not change with this spec. The 3D scene is only what's _inside_ the tank viewport. As built, the tank window doesn't apply any frame treatment at all (§8.1, `SCREENS.md`'s W1 entry) — the frame axis is Setup-selectable and persisted but currently inert on W1 while the translucent glass tank is the window's whole visual boundary.

### 8.1 Aquarium

- **Water and glass, as built:** a single translucent tinted box (`AquariumEnvironment.tsx`) encloses the whole tank volume — not just a front pane — using plain alpha blending (`meshPhysicalMaterial` with `transparent`/`opacity`, not `transmission`). `transmission` achieves its see-through look by re-rendering the scene's own opaque contents into an offscreen texture and sampling that, which still writes fully-opaque alpha to the canvas; that would defeat the point here, since the actual desktop behind Jar's transparent window needs to show through the tank itself, tinted by the glass, not just around it. Real alpha blending is what punches a genuinely partial-transparency hole in the canvas's output. A soft additive plane near the tank's ceiling stands in for the surface highlight, toggled by the `light` drawer control.
- **Not yet built:** a depth-tinted fog volume (the original plan's colour-gradient backdrop, now superseded by the alpha-blended box above), a slow-scrolling caustic light-mottling texture on the floor/rock, and the screen-space underwater-wobble stretch goal.
- **Floor/decor:** sand floor (two-tone, matching the original's two layered ellipses), one rock, three plants. Plant sway: same sine-based technique as fish spine/gecko gait, driven by a bone or vertex-shader bend — same visual effect as the CSS `sway` keyframe it replaces, built with a genuinely different (3D-native) mechanism, not adapted from it.
- **Airstone position:** fixed point at roughly the same relative location as the original (~66% x, near the rock) — this is the bubble emitter origin (§9.1) and, if the sensor-volume stretch goal (§5.3) is built, the force-field origin too.
- **Light toggle:** a surface highlight / soft light-shaft effect (a simple additive gradient plane or sprite is enough) toggled by the `light` boolean from the drawer.

### 8.2 Terrarium

- **Floor/wall:** substrate floor, mossy back wall — same look as the original's two-gradient backdrop, built fresh as 3D geometry/materials.
- **Branch:** a physics-relevant static body (§4.2, §5.1) geckos path onto ~35% of the time — this one has to exist as real geometry with a real collider, not just decoration.
- **Foliage × 2, hide-rock × 1:** decoration, static colliders optional (only needed if they should block critter movement rather than just sit in the background).
- **Heat-lamp glow:** an additive light-cone or radial glow sprite, toggled by `lightOn` — same visual effect as the original's radial-gradient glow, rebuilt as a 3D light/sprite.

---

## 9. Particle systems

Neither bubbles nor mist are physics bodies (§5.3) — cheap, capped-count visual particles only.

### 9.1 Bubbles (aquarium, `bubbles` toggle)

- Rise velocity (base upward drift) plus **per-axis simplex/Perlin noise** perturbing the horizontal (and slightly the vertical) component every frame, so bubbles wander as they rise rather than traveling a straight line — this is the specific "float up in random directions" effect asked for. (Note for anyone porting from the earlier Babylon research: this is the same idea as Babylon's built-in `NoiseProceduralTexture` + `particleSystem.noiseStrength`, just implemented directly since three has no equivalent shipped in core — a hand-rolled noise-offset in the particle update loop, or a library like `three.quarks`, both work.)
- Fade in over the first ~15% of lifetime, fade out near the top; slight per-particle size/opacity jitter for visual variety.
- Emitter origin: the airstone position (§8.1).
- Cap: ~20–40 concurrent bubbles is plenty at this window size — no benefit to more, real cost to more.

### 9.2 Mist (terrarium, `mist` toggle — same drawer slot as bubbles per

`SCREENS.md`'s W1 drawer button list)

- Same noise-perturbed-drift technique, but: softer/larger additive sprites, slower rise, lower opacity, wider horizontal spread, emitted from the floor rather than a fixed point.
- Cap: ~15–20 concurrent wisps.

Both run continuously whenever their toggle is on — including at night; `SPEC.md` doesn't call for them to pause, and there's no behavioral reason they should (they're ambient environment, not creature behavior governed by the sleep state in §4.1).

---

## 10. Lighting & theme integration

### 10.1 Base lighting

Minimal — one ambient light, one directional "surface" light. The point is to preserve the flat/toon read from §6.4, not to light the scene realistically. Resist the urge to add fill/rim/bounce lights "because it's 3D now" — that pulls the look toward generic-PBR-game and away from Jar's existing visual identity.

### 10.2 Night dimming

Replace the 2D version's flat CSS tint overlay with an actual light transition: animate ambient/key light intensity down and fog density up over the day↔night boundary (`SPEC.md` §5: 21:00–07:00). This reads as the tank actually going dark rather than a translucent black rectangle being placed over it, and it's barely more code than the overlay was.

### 10.3 Frame-driven effects

Only the **Neon/CRT** frame needs a 3D-side change: a scanline + mild chromatic-aberration post-process pass via `@react-three/postprocessing`, applied only to the tank canvas, matching the original `crt` flag's `repeating-linear-gradient` scanline overlay. All other frames (Bevelled 98, Wood, Metal, Glass, Cardboard) require zero changes to the 3D scene — their entire look lives in the bezel chrome around it, per `SPEC.md` §4. This section describes the frame system as designed; per §8's note, none of it is currently applied to the tank window.

---

## 11. Performance budget & render-loop policy (recap + specifics)

Explicitly **not** trying to be clever about long-run resource cost here — per direction, that's a later optimization pass, not a day-one design constraint. That said, "don't optimize yet" isn't the same as "no budget at all" — a few defaults keep day one from being pathological by accident rather than by choice:

- Triangle budget: aim for roughly <3k triangles per fish, <5k for the gecko. At a handful of critters this is nowhere near a real constraint; it's just what "modest, stylized, low-poly" naturally produces, and worth stating so nobody generates a 500k-triangle sculpt-detail model from Rodin and wonders why the tank stutters.
- Physics step rate: fixed, independent of display refresh rate — don't tie Rapier's step to `requestAnimationFrame` directly.
- Particle caps: per §9 (20–40 bubbles, 15–20 mist wisps).
- Pause the render loop when the window isn't visible (§1.3) — this is the one guard worth treating as non-negotiable rather than deferred, since it costs nothing to add now and directly prevents "why is my idle desktop toy pinning a CPU core" from ever becoming a support question to future-you.

---

## 12. Asset pipeline

Fish (§6.1) no longer follow this pipeline — they shipped as hand-authored flat SVG silhouettes, extruded at runtime (`fishGeometry.ts`), with no rigged asset or generator step involved. This section now applies only to the gecko (§7), which is still unbuilt and still specified as a real bone rig, and to any future critter that needs one.

1. **Generate base meshes.** Text-to-3D or image-to-3D (using the existing flat-vector critter art from `Jar.dc.html`'s `svg()` function as a style reference image) via Meshy or Tripo3D. Tripo3D's built-in stylized presets and auto-rig/auto-animate are the better fit for this project's look and for skipping manual rigging; Meshy's topology/remesh controls are the better fit if hand-rigging in Blender afterward. Either is viable — pick one per model rather than mixing tools mid-pipeline for the same asset.
2. **Rig.** Use the generator's auto-rig where available; otherwise hand-rig in Blender against the bone specs in §6.2/§7.
3. **Export** as GLB (includes mesh, rig, morph targets, and any baked clips in one file).
4. **Convert** each GLB to a typed R3F component via the `gltfjsx` CLI — check the result in, don't regenerate it at build time.
5. **Naming convention:** the body mesh/material intended for hue-rotation must use a consistent, documented name (e.g. `Body_Hue`) so the genetics wiring in §6.5/§7 can find it by name across regenerated model versions without hand-patching shader code each time a model is re-exported.

Directory convention: raw GLBs in `/assets/models/`, generated JSX components in `/src/render/models/`.

---

## 13. Suggested module layout

```
/src-tauri/                  # unchanged — window config per SPEC.md §2
/src/sim/                    # framework-agnostic TS, written fresh against
                              # the rules SPEC.md §5 specifies (aging, mood,
                              # breeding, genetics roll, naming) — not
                              # adapted from Jar.dc.html's Component class;
                              # no rendering imports, ever
/src/render/
  tank/                      # R3F <Canvas> + scene root, camera (§2.3),
                              # transparency setup (§1.1)
  models/                    # FishModel + fishGeometry (SVG→extrude, §6.1),
                              # GeckoModel
  steering/                  # Yuka vehicle wrappers, per-trait param
                              # tables (§4.1), navmesh setup (§4.2)
  physics/                   # RigidBody wrapper hooks, static colliders,
                              # buoyancy/secondary-motion force (§5.3)
  environment/                # aquarium/terrarium backdrop scenes (§8)
  particles/                 # bubble + mist systems (§9)
  effects/                   # CRT/neon post-process pass (§10.3)
/src/ui/                     # same design as SPEC.md/SCREENS.md/docs/ui-mockups/Jar.dc.html specify —
                              # drawer, critter card, family tree, setup —
                              # built fresh in idiomatic React, not adapted
                              # from the prototype's <x-dc>/<sc-if>/<sc-for>
                              # template markup; flat HTML/CSS, themed per
                              # SPEC.md §4
/assets/models/               # raw GLBs (§12)
```

---

## 14. Explicit non-goals

Stated plainly so nobody accidentally scope-creeps toward them:

- No real fluid/SPH water simulation.
- No buoyancy force as the _primary_ locomotion driver (steering is; buoyancy is idle-only flavor, §5.3).
- No user-adjustable/orbit camera — fixed frontal view only (§2.3).
- No ray-traced or screen-space-heavy water rendering as a v1 requirement.
- No boid cohesion/alignment flocking by default (§4.1) — individual pets, not an anonymous school.
- WebGPU is a future progressive enhancement, not a v1 dependency (§1).
- Long-run idle resource cost is explicitly deferred as an optimization pass, per direction — the only load-bearing exception is pausing the render loop on window-hidden (§1.3, §11), which is cheap enough to do now rather than later.
