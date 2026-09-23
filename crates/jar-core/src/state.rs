// `JarState`: the full population (including the passed — SCREENS.md's W3
// family tree needs them), the sim clock, and current settings. See
// `docs/architecture/rust-core.md` §4.1.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use jar_protocol::{Critter, CritterId, JarSettings};

use crate::clock::JarClock;

pub struct JarState {
    /// Every critter that has ever lived in this mode, alive or passed.
    /// SCREENS.md's W3 family tree title ("N ever") is a count over this
    /// list, not just the living population.
    pub critters: Vec<Critter>,
    pub clock: JarClock,
    pub settings: JarSettings,
}

impl JarState {
    pub fn new(settings: JarSettings) -> Self {
        Self {
            critters: Vec::new(),
            clock: JarClock::new(),
            settings,
        }
    }

    /// Derived from the current population on every call rather than a
    /// separately tracked counter — critters are never removed from
    /// `critters` (a passed one stays for the family tree, per this
    /// struct's own doc comment above), so the highest id already present
    /// is always a safe floor to build on. A stored counter here previously
    /// reset to 0 in every fresh `JarState::new()`, including the one
    /// `decode()` constructs *before* populating `critters` from a loaded
    /// snapshot (`snapshot.rs::decode`) — meaning every app restart quietly
    /// restarted id assignment from 0 too, colliding the next-born
    /// critter's id with whichever critter already held it from a previous
    /// session (breaking `CritterId`'s own documented "stable, unique for
    /// the lifetime of a jar" guarantee).
    pub fn next_critter_id(&self) -> CritterId {
        let next = self
            .critters
            .iter()
            .map(|c| c.id.0)
            .max()
            .map_or(0, |max| max + 1);
        CritterId(next)
    }

    /// Living population for a given species, used for population-cap
    /// enforcement (fish 10, gecko 4 — SPEC.md §5).
    pub fn living_count(&self, species: jar_protocol::Species) -> usize {
        self.critters
            .iter()
            .filter(|c| c.alive && c.species == species)
            .count()
    }
}
