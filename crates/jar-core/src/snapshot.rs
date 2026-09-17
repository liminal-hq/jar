// Save/load of the full `JarState` via `postcard`, with a versioned header
// so the on-disk format can evolve without breaking old saves outright. See
// `docs/architecture/rust-core.md` §4.6 — City Sim 1000's exact pattern:
// magic bytes + a version number + a comment trail at each version bump
// explaining *why* the layout changed.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use jar_protocol::{Critter, JarSettings};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::clock::JarClock;
use crate::state::JarState;

const MAGIC: [u8; 4] = *b"JAR\0";

/// Bump this and add a dated comment below explaining what changed and why,
/// every time `SnapshotV1` (or its successor) changes shape.
const CURRENT_VERSION: u16 = 1;

// v1 (initial): critters + clock + settings, as specified in
// `docs/architecture/rust-core.md` §3-4. No prior versions to migrate from
// yet.

#[derive(Serialize, Deserialize)]
struct SnapshotHeader {
    magic: [u8; 4],
    version: u16,
}

#[derive(Serialize, Deserialize)]
struct SnapshotV1 {
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
    let body = SnapshotV1 {
        critters: state.critters.clone(),
        sim_seconds: state.clock.sim_seconds,
        speed: state.clock.speed,
        settings: state.settings.clone(),
    };

    let mut bytes = postcard::to_allocvec(&header).map_err(SnapshotError::Encode)?;
    bytes.extend(postcard::to_allocvec(&body).map_err(SnapshotError::Encode)?);
    Ok(bytes)
}

pub fn decode(bytes: &[u8]) -> Result<JarState, SnapshotError> {
    let (header, rest): (SnapshotHeader, &[u8]) =
        postcard::take_from_bytes(bytes).map_err(SnapshotError::Decode)?;
    if header.magic != MAGIC {
        return Err(SnapshotError::BadMagic);
    }
    if header.version != CURRENT_VERSION {
        // No prior versions exist yet to migrate from — once one does, this
        // is where a `match header.version { 0 => migrate_v0(...), ... }`
        // ladder goes, not a hard error.
        return Err(SnapshotError::UnsupportedVersion(header.version));
    }

    let body: SnapshotV1 = postcard::from_bytes(rest).map_err(SnapshotError::Decode)?;

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
}
