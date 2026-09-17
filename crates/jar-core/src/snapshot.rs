// Save/load of the full `JarState` via `postcard`, with a versioned header
// so the on-disk format can evolve without breaking old saves outright. See
// `docs/architecture/rust-core.md` §4.6 — City Sim 1000's exact pattern:
// magic bytes + a version number + a comment trail at each version bump
// explaining *why* the layout changed.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use jar_protocol::{default_theme_variants, Critter, DialogTheme, JarSettings, Species, TankFrame};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::clock::JarClock;
use crate::state::JarState;

const MAGIC: [u8; 4] = *b"JAR\0";

/// Bump this and add a dated comment below explaining what changed and why,
/// every time the current snapshot body changes shape.
const CURRENT_VERSION: u16 = 2;

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

#[derive(Serialize, Deserialize)]
struct SnapshotV1 {
    critters: Vec<Critter>,
    sim_seconds: f64,
    speed: u8,
    settings: SettingsV1,
}

#[derive(Serialize, Deserialize)]
struct SnapshotV2 {
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
    let body = SnapshotV2 {
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
    theme_variants.insert(v1.settings.dialog_theme, v1.settings.theme_variant);

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

pub fn decode(bytes: &[u8]) -> Result<JarState, SnapshotError> {
    let (header, rest): (SnapshotHeader, &[u8]) =
        postcard::take_from_bytes(bytes).map_err(SnapshotError::Decode)?;
    if header.magic != MAGIC {
        return Err(SnapshotError::BadMagic);
    }

    let body: SnapshotV2 = match header.version {
        1 => {
            let v1: SnapshotV1 = postcard::from_bytes(rest).map_err(SnapshotError::Decode)?;
            migrate_v1(v1)
        }
        2 => postcard::from_bytes(rest).map_err(SnapshotError::Decode)?,
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
}
