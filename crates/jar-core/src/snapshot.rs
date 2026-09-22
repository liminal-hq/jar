// Save/load of the full `JarState` via `postcard`, with a versioned header
// so the on-disk format can evolve without breaking old saves outright. See
// `docs/architecture/rust-core.md` §4.6 — City Sim 1000's exact pattern:
// magic bytes + a version number + a comment trail at each version bump
// explaining *why* the layout changed.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use jar_protocol::{
    default_theme_variants, known_theme_variant_names, Critter, CritterId, DialogTheme,
    FavouriteSpot, FinType, JarSettings, Personality, Sex, Species, TankFrame,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::clock::JarClock;
use crate::state::JarState;

const MAGIC: [u8; 4] = *b"JAR\0";

/// Bump this and add a dated comment below explaining what changed and why,
/// every time the current snapshot body changes shape.
const CURRENT_VERSION: u16 = 3;

// v1 (initial): critters + clock + settings, as specified in
// `docs/architecture/rust-core.md` §3-4. No prior versions to migrate from
// yet.
//
// v2 (2026-09-17): `JarSettings.theme_variant: String` became
// `theme_variants: BTreeMap<DialogTheme, String>` (SPEC.md §6: "dialog
// theme + variant per theme" — one remembered per theme, not one global
// slot). `postcard` isn't self-describing, so this shape change means old
// bytes can't just be read with the new `JarSettings` — `SettingsV1`/
// `SnapshotV1` below are frozen copies of the pre-v2 shape, kept only so
// `migrate_v1` can decode them and carry the single old variant forward
// into its theme's new map slot.
//
// v3 (2026-09-22): `Critter` gained `life_stage: LifeStage`, pushed as a
// real sim fact (`jar-protocol::LifeStage`) instead of the frontend
// re-deriving it from `age_sec`. `SnapshotV1`/`SnapshotV2` had both been
// embedding the *live* `Critter` type directly rather than a frozen copy —
// harmless as long as `Critter`'s shape never changed, which stopped being
// true the moment this field was added. `CritterV2` below is `Critter`'s
// shape as it stood for both v1 and v2 (it never changed between them);
// `migrate_v2` backfills `life_stage` by recomputing it from each
// critter's own `age_sec`, same as `jar-core::tick::life_stage` does live.

#[derive(Serialize, Deserialize)]
struct SnapshotHeader {
    magic: [u8; 4],
    version: u16,
}

/// The pre-v2 `JarSettings` shape — see the v2 comment above. Not the live
/// `jar_protocol::JarSettings`, which has already moved on.
#[derive(Serialize, Deserialize)]
struct SettingsV1 {
    mode: Species,
    frame: TankFrame,
    dialog_theme: DialogTheme,
    theme_variant: String,
    light_on: bool,
    ambient_particles_on: bool,
    sound_on: bool,
    simulation_speed: u8,
    always_on_top: bool,
}

/// `Critter`'s shape as it stood through v1 and v2 — see the v3 comment
/// above for why this needs to be frozen now, not just `JarSettings`. Not
/// the live `jar_protocol::Critter`, which has already moved on.
#[derive(Serialize, Deserialize)]
struct CritterV2 {
    id: CritterId,
    species: Species,
    name: String,
    hue: u16,
    fin: Option<FinType>,
    spots: bool,
    sex: Sex,
    personality: Personality,
    mood: f32,
    energy: f32,
    age_sec: f32,
    life: f32,
    gen: u32,
    parents: Option<[CritterId; 2]>,
    alive: bool,
    born: f64,
    died: Option<f64>,
    favourite_spot: FavouriteSpot,
}

#[derive(Serialize, Deserialize)]
struct SnapshotV1 {
    critters: Vec<CritterV2>,
    sim_seconds: f64,
    speed: u8,
    settings: SettingsV1,
}

#[derive(Serialize, Deserialize)]
struct SnapshotV2 {
    critters: Vec<CritterV2>,
    sim_seconds: f64,
    speed: u8,
    settings: JarSettings,
}

#[derive(Serialize, Deserialize)]
struct SnapshotV3 {
    critters: Vec<Critter>,
    sim_seconds: f64,
    speed: u8,
    settings: JarSettings,
}

#[derive(Debug, Error)]
pub enum SnapshotError {
    #[error("not a jar snapshot file (bad magic bytes)")]
    BadMagic,
    #[error("snapshot version {0} is newer than this build supports ({CURRENT_VERSION})")]
    UnsupportedVersion(u16),
    #[error("failed to encode snapshot: {0}")]
    Encode(postcard::Error),
    #[error("failed to decode snapshot: {0}")]
    Decode(postcard::Error),
}

pub fn encode(state: &JarState) -> Result<Vec<u8>, SnapshotError> {
    let header = SnapshotHeader {
        magic: MAGIC,
        version: CURRENT_VERSION,
    };
    let body = SnapshotV3 {
        critters: state.critters.clone(),
        sim_seconds: state.clock.sim_seconds,
        speed: state.clock.speed,
        settings: state.settings.clone(),
    };

    let mut bytes = postcard::to_allocvec(&header).map_err(SnapshotError::Encode)?;
    bytes.extend(postcard::to_allocvec(&body).map_err(SnapshotError::Encode)?);
    Ok(bytes)
}

/// Carries a v1 snapshot's single remembered variant into its theme's slot
/// in the new per-theme map, backfilling every other theme with
/// `JarSettings::default()`'s documented defaults (SPEC.md §4) — those
/// themes were never visited under v1, so there's no real prior pick to
/// preserve for them.
fn migrate_v1(v1: SnapshotV1) -> SnapshotV2 {
    let mut theme_variants = default_theme_variants();
    // v1 had one global variant slot, not one per theme — the pre-variants-
    // map Setup UI could only ever echo that single slot's current value
    // back on a plain theme switch, so it's often a stale name that never
    // actually belonged to `dialog_theme` (e.g. "Lagoon" left over from
    // Modern while `dialog_theme` reads NeonTerminal). Only trust it when
    // it's actually one of `dialog_theme`'s own named variants; otherwise
    // the seeded default above stands.
    if known_theme_variant_names(v1.settings.dialog_theme)
        .contains(&v1.settings.theme_variant.as_str())
    {
        theme_variants.insert(v1.settings.dialog_theme, v1.settings.theme_variant);
    }

    SnapshotV2 {
        critters: v1.critters,
        sim_seconds: v1.sim_seconds,
        speed: v1.speed,
        settings: JarSettings {
            mode: v1.settings.mode,
            frame: v1.settings.frame,
            dialog_theme: v1.settings.dialog_theme,
            theme_variants,
            light_on: v1.settings.light_on,
            ambient_particles_on: v1.settings.ambient_particles_on,
            sound_on: v1.settings.sound_on,
            simulation_speed: v1.settings.simulation_speed,
            always_on_top: v1.settings.always_on_top,
        },
    }
}

/// Backfills `life_stage` on every critter by recomputing it from its own
/// `age_sec` — the same rule `jar-core::tick::life_stage` applies live, so
/// a critter migrated on load reads identically to one that had been
/// ticking the whole time.
fn migrate_v2(v2: SnapshotV2) -> SnapshotV3 {
    SnapshotV3 {
        critters: v2
            .critters
            .into_iter()
            .map(|c| Critter {
                id: c.id,
                species: c.species,
                name: c.name,
                hue: c.hue,
                fin: c.fin,
                spots: c.spots,
                sex: c.sex,
                personality: c.personality,
                mood: c.mood,
                energy: c.energy,
                age_sec: c.age_sec,
                life_stage: crate::tick::life_stage(c.age_sec),
                life: c.life,
                gen: c.gen,
                parents: c.parents,
                alive: c.alive,
                born: c.born,
                died: c.died,
                favourite_spot: c.favourite_spot,
            })
            .collect(),
        sim_seconds: v2.sim_seconds,
        speed: v2.speed,
        settings: v2.settings,
    }
}

pub fn decode(bytes: &[u8]) -> Result<JarState, SnapshotError> {
    let (header, rest): (SnapshotHeader, &[u8]) =
        postcard::take_from_bytes(bytes).map_err(SnapshotError::Decode)?;
    if header.magic != MAGIC {
        return Err(SnapshotError::BadMagic);
    }

    let body: SnapshotV3 = match header.version {
        1 => {
            let v1: SnapshotV1 = postcard::from_bytes(rest).map_err(SnapshotError::Decode)?;
            migrate_v2(migrate_v1(v1))
        }
        2 => {
            let v2: SnapshotV2 = postcard::from_bytes(rest).map_err(SnapshotError::Decode)?;
            migrate_v2(v2)
        }
        3 => postcard::from_bytes(rest).map_err(SnapshotError::Decode)?,
        other => return Err(SnapshotError::UnsupportedVersion(other)),
    };

    let mut state = JarState::new(body.settings);
    state.critters = body.critters;
    state.clock = JarClock::resume(body.sim_seconds, body.speed);
    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_rejects_bytes_with_the_wrong_magic() {
        let mut bytes = encode(&JarState::new(JarSettings::default())).unwrap();
        bytes[0] = b'X'; // corrupt the first magic byte
        assert!(matches!(decode(&bytes), Err(SnapshotError::BadMagic)));
    }

    #[test]
    fn decode_rejects_a_version_newer_than_this_build_supports() {
        // Constructed directly against the private header type rather than
        // by poking raw bytes, since postcard varint-encodes `version` —
        // its byte width isn't fixed, so hand-corrupting offsets would be
        // fragile. `decode` checks the version before it ever looks at the
        // body, so no body bytes are needed here.
        let header = SnapshotHeader {
            magic: MAGIC,
            version: CURRENT_VERSION + 1,
        };
        let bytes = postcard::to_allocvec(&header).unwrap();

        let err = decode(&bytes).err().expect("expected decode to fail");
        match err {
            SnapshotError::UnsupportedVersion(v) => assert_eq!(v, CURRENT_VERSION + 1),
            other => panic!("expected UnsupportedVersion, got {other:?}"),
        }
    }

    #[test]
    fn settings_survive_a_round_trip() {
        let settings = JarSettings {
            light_on: false,
            simulation_speed: 42,
            ..JarSettings::default()
        };
        let state = JarState::new(settings);

        let bytes = encode(&state).unwrap();
        let restored = decode(&bytes).unwrap();

        assert!(!restored.settings.light_on);
        assert_eq!(restored.settings.simulation_speed, 42);
    }

    #[test]
    fn decode_migrates_a_v1_snapshot_into_the_per_theme_variants_map() {
        let v1 = SnapshotV1 {
            critters: Vec::new(),
            sim_seconds: 12.0,
            speed: 3,
            settings: SettingsV1 {
                mode: Species::Fish,
                frame: TankFrame::WoodStand,
                dialog_theme: DialogTheme::NeonTerminal,
                theme_variant: "Cyan".to_string(),
                light_on: false,
                ambient_particles_on: true,
                sound_on: true,
                simulation_speed: 5,
                always_on_top: true,
            },
        };
        let header = SnapshotHeader {
            magic: MAGIC,
            version: 1,
        };
        let mut bytes = postcard::to_allocvec(&header).unwrap();
        bytes.extend(postcard::to_allocvec(&v1).unwrap());

        let restored = decode(&bytes).unwrap();

        // The one variant v1 actually had a pick for carries forward...
        assert_eq!(
            restored
                .settings
                .theme_variants
                .get(&DialogTheme::NeonTerminal),
            Some(&"Cyan".to_string())
        );
        // ...every other theme is backfilled with its documented default,
        // not left missing.
        assert_eq!(restored.settings.theme_variants.len(), 6);
        assert_eq!(
            restored.settings.theme_variants.get(&DialogTheme::Modern),
            Some(&"Lagoon".to_string())
        );
        // The rest of v1's settings and the clock/critters carry over too.
        assert_eq!(restored.settings.dialog_theme, DialogTheme::NeonTerminal);
        assert_eq!(restored.settings.frame, TankFrame::WoodStand);
        assert!(restored.settings.always_on_top);
        assert_eq!(restored.clock.sim_seconds, 12.0);
        assert_eq!(restored.clock.speed, 3);
    }

    #[test]
    fn decode_discards_a_v1_variant_that_never_belonged_to_its_theme() {
        // v1's single global variant slot could only ever echo back its
        // current value on a plain theme switch (there was no per-theme
        // chip UI yet) — so a real v1 snapshot commonly has a `dialog_theme`
        // of, say, NeonTerminal paired with a `theme_variant` of "Lagoon",
        // left over from whenever Modern's default was last active. That
        // combination should be treated as stale, not carried forward.
        let v1 = SnapshotV1 {
            critters: Vec::new(),
            sim_seconds: 0.0,
            speed: 1,
            settings: SettingsV1 {
                mode: Species::Fish,
                frame: TankFrame::Bevelled98,
                dialog_theme: DialogTheme::NeonTerminal,
                theme_variant: "Lagoon".to_string(), // not one of NeonTerminal's variants
                light_on: true,
                ambient_particles_on: true,
                sound_on: false,
                simulation_speed: 1,
                always_on_top: false,
            },
        };
        let header = SnapshotHeader {
            magic: MAGIC,
            version: 1,
        };
        let mut bytes = postcard::to_allocvec(&header).unwrap();
        bytes.extend(postcard::to_allocvec(&v1).unwrap());

        let restored = decode(&bytes).unwrap();

        // The stale "Lagoon" is discarded; NeonTerminal keeps its own
        // documented default instead of an invalid value.
        assert_eq!(
            restored
                .settings
                .theme_variants
                .get(&DialogTheme::NeonTerminal),
            Some(&"Magenta".to_string())
        );
    }

    #[test]
    fn decode_migrates_a_v2_snapshot_by_backfilling_life_stage() {
        // A v2 snapshot's critters have no `life_stage` field at all (it
        // didn't exist yet) — migration has to recompute it from `age_sec`,
        // not just default it to something arbitrary.
        let adult = CritterV2 {
            id: CritterId(1),
            species: Species::Fish,
            name: "Pickle".to_string(),
            hue: 200,
            fin: Some(FinType::Veil),
            spots: false,
            sex: Sex::Male,
            personality: Personality::Bold,
            mood: 70.0,
            energy: 80.0,
            age_sec: 700.0, // well past ADULT_AT_DAYS (5 jar-days = 600s)
            life: 3000.0,
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
        };
        let v2 = SnapshotV2 {
            critters: vec![adult],
            sim_seconds: 700.0,
            speed: 1,
            settings: JarSettings::default(),
        };
        let header = SnapshotHeader {
            magic: MAGIC,
            version: 2,
        };
        let mut bytes = postcard::to_allocvec(&header).unwrap();
        bytes.extend(postcard::to_allocvec(&v2).unwrap());

        let restored = decode(&bytes).unwrap();

        assert_eq!(restored.critters.len(), 1);
        assert_eq!(
            restored.critters[0].life_stage,
            jar_protocol::LifeStage::Adult
        );
        // Everything else carried across untouched.
        assert_eq!(restored.critters[0].name, "Pickle");
        assert_eq!(restored.critters[0].age_sec, 700.0);
    }
}
