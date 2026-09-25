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

/// Life-stage thresholds, in jar-days (SPEC.md §5). Fry/Juvenile/Adult
/// onsets are the same for every species — only the Elder threshold is
/// species-aware (see `elder_at_days`), so every species matures and
/// becomes breeding-eligible on the same schedule.
const JUVENILE_AT_DAYS: f32 = 2.0;
const ADULT_AT_DAYS: f32 = 5.0;
const ELDER_AT_DAYS: f32 = 22.0;
/// A snail's 52-72 jar-day lifespan (`genetics::roll_lifespan`) is roughly
/// 2x a fish/gecko's — using the same 22-day Elder threshold would make a
/// snail spend most of its life as a breeding-ineligible Elder. Doubled
/// alongside the lifespan itself so a snail's "old age" fraction of its
/// life stays comparable to a fish's.
const SNAIL_ELDER_AT_DAYS: f32 = 44.0;

fn elder_at_days(species: Species) -> f32 {
    match species {
        Species::Fish | Species::Gecko => ELDER_AT_DAYS,
        Species::Snail => SNAIL_ELDER_AT_DAYS,
    }
}

/// The classification rule behind `jar_protocol::LifeStage` — the type
/// itself lives in `jar-protocol` (it crosses the wire on every `Critter`/
/// `CritterStats`), but the rule that derives it from `age_sec` is
/// simulation logic, so it stays here.
pub fn life_stage(species: Species, age_sec: f32) -> LifeStage {
    let age_days = age_sec / crate::clock::SECONDS_PER_JAR_DAY as f32;
    if age_days < JUVENILE_AT_DAYS {
        LifeStage::Fry
    } else if age_days < ADULT_AT_DAYS {
        LifeStage::Juvenile
    } else if age_days < elder_at_days(species) {
        LifeStage::Adult
    } else {
        LifeStage::Elder
    }
}

/// Whether a critter of this species is awake right now — the one place
/// nocturnality lives. Every species except the snail is diurnal (awake by
/// day, asleep at night); the snail inverts that (issue #98's settled
/// decision). Drives both the mood/energy pass and the breeding gate below,
/// so "awake" means the same thing for both.
fn is_awake(species: Species, is_night: bool) -> bool {
    match species {
        Species::Snail => is_night,
        Species::Fish | Species::Gecko => !is_night,
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
    // Per-species, not jar-wide — a critter's social-pressure mood terms
    // (Shy/Curious below) should only react to its own kind, the same
    // "separate pools" principle `population_cap`/breeding already apply.
    // Distinct from a single shared count now that a habitat can genuinely
    // hold two species at once (the aquarium's fish + snail, issue #98) —
    // a shy fish shouldn't read a jar full of snails as a crowd it's
    // avoiding, any more than a snail should count fish toward its own.
    let fish_population = state.living_count(Species::Fish) as f32;
    let gecko_population = state.living_count(Species::Gecko) as f32;
    let snail_population = state.living_count(Species::Snail) as f32;

    let mut outcome = TickOutcome {
        is_night,
        ..TickOutcome::default()
    };

    // 1. Aging + passing.
    for critter in state.critters.iter_mut().filter(|c| c.alive) {
        critter.age_sec += 1.0;
        critter.life_stage = life_stage(critter.species, critter.age_sec);
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
    // Per-species `is_awake`, not the jar-wide `is_night` directly, since a
    // nocturnal species (the snail) sleeps opposite everyone else.
    for critter in state.critters.iter_mut().filter(|c| c.alive) {
        if !is_awake(critter.species, is_night) {
            critter.energy = (critter.energy + 2.0).min(100.0);
            continue;
        }

        let mut target = 66.0_f32;
        if state.settings.light_on {
            target += 4.0;
        } else {
            target -= 6.0;
        }
        let own_species_population = match critter.species {
            Species::Fish => fish_population,
            Species::Gecko => gecko_population,
            Species::Snail => snail_population,
        };
        match critter.personality {
            Personality::Shy => target -= 3.0 * own_species_population,
            Personality::Curious => target += 2.0 * own_species_population,
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
    // one female (SPEC.md §5). The awake-or-not gate is per-species inside
    // `try_breed` now (a nocturnal species breeds on the opposite schedule
    // from everyone else), not a single jar-wide `if !is_night` here.
    try_breed(state, rng, is_night, &mut outcome);

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

// Deliberately no floor or reseed mechanism below: a species that craters
// to zero living critters, or to only one sex, stays that way forever —
// accepted as an honest outcome of a small stochastic population, not a bug
// to paper over with a new "restock" mechanic. `breed_chance` below is
// tuned to make this rare, not to make it impossible.
fn try_breed(state: &mut JarState, rng: &mut JarRng, is_night: bool, outcome: &mut TickOutcome) {
    // `Species::ALL`, not a hand-written array — a hardcoded list here would
    // compile fine with a species missing and just silently never breed it
    // (exactly the bug a future fourth species could otherwise reintroduce).
    for species in Species::ALL {
        if !is_awake(species, is_night) {
            continue;
        }

        let cap = crate::state::population_cap(species);
        if state.living_count(species) >= cap {
            continue;
        }

        let eligible: Vec<CritterId> = state
            .critters
            .iter()
            .filter(|c| {
                c.alive
                    && c.species == species
                    && life_stage(c.species, c.age_sec) == LifeStage::Adult
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

/// The general per-pair rate — unchanged from this constant's original,
/// well-balanced value. A species with many eligible pairs breeds at
/// `pair_count * BASE_BREED_CHANCE_PER_PAIR` per tick, same as always.
const BASE_BREED_CHANCE_PER_PAIR: f32 = 0.002;

/// A floor applied only when there's exactly one eligible pair — the
/// smallest realistic population after a cap-driven die-off crash, and the
/// one case whose recovery speed actually mattered (see `breed_chance`'s
/// own doc comment). Chosen so a single pair's expected wait for a first
/// birth is roughly halved (~4 real minutes at 1x speed) versus the base
/// rate alone. Deliberately *not* a multiplier applied to every pair count
/// — that would also double ordinary steady-state breeding cadence at
/// every larger, already-balanced population, which was never the reported
/// problem.
const SINGLE_PAIR_RECOVERY_CHANCE: f32 = 0.004;

/// Chance per tick that a species breeds. Proportional to the number of
/// eligible opposite-sex adult pairs (SPEC.md §5) for two or more pairs,
/// capped at 0.2 — neither the base coefficient nor the ceiling is pinned
/// by the spec, which only requires the proportionality. Pair count 1 is a
/// deliberate exception, not a smaller case of the same formula: it's
/// pinned to `SINGLE_PAIR_RECOVERY_CHANCE` regardless of what the base rate
/// would say, so proportionality only holds from 2 pairs up.
fn breed_chance(pair_count: usize) -> f32 {
    match pair_count {
        0 => 0.0,
        1 => SINGLE_PAIR_RECOVERY_CHANCE,
        n => (BASE_BREED_CHANCE_PER_PAIR * n as f32).min(0.2),
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
                Species::Gecko | Species::Snail => None,
            },
            spots: false,
            shell: None,
            pattern: None,
            sex,
            personality,
            mood: 66.0,
            energy,
            age_sec,
            life_stage: life_stage(species, age_sec),
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
        assert_eq!(life_stage(Species::Fish, 239.0), LifeStage::Fry);
        assert_eq!(life_stage(Species::Fish, 240.0), LifeStage::Juvenile);
        assert_eq!(life_stage(Species::Fish, 599.0), LifeStage::Juvenile);
        assert_eq!(life_stage(Species::Fish, 600.0), LifeStage::Adult);
        assert_eq!(life_stage(Species::Fish, 2639.0), LifeStage::Adult);
        assert_eq!(life_stage(Species::Fish, 2640.0), LifeStage::Elder);
    }

    #[test]
    fn snail_elder_threshold_is_double_fish_and_geckos() {
        // Fry/Juvenile/Adult onsets are shared across every species — only
        // Elder is species-aware, doubled alongside the snail's ~2x lifespan
        // so a snail doesn't spend most of its life as a breeding-ineligible
        // Elder (issue #98).
        assert_eq!(life_stage(Species::Snail, 2639.0), LifeStage::Adult);
        assert_eq!(life_stage(Species::Snail, 5279.0), LifeStage::Adult);
        assert_eq!(life_stage(Species::Snail, 5280.0), LifeStage::Elder);
        // Fish/gecko still flip at the original threshold, unaffected.
        assert_eq!(life_stage(Species::Gecko, 2640.0), LifeStage::Elder);
    }

    #[test]
    fn breed_chance_scales_with_pair_count_and_caps_at_0_2() {
        assert_eq!(breed_chance(0), 0.0);
        // The single-pair recovery floor — 0.002 * 1 alone would be 0.002.
        assert!((breed_chance(1) - 0.004).abs() < 1e-6);
        // At two pairs the base rate alone already equals the floor —
        // proportionality resumes exactly here (see breed_chance's own
        // doc comment on why 1 is a real exception, not just this
        // formula's smallest input).
        assert!((breed_chance(2) - 0.004).abs() < 1e-6);
        assert!((breed_chance(25) - 0.05).abs() < 1e-6);
        assert!((breed_chance(100) - 0.2).abs() < 1e-6);
        assert_eq!(breed_chance(1000), 0.2); // well above the cap
    }

    /// `pairs` male/female Fish pairs, ages/energy fixed at values both
    /// cap-boundary tests below need: exactly `population_cap(Fish)` (10)
    /// worth of pairs (5) puts the population precisely at the cap, which
    /// is what both tests are actually exercising — fewer pairs would never
    /// reach the cap at all.
    fn fish_pairs(pairs: u32) -> Vec<Critter> {
        let mut critters = Vec::new();
        for i in 0..pairs {
            critters.push(make_critter(
                i,
                Species::Fish,
                Sex::Male,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            ));
            critters.push(make_critter(
                i + pairs,
                Species::Fish,
                Sex::Female,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            ));
        }
        critters
    }

    #[test]
    fn no_births_at_the_fish_population_cap() {
        let mut state = state_with(fish_pairs(5), DAY_SIM_SECONDS, true);
        let mut rng = JarRng::new();
        for _ in 0..200 {
            let outcome = tick(&mut state, &mut rng, IGNORED_LOCAL_HOUR);
            assert!(outcome.born.is_empty());
            assert!(state.living_count(Species::Fish) <= 10);
        }
    }

    #[test]
    fn breeding_resumes_after_population_drops_below_cap() {
        // Regression test for a real reported symptom ("breeding never
        // resumes after a cap-driven die-off") that turned out not to be a
        // bug — `living_count` and the cap check are both recomputed live
        // every tick, so nothing here should actually be latched. This
        // exercises that end to end rather than just trusting the reading.
        let mut critters = fish_pairs(5);
        // One critter dies after exactly one tick (`age_sec += 1.0` per
        // tick, dies once `age_sec >= life`), dropping the population below
        // the cap of 10 while several eligible pairs remain either way.
        critters[0].life = ADULT_AGE + 1.0;
        let mut state = state_with(critters, DAY_SIM_SECONDS, true);
        let mut rng = JarRng::new();

        // With 9 survivors (4 males, 5 females) forming 20 eligible pairs,
        // `breed_chance`'s base per-pair rate alone already gives roughly a
        // 1-in-25 chance per tick — the single-pair recovery floor only
        // matters when exactly one pair is left, nowhere near this case.
        // 5,000 ticks makes a spurious failure astronomically unlikely
        // rather than actually bounding real behaviour.
        for i in 0..5_000 {
            let outcome = tick(&mut state, &mut rng, IGNORED_LOCAL_HOUR);
            if i == 0 {
                // Aging/death and breeding both run within the same
                // `tick()` call, in that order, so the death already
                // clears the cap in time for breeding to fire on this very
                // first tick too — asserted here, not as a fixed
                // `living_count`, since a same-tick birth would make a
                // fixed count of 9 flaky.
                assert!(
                    !state.critters[0].alive,
                    "the short-lived critter should have died on the first tick"
                );
            }
            if !outcome.born.is_empty() {
                return;
            }
        }
        panic!("expected a birth within 5,000 ticks after the population dropped below cap");
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
    fn no_births_at_the_snail_population_cap_while_fish_sit_below_theirs() {
        // Separate-pool proof: a snail population already at its own cap (5)
        // must never breed further, regardless of how far below *their* cap
        // (10) the fish sharing the same jar sit — the two species never
        // compete for the same population slots.
        let mut critters = Vec::new();
        for i in 0..2 {
            critters.push(make_critter(
                i,
                Species::Snail,
                Sex::Male,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            ));
        }
        for i in 2..5 {
            critters.push(make_critter(
                i,
                Species::Snail,
                Sex::Female,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            ));
        }
        critters.push(make_critter(
            5,
            Species::Fish,
            Sex::Male,
            Personality::Bold,
            ADULT_AGE,
            100.0,
        ));
        critters.push(make_critter(
            6,
            Species::Fish,
            Sex::Female,
            Personality::Bold,
            ADULT_AGE,
            100.0,
        ));
        // Snails are nocturnal — night is when they'd otherwise breed. 30
        // ticks (not more) deliberately stays inside the ~50-tick night
        // window this state starts at — `is_night`'s underlying jar clock
        // cycles into day well before 200 ticks, at which point the two
        // fish become genuinely, correctly eligible to breed, which isn't
        // what this test is checking (that's
        // `fish_still_never_breed_at_night_with_snails_present`'s job, at
        // the same safe tick count).
        let mut state = state_with(critters, NIGHT_SIM_SECONDS, true);
        let mut rng = JarRng::new();
        for _ in 0..30 {
            tick(&mut state, &mut rng, IGNORED_LOCAL_HOUR);
            assert!(state.living_count(Species::Snail) <= 5);
        }
        // The two fish are untouched by the snail cap check.
        assert_eq!(state.living_count(Species::Fish), 2);
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
    fn snails_never_breed_by_day() {
        // The inverse of `no_breeding_at_night` — a nocturnal species
        // breeds on the opposite schedule from everyone else.
        let critters = vec![
            make_critter(
                1,
                Species::Snail,
                Sex::Male,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            ),
            make_critter(
                2,
                Species::Snail,
                Sex::Female,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            ),
        ];
        let mut state = state_with(critters, DAY_SIM_SECONDS, true);
        let mut rng = JarRng::new();
        for _ in 0..30 {
            assert!(tick(&mut state, &mut rng, IGNORED_LOCAL_HOUR)
                .born
                .is_empty());
        }
    }

    #[test]
    fn fish_still_never_breed_at_night_with_snails_present() {
        // A nocturnal species sharing the jar doesn't change fish's own
        // schedule — each species' awake gate is independent.
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
            make_critter(
                3,
                Species::Snail,
                Sex::Male,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            ),
            make_critter(
                4,
                Species::Snail,
                Sex::Female,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            ),
        ];
        let mut state = state_with(critters, NIGHT_SIM_SECONDS, true);
        let mut rng = JarRng::new();
        for _ in 0..30 {
            tick(&mut state, &mut rng, IGNORED_LOCAL_HOUR);
            // Fish population never grows from a night tick, even with an
            // awake-and-breeding-eligible snail pair in the same jar.
            assert_eq!(state.living_count(Species::Fish), 2);
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
    fn snail_energy_refills_by_day_and_drains_at_night() {
        // The inverse of `energy_refills_while_asleep_and_drains_while_awake`
        // — a nocturnal species is "asleep" (energy-refilling) exactly when
        // everyone else is awake, and vice versa.
        let mut rng = JarRng::new();

        let mut day_state = state_with(
            vec![make_critter(
                1,
                Species::Snail,
                Sex::Male,
                Personality::Bold,
                ADULT_AGE,
                50.0,
            )],
            DAY_SIM_SECONDS,
            true,
        );
        tick(&mut day_state, &mut rng, IGNORED_LOCAL_HOUR);
        assert_eq!(day_state.critters[0].energy, 52.0);

        let mut night_state = state_with(
            vec![make_critter(
                1,
                Species::Snail,
                Sex::Male,
                Personality::Bold,
                ADULT_AGE,
                50.0,
            )],
            NIGHT_SIM_SECONDS,
            true,
        );
        tick(&mut night_state, &mut rng, IGNORED_LOCAL_HOUR);
        assert!((night_state.critters[0].energy - 49.95).abs() < 1e-6);
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
    fn shy_mood_ignores_other_species_sharing_the_habitat() {
        // A shy fish alone with 20 snails: target = 66 + 4 (light) - 3*1
        // (its own species' population, itself only) = 67, mood 66 -> 66.05
        // plus noise bounded to +/-1 (range 65.05-67.05). A jar-wide count
        // of 21 would instead give target = 70 - 63 = 7, mood 66 -> 63.05
        // plus the same noise bound (range 62.05-64.05) — the two
        // hypotheses' ranges don't overlap, so this can't pass by chance.
        let mut critters = vec![make_critter(
            1,
            Species::Fish,
            Sex::Male,
            Personality::Shy,
            ADULT_AGE,
            100.0,
        )];
        for i in 2..=21 {
            critters.push(make_critter(
                i,
                Species::Snail,
                Sex::Female,
                Personality::Bold,
                ADULT_AGE,
                100.0,
            ));
        }
        // Night, so the (nocturnal) snails are asleep and don't otherwise
        // interfere — only the fish's own mood pass is under test.
        let mut state = state_with(critters, NIGHT_SIM_SECONDS, true);
        let mut rng = JarRng::new();
        tick(&mut state, &mut rng, IGNORED_LOCAL_HOUR);
        let mood = state.critters[0].mood;
        assert!(
            (65.05..=67.05).contains(&mood),
            "mood {mood} out of expected range — looks like it counted the snails too"
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
