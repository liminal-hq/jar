// Events pushed from `tauri-plugin-jar` to the frontend over a
// `Channel<SimEvent>` (`docs/architecture/rust-core.md` §5.2). `Born` and
// `Passed` are pushed the instant they occur; `TickUpdate` batches on the
// regular cadence (`docs/architecture/rust-core.md` §4.7).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{Critter, CritterId, CritterStats, JarSettings};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type")]
pub enum SimEvent {
    Born {
        child: Critter,
        parent_a: CritterId,
        parent_b: CritterId,
    },
    Passed {
        id: CritterId,
    },
    /// `is_night` is this tick's authoritative day/night state — the only
    /// jar-wide (not per-critter) fact carried by this variant. The
    /// frontend reads it rather than re-deriving its own copy, so its
    /// sleep/settle presentation can never disagree with what the sim core
    /// actually used for energy refill and breeding eligibility this tick.
    TickUpdate {
        critters: Vec<CritterStats>,
        is_night: bool,
    },
    /// Pushed whenever a setting changes via any `set_*` command, so every
    /// open window — not just the one that made the change — reflects it
    /// immediately instead of only after its next `get_snapshot` hydration.
    SettingsChanged {
        settings: JarSettings,
    },
    /// Pushed by `rename_critter`, distinct from `TickUpdate` since a name
    /// change isn't a stats field and doesn't happen on the tick cadence.
    Renamed {
        id: CritterId,
        name: String,
    },
    /// Pushed by `add_critter`. Kept distinct from `Born` — an added
    /// original has no parents, so it gets its own toast copy rather than
    /// reusing `Born`'s "A & B had a fry" phrasing.
    Added {
        critter: Critter,
    },
}
