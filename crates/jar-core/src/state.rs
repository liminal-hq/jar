// `JarState`: the full population (including the passed — SCREENS.md's W3
// family tree needs them), the sim clock, and current settings. See
// `docs/architecture/rust-core.md` §4.1.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use jar_protocol::{Critter, CritterId, Habitat, JarSettings, Species};

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

/// SPEC.md §5's hard population cap ("10 fish + 4 gecko + 5 snail, ever" —
/// not just via breeding), one source of truth for every caller that needs
/// to check it: `tick.rs`'s `try_breed` and `tauri-plugin-jar`'s
/// `add_critter` command each enforce it independently, since a critter can
/// enter the population through either path. Each species' cap is its own
/// separate pool — a snail never competes with a fish for a population
/// slot, even though both can live in the same (aquarium) habitat.
pub fn population_cap(species: jar_protocol::Species) -> usize {
    match species {
        jar_protocol::Species::Fish => 10,
        jar_protocol::Species::Gecko => 4,
        jar_protocol::Species::Snail => 5,
    }
}

/// Whether `species` is one `habitat` can hold — mirrors
/// `apps/jar/src/domain/habitat.ts`'s `speciesOfHabitat`, the frontend's own
/// curated add-critter menu/Setup buttons. `tauri-plugin-jar`'s `add_critter`
/// command checks this too, since it's the one path that isn't scoped by
/// that curated UI — without it, a caller that bypasses the menu (a stale
/// build, a test, a future automation surface) could create a species
/// `CrittersLayer.tsx` never renders for the current habitat, leaving it
/// alive, ageing, and breeding-eligible but permanently invisible.
pub fn species_belongs_to_habitat(species: jar_protocol::Species, habitat: Habitat) -> bool {
    match habitat {
        Habitat::Aquarium => matches!(species, Species::Fish | Species::Snail),
        Habitat::Terrarium => matches!(species, Species::Gecko),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pins the exact values SPEC.md §5 documents ("10 fish + 4 gecko + 5
    /// snail") — both `try_breed` and `add_critter` trust this function for
    /// the real cap, so a typo here would silently move the cap for both at
    /// once.
    #[test]
    fn population_cap_matches_documented_values() {
        assert_eq!(population_cap(jar_protocol::Species::Fish), 10);
        assert_eq!(population_cap(jar_protocol::Species::Gecko), 4);
        assert_eq!(population_cap(jar_protocol::Species::Snail), 5);
    }

    #[test]
    fn species_belongs_to_habitat_matches_the_frontends_curated_menu() {
        assert!(species_belongs_to_habitat(Species::Fish, Habitat::Aquarium));
        assert!(species_belongs_to_habitat(
            Species::Snail,
            Habitat::Aquarium
        ));
        assert!(!species_belongs_to_habitat(
            Species::Gecko,
            Habitat::Aquarium
        ));

        assert!(species_belongs_to_habitat(
            Species::Gecko,
            Habitat::Terrarium
        ));
        assert!(!species_belongs_to_habitat(
            Species::Fish,
            Habitat::Terrarium
        ));
        assert!(!species_belongs_to_habitat(
            Species::Snail,
            Habitat::Terrarium
        ));
    }
}
