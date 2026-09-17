// Events pushed from `tauri-plugin-jar` to the frontend over a
// `Channel<SimEvent>` (`docs/architecture/rust-core.md` §5.2). `Born` and
// `Passed` are pushed the instant they occur; `TickUpdate` batches on the
// regular cadence (`docs/architecture/rust-core.md` §4.7).
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{Critter, CritterId, CritterStats};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type")]
pub enum SimEvent {
    Born {
        child: Critter,
        parent_a: CritterId,
        parent_b: CritterId,
    },
    Passed {
        id: CritterId,
    },
    TickUpdate {
        critters: Vec<CritterStats>,
    },
}
