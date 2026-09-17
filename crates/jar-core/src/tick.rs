// The per-tick rule application, in the order SPEC.md §5 states them: aging
// -> mood/energy drift -> breeding roll -> passing. This module is the
// direct, line-by-line expression of that section's prose, not a
// reinterpretation of it. See `docs/architecture/rust-core.md` §4.4.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use jar_protocol::{CritterId, Personality, Sex, Species};

use crate::genetics::{self, Parent};
use crate::rng::JarRng;
use crate::state::JarState;

/// Life-stage thresholds, in jar-days (SPEC.md §5).
const JUVENILE_AT_DAYS: f32 = 2.0;
const ADULT_AT_DAYS: f32 = 5.0;
const ELDER_AT_DAYS: f32 = 22.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifeStage {
    Fry,
    Juvenile,
    Adult,
    Elder,
}

pub fn life_stage(age_sec: f32) -> LifeStage {
    let age_days = age_sec / crate::clock::SECONDS_PER_JAR_DAY as f32;
    if age_days < JUVENILE_AT_DAYS {
        LifeStage::Fry
    } else if age_days < ADULT_AT_DAYS {
        LifeStage::Juvenile
    } else if age_days < ELDER_AT_DAYS {
        LifeStage::Adult
    } else {
        LifeStage::Elder
    }
}

/// Runs exactly one 1 Hz sim tick against `state`, returning the events it
/// produced (for `events.rs` to push immediately, per SPEC.md/rust-core.md
/// §4.7 — `Born`/`Passed` are not queued for the next batch).
pub fn tick(state: &mut JarState, rng: &mut JarRng) -> TickOutcome {
    state.clock.advance_one_tick();
    let is_night = state.clock.is_night();
    let population = state.critters.iter().filter(|c| c.alive).count() as f32;

    let mut outcome = TickOutcome::default();

    // 1. Aging + passing.
    for critter in state.critters.iter_mut().filter(|c| c.alive) {
        critter.age_sec += 1.0;
        if critter.age_sec >= critter.life {
            critter.alive = false;
            critter.died = Some(state.clock.sim_seconds);
            outcome.passed.push(critter.id);
        }
    }

    // 2. Mood/energy drift (SPEC.md §5's formula), skipped for sleeping
    // critters — "Sleep is indefinite in sim terms: nothing ages faster,
    // nothing breeds" applies to breeding and here to energy refill, not to
    // the aging pass above, which SPEC.md §5 doesn't exempt sleepers from.
    for critter in state.critters.iter_mut().filter(|c| c.alive) {
        if is_night {
            critter.energy = (critter.energy + 2.0).min(100.0);
            continue;
        }

        let mut target = 66.0_f32;
        if state.settings.light_on {
            target += 4.0;
        } else {
            target -= 6.0;
        }
        match critter.personality {
            Personality::Shy => target -= 3.0 * population,
            Personality::Curious => target += 2.0 * population,
            Personality::Greedy => target -= 5.0,
            _ => {}
        }
        if critter.energy < 35.0 {
            target -= 15.0;
        }

        let noise_scale = if critter.personality == Personality::Dramatic {
            4.0
        } else {
            1.0
        };
        let noise = rng.range_f32(-1.0, 1.0) * noise_scale;
        critter.mood = (critter.mood + (target - critter.mood) * 0.05 + noise).clamp(0.0, 100.0);

        critter.energy = (critter.energy - 0.05).max(0.0);
    }

    // 3. Breeding — only awake adults, under the population cap, one male +
    // one female (SPEC.md §5).
    if !is_night {
        try_breed(state, rng, &mut outcome);
    }

    outcome
}

#[derive(Default)]
pub struct TickOutcome {
    pub passed: Vec<CritterId>,
    pub born: Vec<BornEvent>,
}

pub struct BornEvent {
    pub child_id: CritterId,
    pub parent_a: CritterId,
    pub parent_b: CritterId,
}

fn try_breed(state: &mut JarState, rng: &mut JarRng, outcome: &mut TickOutcome) {
    for species in [Species::Fish, Species::Gecko] {
        let cap = match species {
            Species::Fish => 10,
            Species::Gecko => 4,
        };
        if state.living_count(species) >= cap {
            continue;
        }

        let eligible: Vec<CritterId> = state
            .critters
            .iter()
            .filter(|c| {
                c.alive && c.species == species && life_stage(c.age_sec) == LifeStage::Adult
            })
            .map(|c| c.id)
            .collect();

        let males: Vec<CritterId> = eligible
            .iter()
            .copied()
            .filter(|id| sex_of(state, *id) == Some(Sex::Male))
            .collect();
        let females: Vec<CritterId> = eligible
            .iter()
            .copied()
            .filter(|id| sex_of(state, *id) == Some(Sex::Female))
            .collect();

        if males.is_empty() || females.is_empty() {
            continue;
        }

        // Chance per tick proportional to the number of eligible
        // opposite-sex pairs (SPEC.md §5) — deliberately not "one roll per
        // possible pair" to keep this O(1) rather than O(pairs) per tick.
        let pair_count = (males.len() * females.len()) as f32;
        let breed_chance = (0.002 * pair_count).min(0.2);
        if !rng.chance(breed_chance) {
            continue;
        }

        let parent_a = males[rng.range_u16(0, males.len() as u16) as usize];
        let parent_b = females[rng.range_u16(0, females.len() as u16) as usize];
        spawn_child(state, rng, parent_a, parent_b, outcome);
    }
}

fn sex_of(state: &JarState, id: CritterId) -> Option<Sex> {
    state.critters.iter().find(|c| c.id == id).map(|c| c.sex)
}

fn spawn_child(
    state: &mut JarState,
    rng: &mut JarRng,
    parent_a_id: CritterId,
    parent_b_id: CritterId,
    outcome: &mut TickOutcome,
) {
    let child_id = state.next_critter_id();
    let existing_names: Vec<String> = state.critters.iter().map(|c| c.name.clone()).collect();
    let born_at = state.clock.sim_seconds;

    let (parent_a, parent_b, gen) = {
        let a = state
            .critters
            .iter()
            .find(|c| c.id == parent_a_id)
            .expect("parent exists");
        let b = state
            .critters
            .iter()
            .find(|c| c.id == parent_b_id)
            .expect("parent exists");
        let gen = a.gen.max(b.gen) + 1;
        (a.clone(), b.clone(), gen)
    };

    let child = genetics::roll_child(
        child_id,
        Parent { critter: &parent_a },
        Parent { critter: &parent_b },
        gen,
        born_at,
        rng,
        &existing_names,
    );
    state.critters.push(child);
    outcome.born.push(BornEvent {
        child_id,
        parent_a: parent_a_id,
        parent_b: parent_b_id,
    });
}
