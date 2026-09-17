# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Jar is a tiny desktop/mobile digital-pet toy: a floating, transparent aquarium or terrarium window with a few auto-named critters who live, sleep, breed, age and pass on in real time. Built with Tauri v2, React (R3F/three.js for the 3D tank), and Rust. See `AGENTS.md` for the authoritative contributor conventions — most importantly: **Canadian English** spelling everywhere; **Conventional Commits** for commit messages but **never in PR titles**; the licence/copyright header on new source files; and **no pushes unless explicitly asked**. `SPEC.md` (+ `SCREENS.md`) describe product behaviour; `docs/architecture/3d-engine.md` and `docs/architecture/rust-core.md` describe the render/physics/AI stack and the Rust simulation core respectively.

`docs/ui-mockups/` holds the original Claude Design prototype (`Jar.dc.html`, `support.js`, `ios-frame.jsx`, screenshots) that this app's product design and behaviour were specified from. It is historical reference only — see `docs/architecture/3d-engine.md` §0 for why its code is not meant to be ported, adapted, or structurally mirrored. Only the _behaviour_ it demonstrates is authoritative, and only via `SPEC.md`/`SCREENS.md`.

## Layout

Bun workspace monorepo + Cargo workspace:

- `apps/jar` — the Tauri app: React frontend in `src/` (windows/, R3F scene in `render/`, generated protocol types in `domain/protocol/generated/`), Rust shell in `src-tauri/`
- `crates/jar-core` — pure Rust simulation core (aging, mood/energy, breeding, genetics, passing, naming, jar clock); no I/O, no `tauri`/`wasm-bindgen` deps
- `crates/jar-protocol` — shared types + wire format; `ts-rs` generates the TS interfaces `apps/jar/src` imports
- `plugins/tauri-plugin-jar` — the native adapter: background sim loop, Tauri `Channel` event push, autosave, thin command handlers
- `docs/architecture/` — the 3D engine spec and the Rust core spec
- `docs/ui-mockups/` — historical Claude Design prototype, reference only

## Commands

```bash
bun run validate      # the full CI gate: format:check, vitest, build (tsc), cargo fmt/clippy -D warnings, cargo nextest — must pass before opening/updating a PR
bun run test:js       # vitest only
bun run test:rust     # cargo nextest only
bun run dev           # web app in dev mode
bun run tauri dev     # desktop shell
```

If host Rust tooling is unavailable, run commands in a container with the Rust/Tauri toolchain preinstalled against the checked-out workspace.

## Architecture — the key things to understand

**The Rust core owns discrete sim facts; JS owns everything that changes every frame.** If a value changes at most once a second to be a fact about a critter (age, mood, energy, breeding, passing, genetics), it's `jar-core`, pushed to the frontend over a Tauri `Channel`. If it changes every frame to look alive (position, velocity, heading, animation pose), it's JS — Yuka for steering, Rapier for physics/containment, R3F for presentation. See `docs/architecture/rust-core.md` §1 for the exact split.

**The simulation tick keeps running when the window is hidden.** The Rust background loop is independent of the webview and is not subject to webview visibility throttling — a minimized jar ages and breeds exactly as much as a visible one, per `SPEC.md` §5's "real time" model. The render loop (R3F `frameloop`) is the only thing that pauses on window-hidden; see `docs/architecture/3d-engine.md` §1.3.

**Merge, don't overwrite.** On each `TickUpdate` from the Rust core, the frontend updates only the stats fields (mood, energy, life stage, alive) on its local critter records — it must never touch whatever Yuka/Rapier currently think that critter's position or velocity is. See `docs/architecture/rust-core.md` §6.1.

**`Born`/`Passed` are events, not diffs.** The frontend spawns/despawns Yuka vehicles and Rapier bodies reactively off these one-shot events rather than diffing population arrays each tick. See `docs/architecture/rust-core.md` §6.2.

**Genetics are traceable end to end.** `sex` is rolled 50/50 at birth, independent of parentage; hue/fin/spots inherit per `SPEC.md` §5's formulas. `docs/architecture/3d-engine.md` §6.7 specifies `sex`'s (subtle, non-structural) visual dimorphism — the one gene the original 2D prototype tracked but never gave a visual form.

## Conventions (from AGENTS.md)

- **PR titles**: human-readable, imperative, sentence case, ~70 chars, **no Conventional Commit prefix**. Descriptions use `## Summary` + `## Test plan` (checklists, concrete commands). Every PR gets a category label (`enhancement`, `bug`, `documentation`, …) plus scope labels (`rendering`, `sim`, `rust`, `frontend`, …). PRs open ready for review, not as drafts.
- **Commits**: Conventional Commits with markdown bodies (what/why, `test:` for test-only changes); write bodies to a file and `git commit -F` when they contain backticks.
- **Licence headers** on new/substantially rewritten `.rs`/`.ts`/`.tsx` files in `src/` (one-line summary + `(c) Copyright 2026 Scott Morris` + `SPDX-License-Identifier: Apache-2.0 OR MIT`).
- **Docs sync**: user-facing changes update `SPEC.md`/`SCREENS.md`; render/physics/AI changes update `docs/architecture/3d-engine.md`; sim-core changes update `docs/architecture/rust-core.md`.
- **No hard wrapping**: write each markdown paragraph or list item as a single line and let viewers soft-wrap; deliberate short lines, one-liners, and bullets stay as-is.
- **Git**: never push (especially force-push) unless explicitly asked; prefer the `gh` CLI for GitHub work.

Keep this file and `AGENTS.md` in sync: when a convention changes there, update the summary here in the same PR.
