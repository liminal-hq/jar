# Jar — windows & screens

Companion to `SPEC.md` (see its §3, which points here). This is the full window/screen inventory. Product positioning, platforms, themes, simulation rules and persistence live in `SPEC.md`; 3D rendering specifics for the Tank window live in `docs/architecture/3d-engine.md`.

## W1 · Tank (main)

- No OS chrome. Currently no separate frame bezel either — the glass tank enclosure itself (see `docs/architecture/3d-engine.md` §8.1) is the window's whole visual boundary, edge to edge, translucent through to the desktop behind it. The six frame treatments (`SPEC.md` §4) are built and Setup-selectable but not applied to the tank window while this is revisited.
- Contents: backdrop (aquarium or terrarium), critters, bubbles/mist, night tint, status chip (bottom-left: `4 fish · 22:14 · asleep`), event toasts (top-centre, 4 s).
- Click the tank → the **drawer** slides out from behind it, growing the window to the right. It overlaps the bezel by ~18 px so it reads as attached. When there isn't 180px of room to the right (the window is against the monitor's work-area edge, or maximized), it instead floats as an in-window overlay over part of the tank rather than resizing off-screen — the window can't reposition itself leftward on Wayland, so there's no other side to flip to. Clicking the tank again, or leaving the drawer idle, closes it.
  - Drawer buttons (top → bottom): Light · Bubbles (aquarium) / Mist (terrarium) · Sound · Gecko/Fish (mode switch) · Tree · Setup · Exit (saves the jar, quits the app — essential on GNOME where there is no tray).
  - Drawer styling follows the **dialog theme**: Modern borrows the frame's colours (wood → dark wood, neon frame → magenta); Classic 98 → grey bevel panel with pushed-in buttons; Neon terminal → dark panel, magenta outline text.

The tank interior (backdrop, critters, particles, lighting) is a 3D scene per `docs/architecture/3d-engine.md`; only the bezel/drawer/toasts/status chip are flat HTML/CSS chrome around it.

## W4 · Setup

- Its own window (nothing covers the tank). Shows every option at once:
  - Mode: Aquarium — fish / Terrarium — gecko
  - Frame: Bevelled 98 · Wood stand · Brushed metal · Rounded glass · Neon/CRT · Cardboard cutout
  - Dialog theme: Modern · Modern dark · Classic 98 · Paper notebook · Handheld LCD · Neon terminal
  - Variant (row changes with the theme; see `SPEC.md` §4)
  - Tank toggles: Light, Bubbles/Mist, Critter sounds
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

## Mobile companion (Android)

- Header: mode name + status chip. Compact tank (same live sim, 0.7 scale, no labels). Residents list: portrait, name, stage · trait, mood (or `zzz` at night).
- Tap resident → critter card as a bottom sheet. Read-only except rename.
- Home-screen widget: jar snapshot + status line.
- Sync: desktop is the source of truth; mobile reads the persisted state (file sync / local network — TBD).
