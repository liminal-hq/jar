// The genetics roll for a new critter — original or child — per SPEC.md §5.
// This is the one place these rules are implemented; `tick.rs` calls into
// here at breeding/spawn time rather than re-deriving any of it.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use jar_protocol::{Critter, CritterId, FavouriteSpot, FinType, Personality, Sex, Species};

use crate::rng::JarRng;

/// Gecko originals roll hue from this fixed palette rather than a free
/// 0-360 roll, per SPEC.md/`Jar.dc.html`'s original constant, carried
/// forward unchanged (`docs/architecture/3d-engine.md` §7).
const GECKO_HUE_PALETTE: [u16; 5] = [28, 42, 75, 110, 150];

const SPOT_INHERIT_CHANCE: f32 = 0.7;
const HUE_MUTATION_RANGE: f32 = 18.0;

const NAME_POOL: &[&str] = &[
    "Pickle",
    "Sir Bubbles",
    "Mortimer",
    "Dr. Fins",
    "Noodle",
    "Biscuit",
    "Gilbert",
    "Marmalade",
    "Sprocket",
    "Waffles",
];

pub struct Parent<'a> {
    pub critter: &'a Critter,
}

/// Rolls a brand-new original critter (not a child of anyone in the jar).
pub fn roll_original(
    id: CritterId,
    species: Species,
    gen: u32,
    born_at: f64,
    rng: &mut JarRng,
    existing_names: &[String],
) -> Critter {
    let hue = match species {
        Species::Gecko => {
            GECKO_HUE_PALETTE[rng.range_u16(0, GECKO_HUE_PALETTE.len() as u16) as usize]
        }
        Species::Fish => rng.range_u16(0, 360),
    };
    let fin = match species {
        Species::Fish => Some(roll_fin(rng)),
        Species::Gecko => None,
    };

    Critter {
        id,
        species,
        name: roll_name(existing_names),
        hue,
        fin,
        spots: rng.chance(0.4),
        sex: roll_sex(rng),
        personality: roll_personality(rng),
        mood: 66.0,
        energy: 100.0,
        age_sec: 0.0,
        life: roll_lifespan(rng),
        gen,
        parents: None,
        alive: true,
        born: born_at,
        died: None,
        favourite_spot: roll_favourite_spot(rng),
    }
}

/// Rolls a child of `parent_a` and `parent_b` per SPEC.md §5's inheritance
/// rules. Caller (`tick.rs`) is responsible for verifying breeding
/// eligibility before calling this — this function only implements the
/// genetics, not the "should they breed" decision.
pub fn roll_child(
    id: CritterId,
    parent_a: Parent,
    parent_b: Parent,
    gen: u32,
    born_at: f64,
    rng: &mut JarRng,
    existing_names: &[String],
) -> Critter {
    let species = parent_a.critter.species;
    let base_hue = (parent_a.critter.hue as f32 + parent_b.critter.hue as f32) / 2.0;
    let hue = ((base_hue + rng.range_f32(-HUE_MUTATION_RANGE, HUE_MUTATION_RANGE))
        .rem_euclid(360.0)) as u16;

    let fin = match species {
        Species::Fish => {
            // "from one parent" (SPEC.md §5) — pick whichever parent's fin
            // gene wins the coin flip.
            let from_a = rng.chance(0.5);
            if from_a {
                parent_a.critter.fin
            } else {
                parent_b.critter.fin
            }
        }
        Species::Gecko => None,
    };

    let either_has_spots = parent_a.critter.spots || parent_b.critter.spots;
    let spots = either_has_spots && rng.chance(SPOT_INHERIT_CHANCE);

    Critter {
        id,
        species,
        name: roll_name(existing_names),
        hue,
        fin,
        spots,
        sex: roll_sex(rng), // not inherited — SPEC.md §5's amended rule
        personality: roll_personality(rng),
        mood: 66.0,
        energy: 100.0,
        age_sec: 0.0,
        life: roll_lifespan(rng),
        gen,
        parents: Some([parent_a.critter.id, parent_b.critter.id]),
        alive: true,
        born: born_at,
        died: None,
        favourite_spot: roll_favourite_spot(rng),
    }
}

fn roll_fin(rng: &mut JarRng) -> FinType {
    match rng.range_u16(0, 3) {
        0 => FinType::Fan,
        1 => FinType::Forked,
        _ => FinType::Veil,
    }
}

fn roll_sex(rng: &mut JarRng) -> Sex {
    if rng.chance(0.5) {
        Sex::Male
    } else {
        Sex::Female
    }
}

fn roll_personality(rng: &mut JarRng) -> Personality {
    match rng.range_u16(0, 6) {
        0 => Personality::Shy,
        1 => Personality::Greedy,
        2 => Personality::Curious,
        3 => Personality::Sleepy,
        4 => Personality::Bold,
        _ => Personality::Dramatic,
    }
}

/// 26-36 jar-days, expressed in sim-seconds (SPEC.md §5).
fn roll_lifespan(rng: &mut JarRng) -> f32 {
    rng.range_f32(26.0, 36.0) * crate::clock::SECONDS_PER_JAR_DAY as f32
}

fn roll_favourite_spot(rng: &mut JarRng) -> FavouriteSpot {
    FavouriteSpot {
        x: rng.range_f32(0.0, 100.0),
        y: rng.range_f32(0.0, 100.0),
        z: rng.range_f32(0.0, 100.0),
    }
}

/// Auto-names from the silly list; repeats get `II`, `III`, ... per
/// SPEC.md §5. Falls back to a random pick once a full pass of the pool
/// collides on every entry (astronomically unlikely at Jar's population
/// caps, but cheap to make total).
fn roll_name(existing_names: &[String]) -> String {
    for base in NAME_POOL {
        let count = existing_names
            .iter()
            .filter(|n| n.as_str() == *base || n.starts_with(&format!("{base} ")))
            .count();
        if count == 0 {
            return base.to_string();
        }
    }
    // Every base name is taken at least once — suffix the first one with
    // the next roman-numeral-ish ordinal.
    let base = NAME_POOL[0];
    let count = existing_names
        .iter()
        .filter(|n| n.starts_with(base))
        .count();
    format!("{base} {}", roman_numeral(count as u32 + 1))
}

fn roman_numeral(n: u32) -> String {
    match n {
        1 => "I".into(),
        2 => "II".into(),
        3 => "III".into(),
        4 => "IV".into(),
        n => format!("#{n}"),
    }
}

#[cfg(test)]
mod tests {
    use jar_protocol::FavouriteSpot;

    use super::*;

    fn parent(species: Species, hue: u16, fin: Option<FinType>, spots: bool) -> Critter {
        Critter {
            id: CritterId(0),
            species,
            name: "Parent".into(),
            hue,
            fin,
            spots,
            sex: Sex::Male,
            personality: Personality::Bold,
            mood: 66.0,
            energy: 100.0,
            age_sec: 1000.0,
            life: 100_000.0,
            gen: 1,
            parents: None,
            alive: true,
            born: 0.0,
            died: None,
            favourite_spot: FavouriteSpot {
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
        }
    }

    #[test]
    fn child_hue_is_parents_mean_plus_minus_18() {
        let mut rng = JarRng::new();
        let a = parent(Species::Fish, 100, Some(FinType::Veil), false);
        let b = parent(Species::Fish, 200, Some(FinType::Veil), false);
        for _ in 0..200 {
            let child = roll_child(
                CritterId(1),
                Parent { critter: &a },
                Parent { critter: &b },
                2,
                0.0,
                &mut rng,
                &[],
            );
            assert!(
                (132..=168).contains(&child.hue),
                "hue {} outside parents' mean +/-18",
                child.hue
            );
        }
    }

    #[test]
    fn child_hue_uses_a_naive_mean_not_a_circular_one() {
        // Parents at 350 and 10 are 20 degrees apart on the wheel, but this
        // formula deliberately isn't hue-wheel-aware — the mean is a plain
        // arithmetic (350+10)/2 = 180, not something near 0.
        let mut rng = JarRng::new();
        let a = parent(Species::Fish, 350, Some(FinType::Veil), false);
        let b = parent(Species::Fish, 10, Some(FinType::Veil), false);
        for _ in 0..200 {
            let child = roll_child(
                CritterId(1),
                Parent { critter: &a },
                Parent { critter: &b },
                2,
                0.0,
                &mut rng,
                &[],
            );
            assert!(
                (162..=198).contains(&child.hue),
                "hue {} outside the naive-mean +/-18 window",
                child.hue
            );
        }
    }

    #[test]
    fn child_hue_stays_in_0_360_across_the_wrap() {
        let mut rng = JarRng::new();
        let a = parent(Species::Fish, 355, Some(FinType::Veil), false);
        let b = parent(Species::Fish, 359, Some(FinType::Veil), false);
        for _ in 0..200 {
            let child = roll_child(
                CritterId(1),
                Parent { critter: &a },
                Parent { critter: &b },
                2,
                0.0,
                &mut rng,
                &[],
            );
            assert!(child.hue < 360, "hue {} did not wrap", child.hue);
        }
    }

    #[test]
    fn fin_comes_from_exactly_one_parent() {
        let mut rng = JarRng::new();
        let a = parent(Species::Fish, 180, Some(FinType::Fan), false);
        let b = parent(Species::Fish, 180, Some(FinType::Veil), false);
        let mut saw_fan = false;
        let mut saw_veil = false;
        for _ in 0..200 {
            let child = roll_child(
                CritterId(1),
                Parent { critter: &a },
                Parent { critter: &b },
                2,
                0.0,
                &mut rng,
                &[],
            );
            match child.fin {
                Some(FinType::Fan) => saw_fan = true,
                Some(FinType::Veil) => saw_veil = true,
                other => panic!("child fin {other:?} came from neither parent"),
            }
        }
        assert!(
            saw_fan && saw_veil,
            "expected both parents' fin genes to appear over 200 rolls"
        );
    }

    #[test]
    fn gecko_children_never_have_a_fin() {
        let mut rng = JarRng::new();
        let a = parent(Species::Gecko, 75, None, false);
        let b = parent(Species::Gecko, 110, None, false);
        for _ in 0..50 {
            let child = roll_child(
                CritterId(1),
                Parent { critter: &a },
                Parent { critter: &b },
                2,
                0.0,
                &mut rng,
                &[],
            );
            assert_eq!(child.fin, None);
        }
    }

    #[test]
    fn spots_never_appear_from_two_plain_parents() {
        let mut rng = JarRng::new();
        let a = parent(Species::Fish, 180, Some(FinType::Veil), false);
        let b = parent(Species::Fish, 180, Some(FinType::Veil), false);
        for _ in 0..200 {
            let child = roll_child(
                CritterId(1),
                Parent { critter: &a },
                Parent { critter: &b },
                2,
                0.0,
                &mut rng,
                &[],
            );
            assert!(!child.spots);
        }
    }

    #[test]
    fn spots_inherit_at_roughly_seventy_percent_when_one_parent_has_them() {
        let mut rng = JarRng::new();
        let a = parent(Species::Fish, 180, Some(FinType::Veil), true);
        let b = parent(Species::Fish, 180, Some(FinType::Veil), false);
        let n = 2000;
        let mut spotted = 0;
        for _ in 0..n {
            let child = roll_child(
                CritterId(1),
                Parent { critter: &a },
                Parent { critter: &b },
                2,
                0.0,
                &mut rng,
                &[],
            );
            if child.spots {
                spotted += 1;
            }
        }
        let rate = spotted as f64 / n as f64;
        assert!(
            (0.6..=0.8).contains(&rate),
            "spot inheritance rate {rate} far from 70%"
        );
    }

    #[test]
    fn sex_is_rolled_independently_of_parent_sexes() {
        let mut rng = JarRng::new();
        // Both parents constructed as Male via `parent()`.
        let a = parent(Species::Fish, 180, Some(FinType::Veil), false);
        let b = parent(Species::Fish, 180, Some(FinType::Veil), false);
        let mut saw_male = false;
        let mut saw_female = false;
        for _ in 0..200 {
            let child = roll_child(
                CritterId(1),
                Parent { critter: &a },
                Parent { critter: &b },
                2,
                0.0,
                &mut rng,
                &[],
            );
            match child.sex {
                Sex::Male => saw_male = true,
                Sex::Female => saw_female = true,
            }
        }
        assert!(
            saw_male && saw_female,
            "expected both sexes to appear over 200 rolls despite both parents being Male"
        );
    }

    #[test]
    fn gecko_originals_use_the_fixed_hue_palette() {
        let mut rng = JarRng::new();
        for _ in 0..50 {
            let original = roll_original(CritterId(1), Species::Gecko, 1, 0.0, &mut rng, &[]);
            assert!(
                GECKO_HUE_PALETTE.contains(&original.hue),
                "gecko hue {} not in the fixed palette",
                original.hue
            );
        }
    }

    #[test]
    fn fish_original_hue_covers_the_full_wheel() {
        let mut rng = JarRng::new();
        for _ in 0..50 {
            let original = roll_original(CritterId(1), Species::Fish, 1, 0.0, &mut rng, &[]);
            assert!(original.hue < 360);
        }
    }

    #[test]
    fn lifespan_is_26_to_36_jar_days() {
        let mut rng = JarRng::new();
        for _ in 0..50 {
            let original = roll_original(CritterId(1), Species::Fish, 1, 0.0, &mut rng, &[]);
            let days = original.life / crate::clock::SECONDS_PER_JAR_DAY as f32;
            assert!(
                (26.0..36.0).contains(&days),
                "lifespan {days} jar-days out of range"
            );
        }
    }

    #[test]
    fn naming_picks_the_next_unclaimed_base_name() {
        let existing = vec!["Pickle".to_string()];
        assert_eq!(roll_name(&existing), "Sir Bubbles");
    }

    #[test]
    fn naming_falls_back_to_a_roman_numeral_once_the_pool_is_exhausted() {
        let existing: Vec<String> = NAME_POOL.iter().map(|s| s.to_string()).collect();
        assert_eq!(roll_name(&existing), "Pickle II");
    }
}
