// `JarState`: the full population (including the passed — SCREENS.md's W3
// family tree needs them), the sim clock, and current settings. See
// `docs/architecture/rust-core.md` §4.1.
//
// (c) Copyright 2026 Scott Morris
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
    next_id: u32,
}

impl JarState {
    pub fn new(settings: JarSettings) -> Self {
        Self {
            critters: Vec::new(),
            clock: JarClock::new(),
            settings,
            next_id: 0,
        }
    }

    pub fn next_critter_id(&mut self) -> CritterId {
        let id = CritterId(self.next_id);
        self.next_id += 1;
        id
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
