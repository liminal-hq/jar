# Jar — windows & screens

Companion to `SPEC.md` (see its §3, which points here). This is the full window/screen inventory. Product positioning, platforms, themes, simulation rules and persistence live in `SPEC.md`; 3D rendering specifics for the Tank window live in `docs/architecture/3d-engine.md`.

## W1 · Tank (main)

- No OS chrome. Currently no separate frame bezel either — the glass tank enclosure itself (see `docs/architecture/3d-engine.md` §8.1) is the window's whole visual boundary, edge to edge, translucent through to the desktop behind it. The six frame treatments (`SPEC.md` §4) are built and Setup-selectable but not applied to the tank window while this is revisited.
- Contents: backdrop (aquarium or terrarium), critters, bubbles/mist, night tint, status chip (bottom-left: `4 fish · 22:14 · asleep`), event toasts (top-centre, 4 s).
- Right-click the tank → a context menu opens at the cursor, over the tank (no window resize, no second window). Clicking elsewhere, Escape, or losing focus closes it; a plain left-click on the tank background does nothing (dragging the window and clicking a critter still work as their own gestures).
  - **Tank**: Light · Bubbles (aquarium) / Mist (terrarium) · Critter sounds — checkboxes, reflecting the live setting.
  - **Mode**: Gecko/Fish (mode switch).
  - **Screenshot**: copies the tank canvas to the clipboard as a PNG.
  - **Critters**: Add a critter · Tree · Fish monitor · Fish eye — creating a critter, and the windows that show you the critters/sim itself.
  - **App**: Setup · Dev · Exit (saves the jar, quits the app — essential on GNOME where there is no tray) — configuration and tooling for the app, not the critters. Dev and Fish monitor are always available, not gated behind a dev build — see "Dev / Fish monitor" below.
  - Menu styling follows the **dialog theme**, via the same `--jar-*` tokens W2/W3/W4 use.

The tank interior (backdrop, critters, particles, lighting) is a 3D scene per `docs/architecture/3d-engine.md`; only the bezel/right-click menu/toasts/status chip are flat HTML/CSS chrome around it.

## W4 · Setup

- Its own window (nothing covers the tank). Shows every option at once:
  - Mode: Aquarium — fish / Terrarium — gecko
  - Frame: Bevelled 98 · Wood stand · Brushed metal · Rounded glass · Neon/CRT · Cardboard cutout
  - Dialog theme: Modern · Modern dark · Classic 98 · Paper notebook · Handheld LCD · Neon terminal
  - Variant (row changes with the theme; see `SPEC.md` §4)
  - Tank toggles: Light (plus a colour chip picker while it's on — Daylight, Warm, Moonlight, Reef, Jungle, Sunset, Party), a Castle light intensity slider (0-200%, always shown — the castle's own ground fixture stays on regardless of the Light toggle above), Bubbles/Mist (plus a Bubble intensity slider, 0-200%, while Bubbles is on in Fish mode), Critter sounds
  - Simulation speed: slider 1–60× with a **Real time** chip (snaps to 1×). Hint line explains the current jar-day length.
  - Jar clock line, `+ Add a critter`
  - (Build-only additions: always-on-top, show/hide, quit, reset jar)

## W2 · Critter card

- Spawns on clicking a critter (tank, tree, or phone list). One card at a time; clicking another critter retargets it.
- Rotatable 3D preview (drag to orbit, the same model/hue/genes the tank renders — a memorial critter's preview holds a still, badge-marked pose instead of an idle swim) · **name field (inline rename, dashed underline)** · species · life stage · age in days.
- Live bars: Mood (green > 60, amber > 35, red) and Energy. Italic one-liner of what they're doing.
- Grid: Trait + one-line description · Genetics (hue swatch, hue°, sex, tail type / body pattern, spotted/plain) · Favourite spot (left/middle/right + depth) · Lineage (generation, "child of A & B" or "original resident").
- Memorial state after passing: bars replaced by a quiet note; card stays openable from the tree.
- Button: Open family tree.

## W3 · Family tree

- One row per generation (Gen 1, Gen 2 …). Nodes: portrait, name, stage. Passed critters: muted, `† remembered`.
- Click node → focuses W2.
- Title shows `N ever` (all critters that have lived in this mode).

## Dev / Fish monitor

Two supplementary tooling windows, reachable from the W1 tank's right-click menu — not part of the original product spec, but always available (not gated behind a dev build) since both are self-contained and genuinely useful for a curious owner, not just for tuning.

- **Dev** — checkboxes for two `localStorage`-backed debug overlays (mouse event capture, live fish position capture), each showing its own live panel inline while enabled. Purely local state, no effect on the jar itself.
- **Fish monitor** — a live table plus top-down/front maps of every fish's steering/animation state (mode, resting, speed, turn rate). A Day/night radio group overrides the tank's real day/night clock while the window is open, resetting to Auto as soon as it closes so it never leaves the jar's own clock stuck.

## Mobile companion (Android)

- Header: mode name + status chip. Compact tank (same live sim, 0.7 scale, no labels). Residents list: portrait, name, stage · trait, mood (or `zzz` at night).
- Tap resident → critter card as a bottom sheet. Read-only except rename.
- Home-screen widget: jar snapshot + status line.
- Sync: desktop is the source of truth; mobile reads the persisted state (file sync / local network — TBD).
