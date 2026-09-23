// The `Critter` schema and its supporting enums. See
// `docs/architecture/rust-core.md` §3.1 for the full field-by-field rationale
// (most notably: why there is no live x/y/z here — see that section's "Why
// no live x/y/z" note).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Stable identifier for a critter, unique for the lifetime of a jar
/// (including passed critters, which stay in the family tree).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CritterId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum Species {
    Fish,
    Gecko,
}

/// Tail shape gene — fish only. `None` on a `Gecko` (SPEC.md §5's `fin` gene
/// does not apply to geckos; see `docs/architecture/3d-engine.md` §7).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum FinType {
    Fan,
    Forked,
    Veil,
}

/// Rolled 50/50 at birth, independent of parentage (SPEC.md §5's amended
/// genetics rule) — not inherited from either parent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum Sex {
    Male,
    Female,
}

/// Named `personality` rather than `trait` because `trait` is a reserved
/// word in Rust. This is SPEC.md §5's "trait" gene under a Rust-safe name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum Personality {
    Shy,
    Greedy,
    Curious,
    Sleepy,
    Bold,
    Dramatic,
}

/// A target point rolled once at spawn, read by the frontend's steering
/// layer as a fixed `ArriveBehavior` target
/// (`docs/architecture/rust-core.md` §6.4) — never written back to by JS.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FavouriteSpot {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

/// Discrete age bracket derived from `age_sec` (SPEC.md §5's thresholds,
/// `jar-core::tick::life_stage` owns the actual classification rule) — a
/// sim fact like `mood`/`energy`/`alive`, so it's computed once here and
/// carried on `Critter`/`CritterStats` rather than the frontend
/// re-implementing the same age-threshold logic from a raw `age_sec`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum LifeStage {
    Fry,
    Juvenile,
    Adult,
    Elder,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Critter {
    pub id: CritterId,
    pub species: Species,
    pub name: String,
    pub hue: u16, // 0-360
    pub fin: Option<FinType>,
    pub spots: bool,
    pub sex: Sex,
    pub personality: Personality,
    pub mood: f32,   // 0-100
    pub energy: f32, // 0-100
    pub age_sec: f32,
    pub life_stage: LifeStage,
    pub life: f32, // rolled lifespan, 26-36 jar-days, expressed in sim-seconds
    pub gen: u32,
    pub parents: Option<[CritterId; 2]>,
    pub alive: bool,
    pub born: f64, // sim-seconds
    pub died: Option<f64>,
    pub favourite_spot: FavouriteSpot,
}

/// Slim per-tick projection of a `Critter` — only the fields that actually
/// change tick-to-tick. Sent on the routine `TickUpdate` push
/// (`docs/architecture/rust-core.md` §3.3) instead of the full `Critter`,
/// since genetics/name/parentage never change after spawn.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CritterStats {
    pub id: CritterId,
    pub mood: f32,
    pub energy: f32,
    pub age_sec: f32,
    pub life_stage: LifeStage,
    pub alive: bool,
}
