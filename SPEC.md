# Jar — product spec

A tiny simulation in a box. A floating desktop aquarium/terrarium with a few auto-named critters who live, sleep, breed, age and pass on real time. Windows 98 novelty-desktop-pet energy, with a nicer interface and flat vector art. "The Sims meets SimCity meets your desktop fish screensaver."

Design reference: `docs/ui-mockups/Jar.dc.html` (1a desktop, 1b phone, 1c screen map) — a Claude Design authoring-tool artifact kept for historical reference only. It specifies behaviour, not implementation; see `docs/architecture/3d-engine.md` §0 for why its code is not meant to be ported or adapted.

Screen-by-screen window/UI inventory lives in `SCREENS.md`. Rendering, physics, AI and 3D model specifics live in `docs/architecture/3d-engine.md`. The Rust simulation core lives in `docs/architecture/rust-core.md`.

## 1. Positioning

- Category: toy. No goal, no win state. Fun to leave running and glance at.
- Core interaction: watching things evolve on their own; a few gentle knobs.
- Tone: playful, calm, cozy, a little weird, retro-flavoured, nerdy underneath (real stats, genetics, lineage).

## 2. Platforms

- Desktop: Tauri. Linux (GNOME, Cinnamon), Windows.
- Mobile: Android (Tauri mobile) companion — read-only check-in + home-screen widget.
- Window is resizable to any size; the tank layout is percentage-based.

### Platform notes

- Tank window: `transparent: true`, `decorations: false`, `alwaysOnTop` (toggleable), `skipTaskbar` optional.
- Dragging: the whole bezel is a drag region (`data-tauri-drag-region`); the tank interior is not (clicks select critters).
- Tray icon for show/hide. GNOME has no tray by default → show/hide + quit also live in the Setup overlay.
- Critter card, family tree and setup are separate `WebviewWindow`s positioned beside the tank, so they can be moved independently.

## 3. Windows & screens

See `SCREENS.md` for the full window/screen inventory (Tank, Setup, Critter card, Family tree, Mobile companion), plus two supplementary tooling windows reachable from the tank drawer (Dev, Fish monitor) that aren't part of the core product screens above but are always available, not gated behind a dev build.

## 4. Themes

Copy rule: sentence case everywhere — no all-caps headings or labels.

Two independent axes, both chosen in Setup and persisted:

**Tank frame**: Bevelled 98 · Wood stand · Brushed metal · Rounded glass (0 px bezel, truly edge-to-edge) · Neon/CRT (adds scanlines) · Cardboard cutout. Setup-selectable and persisted, but not currently applied to W1 — the translucent glass tank enclosure (§3, `docs/architecture/3d-engine.md` §8.1) is the window's whole visual boundary while this axis is revisited; see `SCREENS.md`'s W1 entry.

**Dialog theme** (W2, W3, W4 and the tank's right-click menu):

- Modern (default): warm off-white `#fbfaf6`, 18 px radius, soft shadow, Nunito, pill buttons.
- Modern dark: same shapes on `#1c1a22` with `#f1eee6` ink. On first run the app follows the OS light/dark preference (`prefers-color-scheme`) to pick Modern vs Modern dark; an explicit pick in Setup overrides it.
- Classic 98: `#c9c6bd` bevel, blue gradient title bar, square buttons.
- Paper notebook: ruled cream `#fff9ec`, ink `#3b2f2a`, dashed close button, italic titles, red-pen accent `#c2452d`.
- Handheld LCD: four-shade green (`#9bbc0f` / `#8bac0f` / `#306230` / `#0f380f`), dark title strip.
- Neon terminal: `#141018`, magenta `#ff3fd8` border/glow, dark panels.

**Variants** (named; one remembered per theme):

- Modern / Modern dark — Accent: Lagoon (blue) · Bubblegum (magenta) · Moss (green) · Clementine (orange). Drives primary buttons, selected chips, energy bar.
- Classic 98 — Window type: Classic blue · Teal desktop · Brick · Rainy day · High contrast (black/white/yellow).
- Paper notebook — Paper stock: Ruled cream · Graph paper · Legal pad · Kraft.
- Handheld LCD — Shell: Pea soup · Pocket grey · Berry · Glacier (four-shade palettes).
- Neon terminal — Phosphor: Magenta · Amber · Phosphor green · Cyan.

Type: Nunito only — no monospace anywhere; small labels are bold Nunito. Ink `#2b2a33`, accent magenta `#ff3fd8`, classic blue `#2d3e8f`.

## 5. Simulation

Real time, slow. 1 tick = 1 real second. Simulation speed (Setup slider, 1–60×; Real time = 1×) multiplies sim seconds per tick. Persisted.

The discrete rules below (aging, mood/energy, breeding, genetics, passing, naming) are owned and implemented by the Rust simulation core — see `docs/architecture/rust-core.md`. This section is the authoritative statement of _what_ the rules are; that document specifies _where_ they run and the wire contract with the frontend. Movement, steering and rendering of critters living out these rules is specified in `docs/architecture/3d-engine.md`.

- **Jar-day** = 120 sim seconds (2 real minutes at 1×).
- **Time of day**: at Real time (1×) it follows the system clock. At any faster speed the jar's own clock takes over — 24 jar-hours per jar-day, seeded from the system time when the app started — so sped-up critters cycle through nights on jar time. Night = 21:00–07:00 on whichever clock is active. The Setup clock line says which. At night the tank dims; LIGHT on at night only lifts the dim partly. Each species sleeps at its own opposite time — fish and gecko sleep by night, the (nocturnal) snail sleeps by day — drifting to its favourite spot and sleeping (`z`s, closed eyes; a snail seals into its shell) while asleep. Sleep is indefinite in sim terms: nothing ages faster, nothing breeds.
- **Life stages** by age: fry/hatchling < 2 d · juvenile < 5 d · adult < 22 d (44 d for snails) · elder. Lifespan 26–36 d for fish/gecko, 52–72 d for snails, rolled per critter.
- **Passing**: gentle. Toast "X has passed on, gently." Critter leaves the tank and stays in the tree as a memorial; card shows a memorial note.
- **Breeding**: only awake adults, only under each species' own population cap (fish 10, gecko 4, snail 5 — separate pools), and only between one male and one female of the same species (see Genetics — sex isn't inherited, so a given generation's male/female split is whatever it randomly rolls). Chance per tick ∝ number of eligible opposite-sex adult pairs. Child spawns at parent A's position. Toast "A & B had a fry: Name" (fish) or "...a hatchling: Name" (gecko/snail).
- **Genetics**: hue = parents' mean ± 18° (originals roll fresh across the full wheel); tail type (fan / forked / veil) from one parent (fish only); shell type (coil / ramshorn / turret) from one parent (snail only — fish/gecko have no shell); pattern (solid / banded / spotted) from one parent for every species — originals roll it species-weighted: fish ~40% spotted / 35% solid / 25% banded (continuity with the look fish always had), gecko 60% solid / 40% spotted (no banded-gecko art yet), snail an even split across all three; personality inherits from one parent 70% of the time (fresh roll from the full pool otherwise). Sex (male/female) is rolled 50/50 independently at birth — not inherited from either parent. Originals roll fresh.
- **Stats** (per critter):
  - Mood 0–100. Drifts toward a target: base 66, +4 light on / −6 off, shy −3×population, curious +2×population, greedy −5, low energy −15. Dramatic critters get 4× noise.
  - Energy 0–100. Drains slowly by day, refills asleep. Low energy slows movement and drops mood.
  - Age & stage, trait (shy · greedy · curious · sleepy · bold · dramatic), genetics, favourite spot (random point; ~30% of destinations return to it).
- **Movement**: fish pick random targets (bold ones roam the full height), sleepy fish pause between trips; geckos crawl the floor, climb to the branch ~35% of the time, and pause 1–4 s at each stop; snails crawl the floor, glass and castle at a slow, deliberate pace, pausing between stretches, sealing into their shell when startled (briefly, no operculum) or when sleep catches them, and — knocked loose by a fish or caught asleep off the floor — ease gently down to the floor before crawling on. (Movement/steering implementation: `docs/architecture/3d-engine.md` §4.)
- **Sound** (opt-in): occasional fish "blub" (sine sweep down) or gecko chirp (triangle sweep up), never at night. Snails are silent — no sound is played for them.
- **Naming**: auto from a silly per-species list (fish/gecko: Pickle, Sir Bubbles, Mortimer, Dr. Fins…; snail: Gary, Turbo, Escargot…); repeats get II, III…; user can rename inline.

## 6. Persistence

Saved every tick to app data: full population (both species, including the passed), sim clock, simulation speed, habitat, frame, dialog theme + variant per theme, light + light colour + castle light intensity, bubbles + bubble intensity, sound, window positions/sizes, always-on-top. On relaunch the jar resumes; elapsed real time while closed is **not** simulated (the jar was asleep).

Window position/size/always-on-top persistence is handled by the official `tauri-plugin-window-state` plugin, not the simulation core — see `docs/architecture/rust-core.md` §5.4. Everything else in this list is a simulation-core snapshot, autosaved periodically per that document's §5.3.

Setup offers two ways back to a clean slate: **Restore default settings** resets every item in this list except the population and sim clock, applied immediately with no confirmation; **Reset jar** additionally wipes the full population (living and passed) and the sim clock, seeded fresh as if the jar were just created — permanent, so it requires a second confirming click. Both flush to disk immediately rather than waiting for the next periodic autosave.

## 7. Out of scope (for now)

Feeding, tank dirt/maintenance, multiple tanks, social/sharing, iOS.
