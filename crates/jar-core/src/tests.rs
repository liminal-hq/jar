// Smoke tests establishing that `jar-core` is testable in complete
// isolation, with zero Tauri machinery — per
// `docs/architecture/rust-core.md` §5.5's stated reason for the crate
// split. Expand alongside each module as its rules firm up.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use jar_protocol::{JarSettings, Species};

use crate::rng::JarRng;
use crate::state::JarState;
use crate::tick::{life_stage, tick, LifeStage};

#[test]
fn a_fresh_original_starts_as_a_fry() {
    let mut state = JarState::new(JarSettings::default());
    let mut rng = JarRng::new();
    let id = state.next_critter_id();
    let critter = crate::genetics::roll_original(id, Species::Fish, 1, 0.0, &mut rng, &[]);
    assert_eq!(life_stage(critter.age_sec), LifeStage::Fry);
    state.critters.push(critter);
    assert_eq!(state.living_count(Species::Fish), 1);
}

#[test]
fn ticking_ages_every_living_critter_by_one_second() {
    let mut state = JarState::new(JarSettings::default());
    let mut rng = JarRng::new();
    let id = state.next_critter_id();
    let critter = crate::genetics::roll_original(id, Species::Fish, 1, 0.0, &mut rng, &[]);
    state.critters.push(critter);

    tick(&mut state, &mut rng, 12);

    assert_eq!(state.critters[0].age_sec, 1.0);
    assert_eq!(state.clock.sim_seconds, 1.0);
}

#[test]
fn a_critter_passes_once_it_reaches_its_rolled_lifespan() {
    let mut state = JarState::new(JarSettings::default());
    let mut rng = JarRng::new();
    let id = state.next_critter_id();
    let mut critter = crate::genetics::roll_original(id, Species::Fish, 1, 0.0, &mut rng, &[]);
    critter.life = 1.0; // force passing on the very next tick
    state.critters.push(critter);

    let outcome = tick(&mut state, &mut rng, 12);

    assert!(!state.critters[0].alive);
    assert_eq!(outcome.passed, vec![id]);
}

#[test]
fn snapshot_round_trips_a_populated_jar() {
    let mut state = JarState::new(JarSettings::default());
    let mut rng = JarRng::new();
    let id = state.next_critter_id();
    state.critters.push(crate::genetics::roll_original(
        id,
        Species::Gecko,
        1,
        0.0,
        &mut rng,
        &[],
    ));

    let bytes = crate::snapshot::encode(&state).expect("encode succeeds");
    let restored = crate::snapshot::decode(&bytes).expect("decode succeeds");

    assert_eq!(restored.critters.len(), 1);
    assert_eq!(restored.critters[0].id, id);
}
