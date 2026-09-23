// The per-tick rule application, in the order SPEC.md §5 states them: aging
// -> mood/energy drift -> breeding roll -> passing. This module is the
// direct, line-by-line expression of that section's prose, not a
// reinterpretation of it. See `docs/architecture/rust-core.md` §4.4.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use jar_protocol::{CritterId, LifeStage, Personality, Sex, Species};

use crate::genetics::{self, Parent};
use crate::rng::JarRng;
use crate::state::JarState;

/// Life-stage thresholds, in jar-days (SPEC.md §5).
const JUVENILE_AT_DAYS: f32 = 2.0;
const ADULT_AT_DAYS: f32 = 5.0;
const ELDER_AT_DAYS: f32 = 22.0;

/// The classification rule behind `jar_protocol::LifeStage` — the type
/// itself lives in `jar-protocol` (it crosses the wire on every `Critter`/
/// `CritterStats`), but the rule that derives it from `age_sec` is
/// simulation logic, so it stays here.
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
/// §4.7 — `Born`/`Passed` are not queued for the next batch). `local_hour`
/// (the caller's current wall-clock hour, 0-23) only matters at Real time
/// (1×) — see `JarClock::is_night`'s own doc comment for why the jar's own
/// clock can't answer that case on its own.
pub fn tick(state: &mut JarState, rng: &mut JarRng, local_hour: u8) -> TickOutcome {
    state.clock.advance_one_tick();
    let is_night = state.clock.is_night(local_hour);
    let population = state.critters.iter().filter(|c| c.alive).count() as f32;

    let mut outcome = TickOutcome {
        is_night,
        ..TickOutcome::default()
    };

    // 1. Aging + passing.
    for critter in state.critters.iter_mut().filter(|c| c.alive) {
        critter.age_sec += 1.0;
        critter.life_stage = life_stage(critter.age_sec);
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
    /// This tick's `JarClock::is_night` result — carried out of `tick()` so
    /// `events.rs` can push it as part of `TickUpdate` rather than the
    /// frontend re-deriving its own copy from `simSeconds`/the system
    /// clock, which could disagree with what this tick actually decided
    /// (see `JarClock::is_night`'s own doc comment for the failure mode
    /// that split ownership caused before this).
    pub is_night: bool,
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
        let chance = breed_chance(males.len() * females.len());
        if !rng.chance(chance) {
            continue;
        }

        let parent_a = males[rng.range_u16(0, males.len() as u16) as usize];
        let parent_b = females[rng.range_u16(0, females.len() as u16) as usize];
        spawn_child(state, rng, parent_a, parent_b, outcome);
    }
}

/// Chance per tick that a species breeds, proportional to the number of
/// eligible opposite-sex adult pairs (SPEC.md §5), capped at 0.2.
fn breed_chance(pair_count: usize) -> f32 {
    (0.002 * pair_count as f32).min(0.2)
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

#[cfg(test)]
mod tests {
    use jar_protocol::{Critter, FavouriteSpot, FinType, JarSettings};

    use super::*;

    /// Between `ADULT_AT_DAYS` (5 jar-days = 600s) and `ELDER_AT_DAYS`
    /// (22 jar-days = 2640s).
    const ADULT_AGE: f32 = 700.0;
    /// Between `JUVENILE_AT_DAYS` (2 jar-days = 240s) and `ADULT_AT_DAYS`
    /// (600s).
    const JUVENILE_AGE: f32 = 300.0;
    /// Pre-tick sim-seconds that land the clock at 61s (fraction ~0.508)
    /// after `advance_one_tick` — inside the day window.
    const DAY_SIM_SECONDS: f64 = 60.0;
    /// Pre-tick sim-seconds that land the clock at exactly 105s
    /// (fraction 0.875 = 21:00) after `advance_one_tick` — the start of
    /// the night window.
    const NIGHT_SIM_SECONDS: f64 = 104.0;

    fn make_critter(
        id: u32,
        species: Species,
        sex: Sex,
        personality: Personality,
        age_sec: f32,
        energy: f32,
    ) -> Critter {
        Critter {
            id: CritterId(id),
            species,
            name: format!("Critter{id}"),
            hue: 180,
            fin: match species {
                Species::Fish => Some(FinType::Veil),
                Species::Gecko => None,
            },
            spots: false,
            sex,
            personality,
            mood: 66.0,
            energy,
            age_sec,
            life_stage: life_stage(age_sec),
            life: 100_000.0,
            gen: 1,
            parents: None,
            alive: true,
            born: 0.0,
            died: None,
            favourite_spot: FavouriteSpot {
                x: 50.0,
                y: 50.0,
                z: 50.0,
            },
        }
    }

    /// Not speed 1: these tests are about the jar's own compressed
    /// day/night cycle at `sim_seconds` granularity, which `is_night` only
    /// consults at speeds other than 1 (see its own doc comment) — the
    /// exact speed doesn't matter beyond that, so any non-1 value works.
    const TEST_SPEED: u8 = 2;
    /// Passed to every `tick()` call below — irrelevant at `TEST_SPEED`,
    /// since `is_night` only reads it at speed 1.
    const IGNORED_LOCAL_HOUR: u8 = 12;

    fn state_with(critters: Vec<Critter>, sim_seconds: f64, light_on: bool) -> JarState {
        let mut state = JarState::new(JarSettings {
            light_on,
            ..JarSettings::default()
        });
        state.critters = critters;
        state.clock = crate::clock::JarClock::resume(sim_seconds, TEST_SPEED);
        state
    }

    #[test]
    fn life_stage_boundaries_match_spec() {
        // Paired with `simConstants.test.ts`'s equivalent cases — together
        // they're the sync-enforcement mechanism for the frontend's
        // hand-duplicated copy of these thresholds (SPEC.md §5).
        assert_eq!(life_stage(239.0), LifeStage::Fry);
        assert_eq!(life_stage(240.0), LifeStage::Juvenile);
        assert_eq!(life_stage(599.0), LifeStage::Juvenile);
        assert_eq!(life_stage(600.0), LifeStage::Adult);
        assert_eq!(life_stage(2639.0), LifeStage::Adult);
        assert_eq!(life_stage(2640.0), LifeStage::Elder);
    }

    #[test]
    fn breed_chance_scales_with_pair_count_and_caps_at_0_2() {
        assert_eq!(breed_chance(0), 0.0);
        assert!((breed_chance(1) - 0.002).abs() < 1e-6);
        assert!((breed_chance(50) - 0.1).abs() < 1e-6);
        assert!((breed_chance(100) - 0.2).abs() < 1e-6);
        assert_eq!(breed_chance(1000), 0.2); // well above the cap
    }

    #[test]
    fn no_births_at_the_fish_population_cap() {
        let mut critters = Vec::new();
        for i in 0..5 {
            critters.push(make_critter(
                i,
                Species::Fish,
                Sex::Male,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            ));
            critters.push(make_critter(
                i + 5,
                Species::Fish,
                Sex::Female,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            ));
        }
        let mut state = state_with(critters, DAY_SIM_SECONDS, true);
        let mut rng = JarRng::new();
        for _ in 0..200 {
            let outcome = tick(&mut state, &mut rng, IGNORED_LOCAL_HOUR);
            assert!(outcome.born.is_empty());
            assert!(state.living_count(Species::Fish) <= 10);
        }
    }

    #[test]
    fn no_births_at_the_gecko_population_cap() {
        let mut critters = Vec::new();
        for i in 0..2 {
            critters.push(make_critter(
                i,
                Species::Gecko,
                Sex::Male,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            ));
            critters.push(make_critter(
                i + 2,
                Species::Gecko,
                Sex::Female,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            ));
        }
        let mut state = state_with(critters, DAY_SIM_SECONDS, true);
        let mut rng = JarRng::new();
        for _ in 0..200 {
            let outcome = tick(&mut state, &mut rng, IGNORED_LOCAL_HOUR);
            assert!(outcome.born.is_empty());
            assert!(state.living_count(Species::Gecko) <= 4);
        }
    }

    #[test]
    fn no_births_without_an_opposite_sex_pair() {
        let critters = vec![
            make_critter(
                1,
                Species::Fish,
                Sex::Male,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            ),
            make_critter(
                2,
                Species::Fish,
                Sex::Male,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            ),
        ];
        let mut state = state_with(critters, DAY_SIM_SECONDS, true);
        let mut rng = JarRng::new();
        for _ in 0..200 {
            assert!(tick(&mut state, &mut rng, IGNORED_LOCAL_HOUR)
                .born
                .is_empty());
        }
    }

    #[test]
    fn juveniles_and_elders_do_not_breed() {
        let critters = vec![
            make_critter(
                1,
                Species::Fish,
                Sex::Male,
                Personality::Bold,
                JUVENILE_AGE,
                100.0,
            ),
            make_critter(
                2,
                Species::Fish,
                Sex::Female,
                Personality::Bold,
                JUVENILE_AGE,
                100.0,
            ),
        ];
        let mut state = state_with(critters, DAY_SIM_SECONDS, true);
        let mut rng = JarRng::new();
        for _ in 0..200 {
            assert!(tick(&mut state, &mut rng, IGNORED_LOCAL_HOUR)
                .born
                .is_empty());
        }
    }

    #[test]
    fn no_breeding_at_night() {
        let critters = vec![
            make_critter(
                1,
                Species::Fish,
                Sex::Male,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            ),
            make_critter(
                2,
                Species::Fish,
                Sex::Female,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            ),
        ];
        let mut state = state_with(critters, NIGHT_SIM_SECONDS, true);
        let mut rng = JarRng::new();
        for _ in 0..30 {
            assert!(tick(&mut state, &mut rng, IGNORED_LOCAL_HOUR)
                .born
                .is_empty());
        }
    }

    #[test]
    fn energy_refills_while_asleep_and_drains_while_awake() {
        let mut rng = JarRng::new();

        let mut night_state = state_with(
            vec![make_critter(
                1,
                Species::Fish,
                Sex::Male,
                Personality::Bold,
                ADULT_AGE,
                50.0,
            )],
            NIGHT_SIM_SECONDS,
            true,
        );
        tick(&mut night_state, &mut rng, IGNORED_LOCAL_HOUR);
        assert_eq!(night_state.critters[0].energy, 52.0);

        let mut day_state = state_with(
            vec![make_critter(
                1,
                Species::Fish,
                Sex::Male,
                Personality::Bold,
                ADULT_AGE,
                50.0,
            )],
            DAY_SIM_SECONDS,
            true,
        );
        tick(&mut day_state, &mut rng, IGNORED_LOCAL_HOUR);
        assert!((day_state.critters[0].energy - 49.95).abs() < 1e-6);
    }

    #[test]
    fn energy_is_clamped_to_0_and_100() {
        let mut rng = JarRng::new();

        let mut low = state_with(
            vec![make_critter(
                1,
                Species::Fish,
                Sex::Male,
                Personality::Bold,
                ADULT_AGE,
                0.02,
            )],
            DAY_SIM_SECONDS,
            true,
        );
        tick(&mut low, &mut rng, IGNORED_LOCAL_HOUR);
        assert_eq!(low.critters[0].energy, 0.0);

        let mut high = state_with(
            vec![make_critter(
                1,
                Species::Fish,
                Sex::Male,
                Personality::Bold,
                ADULT_AGE,
                99.5,
            )],
            NIGHT_SIM_SECONDS,
            true,
        );
        tick(&mut high, &mut rng, IGNORED_LOCAL_HOUR);
        assert_eq!(high.critters[0].energy, 100.0);
    }

    #[test]
    fn mood_converges_toward_the_target_with_bounded_noise() {
        // Bold has no mood modifier; light on, full energy -> target 70,
        // one tick moves mood 66 -> 66.2 plus noise bounded to +/-1.
        let mut state = state_with(
            vec![make_critter(
                1,
                Species::Fish,
                Sex::Male,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            )],
            DAY_SIM_SECONDS,
            true,
        );
        let mut rng = JarRng::new();
        tick(&mut state, &mut rng, IGNORED_LOCAL_HOUR);
        let mood = state.critters[0].mood;
        assert!(
            (65.2..=67.2).contains(&mood),
            "mood {mood} out of expected range"
        );
    }

    #[test]
    fn shy_critters_lose_mood_as_population_grows() {
        // target = 66 + 4 (light on) - 3*5 (population) = 55; mood 66 ->
        // 65.45 plus noise bounded to +/-1.
        let mut critters = vec![make_critter(
            1,
            Species::Fish,
            Sex::Male,
            Personality::Shy,
            ADULT_AGE,
            100.0,
        )];
        for i in 2..=5 {
            critters.push(make_critter(
                i,
                Species::Fish,
                Sex::Female,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            ));
        }
        let mut state = state_with(critters, DAY_SIM_SECONDS, true);
        let mut rng = JarRng::new();
        tick(&mut state, &mut rng, IGNORED_LOCAL_HOUR);
        let mood = state.critters[0].mood;
        assert!(
            (64.45..=66.45).contains(&mood),
            "mood {mood} out of expected range"
        );
    }

    #[test]
    fn low_energy_pulls_mood_down_regardless_of_personality() {
        // target = 66 + 4 (light) - 15 (low energy) = 55; mood 66 -> 65.45
        // plus noise bounded to +/-1.
        let mut state = state_with(
            vec![make_critter(
                1,
                Species::Fish,
                Sex::Male,
                Personality::Bold,
                ADULT_AGE,
                20.0,
            )],
            DAY_SIM_SECONDS,
            true,
        );
        let mut rng = JarRng::new();
        tick(&mut state, &mut rng, IGNORED_LOCAL_HOUR);
        let mood = state.critters[0].mood;
        assert!(
            (64.45..=66.45).contains(&mood),
            "mood {mood} out of expected range"
        );
    }

    #[test]
    fn dramatic_critters_get_wider_mood_noise() {
        // Same 66.2 centre as the Bold case, but +/-4 noise instead of +/-1.
        let mut state = state_with(
            vec![make_critter(
                1,
                Species::Fish,
                Sex::Male,
                Personality::Dramatic,
                ADULT_AGE,
                100.0,
            )],
            DAY_SIM_SECONDS,
            true,
        );
        let mut rng = JarRng::new();
        tick(&mut state, &mut rng, IGNORED_LOCAL_HOUR);
        let mood = state.critters[0].mood;
        assert!(
            (62.2..=70.2).contains(&mood),
            "mood {mood} out of expected range"
        );
    }

    #[test]
    fn mood_never_leaves_0_100_even_under_an_extreme_target() {
        let mut critters = vec![make_critter(
            1,
            Species::Fish,
            Sex::Male,
            Personality::Shy,
            ADULT_AGE,
            100.0,
        )];
        critters[0].mood = 0.0;
        for i in 2..=51 {
            critters.push(make_critter(
                i,
                Species::Fish,
                Sex::Female,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            ));
        }
        let mut state = state_with(critters, DAY_SIM_SECONDS, true);
        let mut rng = JarRng::new();
        tick(&mut state, &mut rng, IGNORED_LOCAL_HOUR);
        assert_eq!(state.critters[0].mood, 0.0);
    }

    #[test]
    fn child_generation_is_max_parent_gen_plus_one_and_parents_are_recorded() {
        let mut rng = JarRng::new();
        let parent_a = make_critter(
            1,
            Species::Fish,
            Sex::Male,
            Personality::Bold,
            ADULT_AGE,
            100.0,
        );
        let mut parent_b = make_critter(
            2,
            Species::Fish,
            Sex::Female,
            Personality::Bold,
            ADULT_AGE,
            100.0,
        );
        parent_b.gen = 3;

        let child = genetics::roll_child(
            CritterId(3),
            Parent { critter: &parent_a },
            Parent { critter: &parent_b },
            parent_a.gen.max(parent_b.gen) + 1,
            0.0,
            &mut rng,
            &[],
        );

        assert_eq!(child.gen, 4);
        assert_eq!(child.parents, Some([CritterId(1), CritterId(2)]));
    }
}
