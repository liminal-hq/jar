// Shared types crossing the Rust <-> JS boundary. `ts-rs` generates the
// matching TypeScript interfaces into `apps/jar/src/domain/protocol/generated/`
// from this crate — never hand-maintain a parallel TS copy of these shapes.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

mod critter;
mod events;
mod settings;
mod view;

pub use critter::*;
pub use events::*;
pub use settings::*;
pub use view::*;
