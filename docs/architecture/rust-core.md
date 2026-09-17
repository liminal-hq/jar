# Jar — Rust simulation core spec (companion to `SPEC.md` and `docs/architecture/3d-engine.md`)

This document specifies a native Rust core for Jar's discrete simulation
logic — the aging/mood/breeding/genetics/passing rules currently described
only in prose in `SPEC.md` §5 (and referenced, but not specified, as
`/src/sim` in `docs/architecture/3d-engine.md` §3). It replaces that
module's *implementation language and process boundary* — Rust, running
natively in the Tauri backend, instead of TypeScript running in the
webview. It does not change what the sim does, and it does not touch
rendering, steering, physics, or animation, all of which stay exactly as
`docs/architecture/3d-engine.md` specifies, in the webview, in
JS/R3F/Yuka/Rapier.

Read this alongside the other two: `SPEC.md` (and its companion
`SCREENS.md`) still owns product behavior and every rule number in §5;
`docs/architecture/3d-engine.md` still owns the render/physics/steering
pipeline in full. This doc owns the boundary between "the jar's facts" and
"what the jar looks like doing them."

## 0. Where this comes from, and the one scoping call it rests on

The architecture below is adapted from **City Sim 1000**
(`github.com/ScottMorris/city-sim-1000`), which already solved a version of
this problem: a pure Rust simulation core (`city-sim-core`), a shared
types/schema crate with TS codegen (`city-sim-protocol`), and two thin
adapters — a WASM cdylib for its browser/PWA target, and a real Tauri v2
plugin (`tauri-plugin-city-sim`) that runs the same core natively for
desktop. §9 credits specifically what's borrowed from it and what isn't.

**The one load-bearing difference:** City Sim ships to a plain browser
(PWA) *and* Tauri desktop, so it genuinely needs both adapters. Jar
(`SPEC.md` §2) targets Tauri desktop and Tauri mobile only — no browser
build. Tauri mobile is not a browser sandbox; it runs the same native Rust
process model as desktop, with a webview for UI. So Jar needs exactly
**one** adapter, not two: a native Tauri plugin. No WASM crate exists in
this spec. If a browser-only preview ever becomes a real requirement, one
can be added the same additive way City Sim's was — `jar-core` itself has
zero `wasm-bindgen`/`tauri` dependencies, so nothing about it would need to
change to support that later.

Two things decided earlier in this project's brainstorming, restated here
because they're load-bearing for what follows:

- **No zero-copy WASM buffer optimization.** That technique (bulk
  position/rotation reads via `Float32Array` views into WASM linear
  memory) is real and proven, but its payoff scales with entity count —
  it was measured at 1000+ bodies. `SPEC.md` §5 hard-caps Jar's population
  at 10 fish + 4 gecko, ever. At ≤14 concurrent rigid bodies there's no
  overhead worth eliminating, and it doesn't apply to this doc's scope
  anyway — that trick was about the physics/render feed, which this doc
  doesn't touch. Noted here only so it isn't silently forgotten.
- **Plain `rand`, not a deterministic seeded RNG.** City Sim hand-rolled a
  SplitMix64+xoshiro128** generator specifically to keep golden test
  vectors in sync across a TS→Rust migration and to support undo/redo.
  Jar has neither requirement. See §4.5 for the one real consequence of
  this choice.

---

## 1. Scope — what `jar-core` owns, and what it explicitly doesn't

| Owns (this doc) | Doesn't own (stays per `docs/architecture/3d-engine.md`) |
|---|---|
| Aging, life-stage transitions | Position/velocity/heading during motion (Yuka) |
| Mood/energy drift formulas (`SPEC.md` §5) | Collision/containment (Rapier — already Rust-as-WASM regardless of this doc) |
| Breeding eligibility, pairing, genetics inheritance (hue/fin/spots/sex) | Procedural spine/gait animation |
| Passing (death) | Fluid/current simulation — still an open, unresolved question from earlier brainstorming; it's frame-rate-coupled and belongs with the render layer if/when it's built, not with this 1 Hz core |
| Naming (auto-name list, collision suffixes) | Rendering, theming, window chrome — all untouched, per `docs/architecture/3d-engine.md` §0/§13 |
| The jar clock (jar-day, day/night, speed multiplier) | — |
| Population cap enforcement | — |
| Persistence (snapshot save/load) | — |
| Favourite-spot target roll (`fav.{x,y,z}`) — a stat rolled once at spawn, not a live position (see §4.6) | — |
| Shared type schema + TS codegen for all of the above | — |

The dividing line in one sentence: **if it changes every frame to look
alive, it's JS's job; if it changes at most once a second to be a fact
about the critter, it's Rust's.**

---

## 2. Crate layout

```
crates/
  jar-core/           # pure Rust — sim rules, no I/O, no tauri/wasm deps
  jar-protocol/        # shared types + wire format; ts-rs generates the
                        # TS interfaces the frontend imports
  tauri-plugin-jar/    # Tauri v2 plugin — native background loop,
                        # commands, event push (the only adapter needed;
                        # see §0)
```

Workspace dependencies, following City Sim's choices where they still
apply and departing where §0's decisions say to:

```toml
[workspace.dependencies]
serde      = { version = "1", features = ["derive"] }
postcard   = { version = "1", features = ["alloc"] }  # snapshot wire format
thiserror  = "1"
ts-rs      = "12"     # protocol codegen → app/src/.../protocol/generated/
rand       = "0.8"    # plain RNG per §0 — no custom PRNG, no golden vectors
tauri      = { version = "2" }   # tauri-plugin-jar only
```

`serde_json` and `criterion` (City Sim uses both — the former for
dev/debug tooling, the latter for benchmarking) are optional here rather
than required: Jar's sim is orders of magnitude lighter than a city-tile
economy, so there's no standing perf question to benchmark against yet.
Add `criterion` if and when a specific rule's cost is ever in doubt, not
preemptively.

---

## 3. `jar-protocol` — shared schema

The single source of truth for every type that crosses the Rust↔JS
boundary, `#[derive(Serialize, Deserialize, TS)]`'d so the TS interfaces
in `app/src/.../protocol/generated/` are generated, never hand-kept-in-sync
— directly following City Sim's `ts-rs` pattern.

### 3.1 `Critter`

```rust
pub struct Critter {
    pub id: CritterId,
    pub species: Species,           // Fish | Gecko
    pub name: String,
    pub hue: u16,                   // 0–360
    pub fin: Option<FinType>,       // Fan | Forked | Veil — fish only, None for Gecko
    pub spots: bool,
    pub sex: Sex,                   // Male | Female — rolled 50/50, not inherited (SPEC.md §5)
    pub personality: Personality,   // Shy | Greedy | Curious | Sleepy | Bold | Dramatic
    pub mood: f32,                  // 0–100
    pub energy: f32,                // 0–100
    pub age_sec: f32,
    pub life: f32,                  // rolled lifespan, 26–36 jar-days
    pub gen: u32,
    pub parents: Option<[CritterId; 2]>,
    pub alive: bool,
    pub born: f64,                  // sim-seconds
    pub died: Option<f64>,
    pub favourite_spot: FavouriteSpot,  // {x, y, z} percents — rolled once at spawn
}
```

**Naming note:** `trait` is a reserved word in Rust (trait definitions).
The personality gene is named `personality` here rather than `trait` —
small, easy to get bitten by if translating `SPEC.md`'s vocabulary
literally, worth flagging explicitly so the implementing agent doesn't
have to discover it via a compile error.

**Why no live `x`/`y`/`z`:** re-reading the original prototype's own
`frame()` loop closely — `c.x`/`c.y` (live position) and `c.tx`/`c.ty`
(current move-to target) were *client-side, per-frame* state even in the
2D version, never touched by the 1 Hz `simTick()`. Only `fav` (the
favourite spot) was genetics-rolled once at spawn and persisted as a
stat. This spec keeps that boundary intact rather than widening it:
`jar-core` owns `favourite_spot` because it's a fact about the critter;
it does not own a "current position" field at all, because that was never
really sim-tick-owned state to begin with, in either version.

### 3.2 `JarSettings`

Everything in `SPEC.md` §6's persistence list *except* window geometry
(see §6.3 below): mode, frame, dialog theme + variant per theme, light,
bubbles/mist, sound, simulation speed, always-on-top.

### 3.3 Events

```rust
pub enum SimEvent {
    Born { child: Critter, parent_a: CritterId, parent_b: CritterId },
    Passed { id: CritterId },
    TickUpdate { critters: Vec<CritterStats> },  // mood/energy/age deltas
}
```

`CritterStats` is a slim projection (id + the fields that actually change
tick-to-tick: mood, energy, age_sec, alive) — no reason to re-send genetics
or name on every routine push when nothing about them changed.

### 3.4 Commands (frontend → core)

Mirroring `tauri-plugin-city-sim`'s command surface shape:
`start`, `stop`, `set_speed`, `set_mode`, `add_critter`, `rename_critter`,
`set_toggle` (light/bubbles/sound), `set_theme`, `set_frame`,
`get_snapshot`, `load_snapshot`.

---

## 4. `jar-core` — module breakdown

Pure Rust, no I/O, no `tauri`/`wasm-bindgen` — testable in complete
isolation, same discipline as `city-sim-core`.

### 4.1 `state.rs`
`JarState`: the full population (`Vec<Critter>`, including the passed —
`SPEC.md` §3 W3's family tree needs them), the sim clock, current settings.

### 4.2 `genetics.rs`
The `make()`-equivalent: hue averaging ±18° / fresh roll for originals,
fin inheritance (fish only), spot inheritance (70% chance if either
parent has them), sex roll (50/50, independent of parentage — `SPEC.md`
§5's amended genetics rule), favourite-spot roll, naming. Exactly the
rules already specified; this module is where they're implemented once,
correctly, rather than re-derived.

### 4.3 `clock.rs`
Jar-day tracking, day/night determination, the 1–60× speed multiplier —
and, borrowed directly from City Sim's `sim.rs`, a **fixed-timestep
accumulator with a tick-count cap per `step()` call**. City Sim's own
comment explains the failure mode this prevents better than a paraphrase
would: *"Prevents the 'spiral of death' at very high speed multipliers —
the sim runs at most this many ticks per frame, gracefully slowing
apparent speed rather than starving the renderer."* Jar's slider goes to
60×; without this guard, a frame hiccup at max speed could try to fire
dozens of ticks in one burst. Same fix, same reason, different game.

### 4.4 `tick.rs`
The actual per-tick rule application, in the order `SPEC.md` §5 states
them: aging → mood/energy drift → breeding roll (opposite-sex pairs,
under cap, awake adults only) → passing. This module is the direct,
line-by-line Rust expression of `SPEC.md` §5's prose — not a
reinterpretation of it.

### 4.5 `rng.rs`
A thin wrapper over `rand`, per §0's decision. The one real consequence
worth stating plainly rather than discovering later: `rand`'s built-in
generators aren't designed to serialize their exact internal state, so a
jar reloaded from a snapshot reseeds fresh rather than resuming the
identical subsequent random sequence it would have produced had the app
never closed. Every rule still rolls correctly and unbiased — a reloaded
jar is not reproducible byte-for-bit against an uninterrupted one. Given
Jar has no undo/redo/replay feature depending on that reproducibility, this
is the right trade for the simplicity gained; it's called out here so it's
a documented, intentional property rather than a surprise if anyone ever
goes looking for it.

### 4.6 `snapshot.rs`
`postcard` encode/decode with a versioned header — City Sim's exact
pattern: a magic byte sequence, a version number, and a comment trail at
each version bump explaining *why* the layout changed. Copy that
discipline, not just the format: `SPEC.md`'s data model will change over
this project's life, and "why did v3 add this field" is worth being able
to answer in six months.

### 4.7 `events.rs`
Birth/passing events fire **immediately when they happen**, not queued
for the next periodic push — `SPEC.md` §3 W1's toast is a 4-second,
in-the-moment thing, and there's no reason to add up to a full tick of
avoidable latency to it. Routine stat updates (mood/energy/age ticking
over) batch into the regular tick push described in §5.

---

## 5. `tauri-plugin-jar` — the native adapter

Structure mirrors `tauri-plugin-city-sim` directly: `lib.rs` (plugin
init, `invoke_handler!` with the command list from §3.4), `commands.rs`,
`error.rs`.

### 5.1 Background loop
A native loop, independent of the webview, driving `jar-core`'s tick via
the fixed-timestep accumulator (§4.3). Because this runs in the Tauri
backend process rather than as a JS timer, it is **not subject to any
webview visibility throttling** — this is what actually guarantees the
"simulation keeps running while the window is hidden/minimized" behavior
established earlier in this project's brainstorming, more robustly than a
JS-side `setInterval` ever could, since it isn't sharing a thread or a
scheduler with anything the OS might deprioritize.

### 5.2 Push model
A Tauri `Channel<SimEvent>` (City Sim's exact mechanism — Tauri v2's
purpose-built primitive for repeated backend→frontend pushes, cheaper
than the general event bus for this). Two kinds of push, per §4.7:
routine `TickUpdate`s on the regular cadence, and `Born`/`Passed` pushed
the instant they occur.

### 5.3 Persistence — the autosave decision
Per this project's decision: state stays exact in memory tick-to-tick; a
background timer flushes a snapshot to the app-data directory roughly
every 30–60 seconds, **plus an unconditional flush on clean app
shutdown** (Tauri's window-close/exit hook) so the very latest state is
never lost to timing. This trades a small window of possible loss on an
*un*clean exit (crash, force-kill) for avoiding constant small disk writes
for the app's entire runtime — the right trade at this data size, and
consistent with `SPEC.md` §6's own carve-out that "elapsed real time while
closed is not simulated" already accepts *some* looseness around exactly
what "closed" captures.

### 5.4 Window geometry doesn't belong here
`SPEC.md` §6 lists "window positions/sizes, always-on-top" alongside the
simulation state to persist. That's real, but it isn't `jar-core`'s
job — Tauri has an official plugin for exactly this,
[`tauri-plugin-window-state`](https://v2.tauri.app/plugin/window-state/),
which handles remembering and restoring window geometry generically.
Using it keeps `jar-core` scoped to *simulation* facts only, not general
app-window bookkeeping, and avoids reinventing something Tauri already
ships.

### 5.5 Command handling
Each command in §3.4 is a thin wrapper: validate, mutate `jar-core`'s
`JarState`, return. No business logic lives in `tauri-plugin-jar` itself
— exactly the separation City Sim's own plugin maintains, and the reason
`jar-core` can be unit-tested with zero Tauri machinery at all.

---

## 6. Interface contract with the JS/render side

This section amends `docs/architecture/3d-engine.md` §3's data-ownership table — replacing
"`/src/sim` (TS, tick-driven, 1 Hz)" with "Rust core, native plugin,
pushed via Tauri Channel." Nothing else in that table changes: steering,
physical truth, and presentation stay exactly as specified there.

### 6.1 Merge, don't overwrite
On each `TickUpdate`, the frontend updates the **stats fields only**
(mood, energy, age-derived life stage, alive) on its local critter
records. It must never touch whatever Yuka/Rapier currently think that
critter's position or velocity is — those are 60fps-owned state that a
1 Hz push has no business overwriting. The failure mode to avoid: a naive
"replace the whole critter object with what Rust just sent" merge would
make every fish visibly stutter/snap once a second.

### 6.2 Spawn and despawn are events, not diffs
`Born`/`Passed` arrive as explicit, one-shot events specifically so the
frontend can react at the right instant — spawn a new Yuka vehicle +
`RigidBody` on `Born`, remove one and leave a memorial record on
`Passed` — rather than diffing population arrays each tick to infer what
changed. Diffing is exactly the kind of subtly-wrong approach that works
in testing (small populations, obvious changes) and breaks quietly later.

### 6.3 Who decides *where* a child appears
`SPEC.md` §5: "Child spawns at parent A's position." `jar-core` decides
**whether and who** breeds — it has no idea where parent A physically is
right now, because that's live physics state it never owns. The `Born`
event carries the genetics and parentage; the frontend, on receiving it,
reads parent A's *current* `RigidBody` position (which it already has)
and spawns the child there. This is a real cross-boundary responsibility
split worth stating explicitly rather than leaving implicit — it's an
easy detail to get backwards when implementing the event handler.

### 6.4 Favourite spot is a steering input, never a steering output
`favourite_spot` is rolled once by `jar-core` at spawn and never changes.
The frontend's Yuka layer reads it as a fixed `ArriveBehavior` target
(per `docs/architecture/3d-engine.md` §4.1) — it is not something the render/steering side
ever writes back to the Rust side.

---

## 7. Development-experience trade-off worth naming

One honest cost of this split, not mentioned elsewhere: the JS/R3F side of
Jar hot-reloads on save, same as any Vite/React app. The Rust side does
not — a change to `jar-core` or `tauri-plugin-jar` requires a recompile
and app restart before it's visible. For a hobby project worked in short,
irregular sessions, this changes the rhythm of iterating on sim-rule
tweaks (mood formula constants, breeding odds) versus iterating on visual
behavior (steering parameters, animation) — worth knowing going in rather
than discovering as friction later.

---

## 8. Non-goals (this doc's scope, explicitly)

- No WASM adapter crate — not needed for Tauri-only targets (§0); additive
  later if a browser build is ever genuinely wanted.
- No zero-copy WASM buffer optimization — doesn't apply to this doc's
  scope regardless, and isn't justified at Jar's population caps even
  where it would (§0).
- No deterministic/seeded-for-replay RNG (§0, §4.5).
- No change whatsoever to steering, physics, rendering, animation, or UI
  chrome — all of `docs/architecture/3d-engine.md` stands exactly as written.
- No resolution of the fluid/current simulation question — still open,
  still belongs to the render layer if/when it's built, not to this 1 Hz
  core.
- No resolution of mobile sync — `SPEC.md` §3's Android companion already
  marks this "TBD," and nothing here narrows that; the mobile companion
  is read-only today, and whether it ever runs its own `jar-core` instance
  (Tauri mobile can, in principle — it's native Rust on-device same as
  desktop) versus purely consuming a synced snapshot is a decision for
  whenever mobile sync actually gets designed, not a side effect of this
  doc.
- Window position/size/always-on-top persistence is explicitly *not*
  `jar-core`'s job (§5.4) — it's `tauri-plugin-window-state`'s.

---

## 9. Patterns borrowed from City Sim 1000 — and what wasn't

**Borrowed directly:**
- The core/protocol/plugin crate split, and the discipline of keeping
  `jar-core` free of any I/O or host dependency.
- `ts-rs` for generated TS types — one source of truth, no hand-sync.
- `postcard` + a versioned, commented snapshot format.
- The fixed-timestep accumulator with a per-step tick cap, guarding
  against speed-slider spiral-of-death.
- The Tauri `Channel<T>` push model for backend→frontend state streaming.
- The plugin command-surface shape (thin commands, all logic in core).

**Deliberately not borrowed, and why:**
- The WASM adapter crate — City Sim needs it for a real browser target;
  Jar has none (§0).
- The hand-rolled deterministic RNG with golden test vectors — built to
  support undo/redo and cross-language migration testing, neither of
  which Jar has (§0, §4.5).
- Per-tick disk writes — throttled to a periodic flush instead (§5.3).
- The `criterion` benchmarking harness — optional here, not required;
  add it if a specific rule's performance is ever actually in question,
  not preemptively (§2).
