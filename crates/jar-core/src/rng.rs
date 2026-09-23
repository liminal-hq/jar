// Thin wrapper over `rand` (SPEC.md/rust-core.md §0's decision: plain
// `rand`, not a deterministic seeded generator). See
// `docs/architecture/rust-core.md` §4.5 for the one real, intentional
// consequence of this choice: a jar reloaded from a snapshot reseeds fresh
// rather than resuming the exact subsequent random sequence it would have
// produced had the app never closed.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};

/// Wraps `StdRng` rather than the more familiar `rand::thread_rng()`
/// (`ThreadRng`) deliberately: `ThreadRng` holds a thread-local `Rc` under
/// the hood and is not `Send`, which conflicts with `JarState`/`JarRng`
/// living inside a `Mutex` that Tauri's `State` extractor shares across
/// command-handling threads and the background tick thread. `StdRng` is a
/// plain, non-thread-local generator from the same `rand` crate — still
/// "plain rand, no custom/deterministic PRNG" per §0's decision, just a
/// `Send`-safe generator selection.
pub struct JarRng {
    inner: StdRng,
}

impl JarRng {
    pub fn new() -> Self {
        Self {
            inner: StdRng::from_entropy(),
        }
    }

    /// Uniform bool with the given probability of `true` (e.g. `0.7` for
    /// SPEC.md §5's "spots inherit with 70% chance").
    pub fn chance(&mut self, probability: f32) -> bool {
        self.inner.gen::<f32>() < probability
    }

    pub fn range_f32(&mut self, lo: f32, hi: f32) -> f32 {
        self.inner.gen_range(lo..hi)
    }

    pub fn range_u16(&mut self, lo: u16, hi: u16) -> u16 {
        self.inner.gen_range(lo..hi)
    }
}

impl Default for JarRng {
    fn default() -> Self {
        Self::new()
    }
}
