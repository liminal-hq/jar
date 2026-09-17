// Read models returned directly by plugin commands (as opposed to pushed
// as `SimEvent`s). Kept in this crate — not defined ad hoc in
// `plugins/tauri-plugin-jar/src/commands.rs` — so `ts-rs` generates a real
// TS type for them too; a command return type the frontend can't import
// from `generated/` is exactly the kind of hand-sync `ts-rs` exists to
// avoid (see `docs/architecture/rust-core.md` §9).
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{Critter, JarSettings};

/// A point-in-time read of the full jar state — used when a UI window
/// (re)opens and needs to hydrate before the next `TickUpdate` arrives.
/// Distinct from the periodic on-disk autosave snapshot in
/// `jar-core::snapshot`, which is a versioned binary format, not this
/// JSON-over-IPC view.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SnapshotView {
    pub critters: Vec<Critter>,
    pub settings: JarSettings,
    pub sim_seconds: f64,
}
