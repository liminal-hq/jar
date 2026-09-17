// Converts a tick's `TickOutcome` into the wire-level `SimEvent`s
// `plugins/tauri-plugin-jar` pushes over its `Channel`. `Born`/`Passed` fire
// immediately per event; routine stat updates batch into one `TickUpdate`.
// See `docs/architecture/rust-core.md` §4.7.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use jar_protocol::{Critter, CritterStats, SimEvent};

use crate::state::JarState;
use crate::tick::TickOutcome;

/// Builds the ordered list of `SimEvent`s for one tick's outcome: each
/// `Born` first (in spawn order), then each `Passed`, then a single
/// `TickUpdate` carrying every living critter's current stats. Order is
/// deliberate so a consumer never sees a `TickUpdate` referencing a
/// critter it hasn't been told about via `Born` yet.
pub fn events_for_tick(state: &JarState, outcome: &TickOutcome) -> Vec<SimEvent> {
    let mut events = Vec::new();

    for born in &outcome.born {
        if let Some(child) = state.critters.iter().find(|c| c.id == born.child_id) {
            events.push(SimEvent::Born {
                child: child.clone(),
                parent_a: born.parent_a,
                parent_b: born.parent_b,
            });
        }
    }

    for id in &outcome.passed {
        events.push(SimEvent::Passed { id: *id });
    }

    events.push(SimEvent::TickUpdate {
        critters: state
            .critters
            .iter()
            .filter(|c| c.alive)
            .map(stats_of)
            .collect(),
    });

    events
}

fn stats_of(c: &Critter) -> CritterStats {
    CritterStats {
        id: c.id,
        mood: c.mood,
        energy: c.energy,
        age_sec: c.age_sec,
        alive: c.alive,
    }
}
