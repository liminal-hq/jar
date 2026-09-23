// Plugin-level error type. Every command in `commands.rs` returns
// `Result<T>` so a failure surfaces to the webview's `invoke()` rejection
// instead of panicking the background loop.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use serde::{Serialize, Serializer};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("the jar simulation has not been started yet (call `start` first)")]
    NotStarted,
    #[error("no critter with that id exists")]
    UnknownCritter,
    #[error(transparent)]
    Snapshot(#[from] jar_core::snapshot::SnapshotError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

// Tauri commands serialize their `Err` variant back to the webview as JSON;
// a plain `Display`-derived string is all the frontend needs to show a
// toast, so we don't expose internal error structure across the boundary.
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
