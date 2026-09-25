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
    Snail,
}

impl Species {
    /// Every species that currently exists — the one place that has to
    /// change when a new species is added, so anything that needs to act on
    /// "every species" (`jar-core::tick::try_breed`'s per-species breeding
    /// pass, most notably) can iterate this instead of a hand-written array
    /// that a new variant wouldn't force an update to. See `all_species_are_
    /// covered_by_all` below: the exhaustive `match` there is what actually
    /// enforces this list stays complete — a new variant makes that `match`
    /// fail to compile until `ALL` is updated.
    pub const ALL: [Species; 3] = [Species::Fish, Species::Gecko, Species::Snail];
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Exhaustive on purpose: adding a fourth `Species` variant makes this
    /// `match` fail to compile until it (and `Species::ALL` above) are
    /// updated, which is what makes `ALL` trustworthy for anything that
    /// needs to act on every species that exists.
    #[test]
    fn all_species_are_covered_by_all() {
        for species in Species::ALL {
            match species {
                Species::Fish | Species::Gecko | Species::Snail => {}
            }
        }
    }
}

/// Shell shape gene — snail only, `None` on fish/gecko (mirrors `fin`'s
/// fish-only convention). The snail equivalent of `fin`'s three tail
/// shapes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ShellType {
    Coil,
    Ramshorn,
    Turret,
}

/// Body/shell pattern gene. Species-neutral by design (not `ShellPattern`)
/// so it can widen to fish and gecko later without a rename migration
/// (issue #98's follow-up "clean up the spots gene" work) — for now, only
/// snails ever roll a `Some` here; fish/gecko keep their existing `spots:
/// bool` until that follow-up lands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum Pattern {
    Solid,
    Banded,
    Spotted,
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
    /// Shell shape — snail only, `None` on fish/gecko (mirrors `fin`).
    pub shell: Option<ShellType>,
    /// Body/shell pattern — snail only for now (`None` on fish/gecko, which
    /// keep using `spots` above until issue #98's follow-up widens this to
    /// every species).
    pub pattern: Option<Pattern>,
    pub sex: Sex,
    pub personality: Personality,
    pub mood: f32,   // 0-100
    pub energy: f32, // 0-100
    pub age_sec: f32,
    pub life_stage: LifeStage,
    pub life: f32, // rolled lifespan (species-dependent range, jar_core::genetics::roll_lifespan), expressed in sim-seconds
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
