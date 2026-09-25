// Save/load of the full `JarState` via `postcard`, with a versioned header
// so the on-disk format can evolve without breaking old saves outright. See
// `docs/architecture/rust-core.md` §4.6 — City Sim 1000's exact pattern:
// magic bytes + a version number + a comment trail at each version bump
// explaining *why* the layout changed.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use std::collections::BTreeMap;

use jar_protocol::{
    default_theme_variants, known_theme_variant_names, Critter, CritterId, DialogTheme,
    FavouriteSpot, FinType, Habitat, JarSettings, LifeStage, LightColour, Personality, Sex,
    Species, TankFrame,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::clock::JarClock;
use crate::state::JarState;

const MAGIC: [u8; 4] = *b"JAR\0";

/// Bump this and add a dated comment below explaining what changed and why,
/// every time the current snapshot body changes shape.
const CURRENT_VERSION: u16 = 8;

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
//
// v4 (2026-09-22): `JarSettings` gained `light_colour: LightColour` (the
// tank's hood light, `docs/architecture/3d-engine.md` §8.1's
// `LedLightStrip`). Same "postcard isn't self-describing" problem as v2 —
// `JarSettings`'s shape didn't actually change between v2 and v3 (only
// `Critter` did), so `SettingsV3` below covers both: the frozen shape as it
// stood through v3, changed here at v4. `migrate_v3` defaults `light_colour`
// to `LightColour::Daylight` for anything saved before this field existed.
//
// v5 (2026-09-22): `JarSettings` gained `light_intensity: u8` (the
// castle's ground uplight fixture, `Castle.tsx`'s `GroundUplight` —
// Setup's own "Castle light" slider). `postcard` is not self-describing, so
// any shape change needs a real version bump the moment an on-disk snapshot
// in the old shape might exist — there is no such thing as a shape that is
// safe to amend in place just because it hasn't shipped yet. `SettingsV4`/
// `SnapshotV4` below are now the frozen pre-v5 shape; `migrate_v4` defaults
// `light_intensity` to `100` (the fixture's own designed default) for
// anything saved before this field existed.
//
// v6 (2026-09-22): `JarSettings` gained `bubble_intensity: u8`
// (`Bubbles.tsx`'s particle count — Setup's own "Bubble intensity"
// slider), a real version bump from the start this time. `SettingsV5`/
// `SnapshotV5` below are now the frozen pre-v6 shape; `migrate_v5`
// defaults `bubble_intensity` to `100` for anything saved before this
// field existed.
//
// v7 (2026-09-26): `JarSettings.mode: Species` became `habitat: Habitat`
// (issue #98) — a tank's habitat and the species living in it stopped being
// the same thing the moment a second aquarium species (the snail) was
// planned, so `mode` could no longer name both at once. `SettingsV6`/
// `SnapshotV6` below are now the frozen pre-v7 shape; `migrate_v6` maps
// `Species::Fish -> Habitat::Aquarium`, `Species::Gecko -> Habitat::Terrarium`
// (exhaustive — `Species::Snail` doesn't exist yet at this version).
//
// v8 (2026-09-26): `Critter` gained `shell: Option<ShellType>` and
// `pattern: Option<Pattern>` (issue #98's snail — a snail always has a
// shell/pattern, fish/gecko keep `None` for now, mirroring `fin`).
// `CritterV7` above is `Critter`'s shape as it stood from v3 through v7
// (unchanged across those versions); `migrate_v7` backfills `shell: None,
// pattern: None` — no pre-v8 critter is a snail, since the species didn't
// exist yet.

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

/// The pre-v4 `JarSettings` shape — see the v4 comment above. `JarSettings`
/// didn't actually change shape between v2 and v3 (only `Critter` did), so
/// this one frozen struct covers both `SnapshotV2` and `SnapshotV3` below.
/// Not the live `jar_protocol::JarSettings`, which has already moved on.
#[derive(Serialize, Deserialize)]
struct SettingsV3 {
    mode: Species,
    frame: TankFrame,
    dialog_theme: DialogTheme,
    theme_variants: BTreeMap<DialogTheme, String>,
    light_on: bool,
    ambient_particles_on: bool,
    sound_on: bool,
    simulation_speed: u8,
    always_on_top: bool,
}

#[derive(Serialize, Deserialize)]
struct SnapshotV2 {
    critters: Vec<CritterV2>,
    sim_seconds: f64,
    speed: u8,
    settings: SettingsV3,
}

/// `Critter`'s shape as it stood from v3 (which introduced `life_stage`)
/// through v7 — see the v8 comment below for why it's frozen now. Not the
/// live `jar_protocol::Critter`, which has already moved on (gained
/// `shell`/`pattern`).
#[derive(Serialize, Deserialize)]
struct CritterV7 {
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
    life_stage: LifeStage,
    life: f32,
    gen: u32,
    parents: Option<[CritterId; 2]>,
    alive: bool,
    born: f64,
    died: Option<f64>,
    favourite_spot: FavouriteSpot,
}

#[derive(Serialize, Deserialize)]
struct SnapshotV3 {
    critters: Vec<CritterV7>,
    sim_seconds: f64,
    speed: u8,
    settings: SettingsV3,
}

/// The pre-v5 `JarSettings` shape — see the v5 comment above. Not the live
/// `jar_protocol::JarSettings`, which has already moved on.
#[derive(Serialize, Deserialize)]
struct SettingsV4 {
    mode: Species,
    frame: TankFrame,
    dialog_theme: DialogTheme,
    theme_variants: BTreeMap<DialogTheme, String>,
    light_on: bool,
    light_colour: LightColour,
    ambient_particles_on: bool,
    sound_on: bool,
    simulation_speed: u8,
    always_on_top: bool,
}

#[derive(Serialize, Deserialize)]
struct SnapshotV4 {
    critters: Vec<CritterV7>,
    sim_seconds: f64,
    speed: u8,
    settings: SettingsV4,
}

/// The pre-v6 `JarSettings` shape — see the v6 comment above. Not the live
/// `jar_protocol::JarSettings`, which has already moved on.
#[derive(Serialize, Deserialize)]
struct SettingsV5 {
    mode: Species,
    frame: TankFrame,
    dialog_theme: DialogTheme,
    theme_variants: BTreeMap<DialogTheme, String>,
    light_on: bool,
    light_colour: LightColour,
    light_intensity: u8,
    ambient_particles_on: bool,
    sound_on: bool,
    simulation_speed: u8,
    always_on_top: bool,
}

#[derive(Serialize, Deserialize)]
struct SnapshotV5 {
    critters: Vec<CritterV7>,
    sim_seconds: f64,
    speed: u8,
    settings: SettingsV5,
}

/// The pre-v7 `JarSettings` shape — see the v7 comment above. Not the live
/// `jar_protocol::JarSettings`, which has already moved on.
#[derive(Serialize, Deserialize)]
struct SettingsV6 {
    mode: Species,
    frame: TankFrame,
    dialog_theme: DialogTheme,
    theme_variants: BTreeMap<DialogTheme, String>,
    light_on: bool,
    light_colour: LightColour,
    light_intensity: u8,
    ambient_particles_on: bool,
    bubble_intensity: u8,
    sound_on: bool,
    simulation_speed: u8,
    always_on_top: bool,
}

#[derive(Serialize, Deserialize)]
struct SnapshotV6 {
    critters: Vec<CritterV7>,
    sim_seconds: f64,
    speed: u8,
    settings: SettingsV6,
}

#[derive(Serialize, Deserialize)]
struct SnapshotV7 {
    critters: Vec<CritterV7>,
    sim_seconds: f64,
    speed: u8,
    settings: JarSettings,
}

#[derive(Serialize, Deserialize)]
struct SnapshotV8 {
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
    let body = SnapshotV8 {
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
        settings: SettingsV3 {
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
            .map(|c| CritterV7 {
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
                life_stage: crate::tick::life_stage(c.species, c.age_sec),
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

/// Defaults `light_colour` to `LightColour::Daylight` — nothing saved
/// before v4 ever chose one, so there's no real prior pick to preserve
/// (unlike `migrate_v1`'s theme-variant carry-forward, where one often
/// existed).
fn migrate_v3(v3: SnapshotV3) -> SnapshotV4 {
    SnapshotV4 {
        critters: v3.critters,
        sim_seconds: v3.sim_seconds,
        speed: v3.speed,
        settings: SettingsV4 {
            mode: v3.settings.mode,
            frame: v3.settings.frame,
            dialog_theme: v3.settings.dialog_theme,
            theme_variants: v3.settings.theme_variants,
            light_on: v3.settings.light_on,
            light_colour: LightColour::Daylight,
            ambient_particles_on: v3.settings.ambient_particles_on,
            sound_on: v3.settings.sound_on,
            simulation_speed: v3.settings.simulation_speed,
            always_on_top: v3.settings.always_on_top,
        },
    }
}

/// Defaults `light_intensity` to `100` (the fixture's own designed
/// default) — nothing saved before v5 ever had this field.
fn migrate_v4(v4: SnapshotV4) -> SnapshotV5 {
    SnapshotV5 {
        critters: v4.critters,
        sim_seconds: v4.sim_seconds,
        speed: v4.speed,
        settings: SettingsV5 {
            mode: v4.settings.mode,
            frame: v4.settings.frame,
            dialog_theme: v4.settings.dialog_theme,
            theme_variants: v4.settings.theme_variants,
            light_on: v4.settings.light_on,
            light_colour: v4.settings.light_colour,
            light_intensity: 100,
            ambient_particles_on: v4.settings.ambient_particles_on,
            sound_on: v4.settings.sound_on,
            simulation_speed: v4.settings.simulation_speed,
            always_on_top: v4.settings.always_on_top,
        },
    }
}

/// Defaults `bubble_intensity` to `100` (the current default bubble
/// count) — nothing saved before v6 ever had this field.
fn migrate_v5(v5: SnapshotV5) -> SnapshotV6 {
    SnapshotV6 {
        critters: v5.critters,
        sim_seconds: v5.sim_seconds,
        speed: v5.speed,
        settings: SettingsV6 {
            mode: v5.settings.mode,
            frame: v5.settings.frame,
            dialog_theme: v5.settings.dialog_theme,
            theme_variants: v5.settings.theme_variants,
            light_on: v5.settings.light_on,
            light_colour: v5.settings.light_colour,
            light_intensity: v5.settings.light_intensity,
            ambient_particles_on: v5.settings.ambient_particles_on,
            bubble_intensity: 100,
            sound_on: v5.settings.sound_on,
            simulation_speed: v5.settings.simulation_speed,
            always_on_top: v5.settings.always_on_top,
        },
    }
}

/// Maps `Species::Fish -> Habitat::Aquarium`, `Species::Gecko ->
/// Habitat::Terrarium` — no real v6 snapshot's `mode` is ever
/// `Species::Snail` (that variant didn't exist yet when v6 was current), but
/// the live `Species` type now has three variants, so the match must still
/// cover it; a snail's own habitat is the aquarium, so it maps there too.
fn migrate_v6(v6: SnapshotV6) -> SnapshotV7 {
    SnapshotV7 {
        critters: v6.critters,
        sim_seconds: v6.sim_seconds,
        speed: v6.speed,
        settings: JarSettings {
            habitat: match v6.settings.mode {
                Species::Fish => Habitat::Aquarium,
                Species::Gecko => Habitat::Terrarium,
                Species::Snail => Habitat::Aquarium,
            },
            frame: v6.settings.frame,
            dialog_theme: v6.settings.dialog_theme,
            theme_variants: v6.settings.theme_variants,
            light_on: v6.settings.light_on,
            light_colour: v6.settings.light_colour,
            light_intensity: v6.settings.light_intensity,
            ambient_particles_on: v6.settings.ambient_particles_on,
            bubble_intensity: v6.settings.bubble_intensity,
            sound_on: v6.settings.sound_on,
            simulation_speed: v6.settings.simulation_speed,
            always_on_top: v6.settings.always_on_top,
        },
    }
}

/// Backfills `shell: None, pattern: None` on every critter — no pre-v8
/// critter is a snail (the species didn't exist yet at this snapshot
/// version), so both are honestly `None` here.
fn migrate_v7(v7: SnapshotV7) -> SnapshotV8 {
    SnapshotV8 {
        critters: v7
            .critters
            .into_iter()
            .map(|c| Critter {
                id: c.id,
                species: c.species,
                name: c.name,
                hue: c.hue,
                fin: c.fin,
                spots: c.spots,
                shell: None,
                pattern: None,
                sex: c.sex,
                personality: c.personality,
                mood: c.mood,
                energy: c.energy,
                age_sec: c.age_sec,
                life_stage: c.life_stage,
                life: c.life,
                gen: c.gen,
                parents: c.parents,
                alive: c.alive,
                born: c.born,
                died: c.died,
                favourite_spot: c.favourite_spot,
            })
            .collect(),
        sim_seconds: v7.sim_seconds,
        speed: v7.speed,
        settings: v7.settings,
    }
}

pub fn decode(bytes: &[u8]) -> Result<JarState, SnapshotError> {
    let (header, rest): (SnapshotHeader, &[u8]) =
        postcard::take_from_bytes(bytes).map_err(SnapshotError::Decode)?;
    if header.magic != MAGIC {
        return Err(SnapshotError::BadMagic);
    }

    let body: SnapshotV8 = match header.version {
        1 => {
            let v1: SnapshotV1 = postcard::from_bytes(rest).map_err(SnapshotError::Decode)?;
            migrate_v7(migrate_v6(migrate_v5(migrate_v4(migrate_v3(migrate_v2(
                migrate_v1(v1),
            ))))))
        }
        2 => {
            let v2: SnapshotV2 = postcard::from_bytes(rest).map_err(SnapshotError::Decode)?;
            migrate_v7(migrate_v6(migrate_v5(migrate_v4(migrate_v3(migrate_v2(
                v2,
            ))))))
        }
        3 => {
            let v3: SnapshotV3 = postcard::from_bytes(rest).map_err(SnapshotError::Decode)?;
            migrate_v7(migrate_v6(migrate_v5(migrate_v4(migrate_v3(v3)))))
        }
        4 => {
            let v4: SnapshotV4 = postcard::from_bytes(rest).map_err(SnapshotError::Decode)?;
            migrate_v7(migrate_v6(migrate_v5(migrate_v4(v4))))
        }
        5 => {
            let v5: SnapshotV5 = postcard::from_bytes(rest).map_err(SnapshotError::Decode)?;
            migrate_v7(migrate_v6(migrate_v5(v5)))
        }
        6 => {
            let v6: SnapshotV6 = postcard::from_bytes(rest).map_err(SnapshotError::Decode)?;
            migrate_v7(migrate_v6(v6))
        }
        7 => {
            let v7: SnapshotV7 = postcard::from_bytes(rest).map_err(SnapshotError::Decode)?;
            migrate_v7(v7)
        }
        8 => postcard::from_bytes(rest).map_err(SnapshotError::Decode)?,
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
            settings: SettingsV3 {
                mode: Species::Fish,
                frame: TankFrame::Bevelled98,
                dialog_theme: DialogTheme::Modern,
                theme_variants: default_theme_variants(),
                light_on: true,
                ambient_particles_on: true,
                sound_on: false,
                simulation_speed: 1,
                always_on_top: false,
            },
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

    #[test]
    fn decode_defaults_light_colour_on_a_v2_snapshot_that_never_had_one() {
        let v2 = SnapshotV2 {
            critters: Vec::new(),
            sim_seconds: 7.0,
            speed: 2,
            settings: SettingsV3 {
                mode: Species::Gecko,
                frame: TankFrame::RoundedGlass,
                dialog_theme: DialogTheme::Modern,
                theme_variants: default_theme_variants(),
                light_on: true,
                ambient_particles_on: false,
                sound_on: true,
                simulation_speed: 10,
                always_on_top: false,
            },
        };
        let header = SnapshotHeader {
            magic: MAGIC,
            version: 2,
        };
        let mut bytes = postcard::to_allocvec(&header).unwrap();
        bytes.extend(postcard::to_allocvec(&v2).unwrap());

        let restored = decode(&bytes).unwrap();

        assert_eq!(restored.settings.light_colour, LightColour::Daylight);
        assert_eq!(restored.settings.light_intensity, 100);
        // The rest of v2's settings and the clock carry over too.
        assert_eq!(restored.settings.habitat, Habitat::Terrarium);
        assert_eq!(restored.settings.frame, TankFrame::RoundedGlass);
        assert_eq!(restored.settings.simulation_speed, 10);
        assert_eq!(restored.clock.sim_seconds, 7.0);
        assert_eq!(restored.clock.speed, 2);
    }

    #[test]
    fn decode_defaults_light_intensity_on_a_v4_snapshot_that_never_had_one() {
        let v4 = SnapshotV4 {
            critters: Vec::new(),
            sim_seconds: 3.0,
            speed: 4,
            settings: SettingsV4 {
                mode: Species::Fish,
                frame: TankFrame::NeonCrt,
                dialog_theme: DialogTheme::HandheldLcd,
                theme_variants: default_theme_variants(),
                light_on: true,
                light_colour: LightColour::Reef, // a real prior pick, not the default
                ambient_particles_on: true,
                sound_on: false,
                simulation_speed: 20,
                always_on_top: false,
            },
        };
        let header = SnapshotHeader {
            magic: MAGIC,
            version: 4,
        };
        let mut bytes = postcard::to_allocvec(&header).unwrap();
        bytes.extend(postcard::to_allocvec(&v4).unwrap());

        let restored = decode(&bytes).unwrap();

        assert_eq!(restored.settings.light_intensity, 100);
        // v4's own real light_colour pick survives, not just the new field's default.
        assert_eq!(restored.settings.light_colour, LightColour::Reef);
        assert_eq!(restored.settings.frame, TankFrame::NeonCrt);
        assert_eq!(restored.settings.simulation_speed, 20);
        assert_eq!(restored.clock.sim_seconds, 3.0);
        assert_eq!(restored.clock.speed, 4);
    }

    #[test]
    fn decode_defaults_bubble_intensity_on_a_v5_snapshot_that_never_had_one() {
        let v5 = SnapshotV5 {
            critters: Vec::new(),
            sim_seconds: 8.0,
            speed: 6,
            settings: SettingsV5 {
                mode: Species::Fish,
                frame: TankFrame::WoodStand,
                dialog_theme: DialogTheme::PaperNotebook,
                theme_variants: default_theme_variants(),
                light_on: false,
                light_colour: LightColour::Party,
                light_intensity: 150, // a real prior pick, not the default
                ambient_particles_on: true,
                sound_on: true,
                simulation_speed: 30,
                always_on_top: true,
            },
        };
        let header = SnapshotHeader {
            magic: MAGIC,
            version: 5,
        };
        let mut bytes = postcard::to_allocvec(&header).unwrap();
        bytes.extend(postcard::to_allocvec(&v5).unwrap());

        let restored = decode(&bytes).unwrap();

        assert_eq!(restored.settings.bubble_intensity, 100);
        // v5's own real picks survive, not just the new field's default.
        assert_eq!(restored.settings.light_intensity, 150);
        assert_eq!(restored.settings.light_colour, LightColour::Party);
        assert_eq!(restored.settings.frame, TankFrame::WoodStand);
        assert_eq!(restored.settings.simulation_speed, 30);
        assert_eq!(restored.clock.sim_seconds, 8.0);
        assert_eq!(restored.clock.speed, 6);
    }

    #[test]
    fn decode_migrates_a_v7_snapshot_backfilling_shell_and_pattern() {
        // A v7 critter has no `shell`/`pattern` fields at all (the snail
        // species — the only one that ever has them — didn't exist yet) —
        // migration must honestly backfill both as `None`, not guess a gene.
        let fish = CritterV7 {
            id: CritterId(1),
            species: Species::Fish,
            name: "Pickle".to_string(),
            hue: 200,
            fin: Some(FinType::Veil),
            spots: true,
            sex: Sex::Male,
            personality: Personality::Bold,
            mood: 70.0,
            energy: 80.0,
            age_sec: 700.0,
            life_stage: jar_protocol::LifeStage::Adult,
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
        let v7 = SnapshotV7 {
            critters: vec![fish],
            sim_seconds: 700.0,
            speed: 1,
            settings: JarSettings::default(),
        };
        let header = SnapshotHeader {
            magic: MAGIC,
            version: 7,
        };
        let mut bytes = postcard::to_allocvec(&header).unwrap();
        bytes.extend(postcard::to_allocvec(&v7).unwrap());

        let restored = decode(&bytes).unwrap();

        assert_eq!(restored.critters.len(), 1);
        assert_eq!(restored.critters[0].shell, None);
        assert_eq!(restored.critters[0].pattern, None);
        // Everything else carried across untouched.
        assert_eq!(restored.critters[0].name, "Pickle");
        assert!(restored.critters[0].spots);
        assert_eq!(
            restored.critters[0].life_stage,
            jar_protocol::LifeStage::Adult
        );
    }
}
