// Pure Rust simulation core: aging, mood/energy drift, breeding, genetics,
// passing, naming, and the jar clock (SPEC.md §5). No I/O, no `tauri`/
// `wasm-bindgen` dependency — the native adapter in
// `plugins/tauri-plugin-jar` is the only thing that talks to Tauri or the
// filesystem. See `docs/architecture/rust-core.md` for the full spec this
// crate implements.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

pub mod clock;
pub mod events;
pub mod genetics;
pub mod rng;
pub mod snapshot;
pub mod state;
pub mod tick;

#[cfg(test)]
mod tests;

pub use state::JarState;
