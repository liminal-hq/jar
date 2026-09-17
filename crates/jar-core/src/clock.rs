// Jar-day tracking, day/night determination, and the fixed-timestep
// accumulator that steps the sim at 1 Hz regardless of how often `step()` is
// called. See `docs/architecture/rust-core.md` §4.3 for the "spiral of
// death" guard this implements, borrowed from City Sim 1000's `sim.rs`.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

/// One jar-day = 120 sim-seconds (SPEC.md §5).
pub const SECONDS_PER_JAR_DAY: f64 = 120.0;

/// Night is 21:00-07:00 jar time (SPEC.md §5), expressed as a fraction of a
/// jar-day: night covers [0.875, 1.0) and [0.0, 0.2917) of the 24 jar-hour
/// cycle.
const NIGHT_START_FRACTION: f64 = 21.0 / 24.0;
const NIGHT_END_FRACTION: f64 = 7.0 / 24.0;

/// A single `step()` call applies at most this many 1-second ticks before
/// giving up and carrying the remainder to the next call. Without this cap,
/// a frame hiccup at the 60x speed-slider ceiling could try to fire dozens
/// of ticks in one burst and starve the renderer — the same failure mode
/// City Sim 1000's `sim.rs` guards against, restated here because Jar's
/// slider goes to the same kind of extreme (SPEC.md §5).
const MAX_TICKS_PER_STEP: u32 = 120;

pub struct JarClock {
    /// Total sim-seconds elapsed since this jar's clock started ticking.
    pub sim_seconds: f64,
    /// 1-60, from `JarSettings::simulation_speed`. Multiplies sim-seconds
    /// per real second.
    pub speed: u8,
    accumulator: f64,
}

impl JarClock {
    pub fn new() -> Self {
        Self {
            sim_seconds: 0.0,
            speed: 1,
            accumulator: 0.0,
        }
    }

    /// Rebuilds a clock resuming from persisted state (`snapshot.rs`). The
    /// accumulator itself is never persisted — only whole elapsed
    /// sim-seconds are, so a reloaded jar starts with an empty accumulator,
    /// which is unobservable (it never holds more than one partial tick).
    pub fn resume(sim_seconds: f64, speed: u8) -> Self {
        Self {
            sim_seconds,
            speed,
            accumulator: 0.0,
        }
    }

    /// Advances the accumulator by `real_dt_secs` of wall-clock time and
    /// returns how many whole 1-second sim ticks should now run, capped at
    /// `MAX_TICKS_PER_STEP`. Call `tick()` (in `tick.rs`) that many times,
    /// then discard the return value — the accumulator already carries any
    /// remainder forward.
    pub fn accumulate(&mut self, real_dt_secs: f64) -> u32 {
        self.accumulator += real_dt_secs * self.speed as f64;
        let whole_ticks = self.accumulator.floor();
        let ticks = whole_ticks.min(MAX_TICKS_PER_STEP as f64) as u32;
        self.accumulator -= ticks as f64;
        ticks
    }

    pub fn advance_one_tick(&mut self) {
        self.sim_seconds += 1.0;
    }

    pub fn jar_day_fraction(&self) -> f64 {
        (self.sim_seconds / SECONDS_PER_JAR_DAY).fract()
    }

    /// True if the jar clock currently reads as night (SPEC.md §5:
    /// "Night = 21:00-07:00"). At real time (1x) the frontend may instead
    /// derive day/night from the system clock per SPEC.md §5 — that
    /// substitution is a presentation-layer decision, not this function's
    /// concern; this always answers in terms of the jar's own clock.
    pub fn is_night(&self) -> bool {
        let f = self.jar_day_fraction();
        !(NIGHT_END_FRACTION..NIGHT_START_FRACTION).contains(&f)
    }
}

impl Default for JarClock {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accumulate_returns_whole_ticks_and_carries_the_remainder() {
        let mut clock = JarClock::new();
        clock.speed = 1;
        assert_eq!(clock.accumulate(1.0), 1);
        assert_eq!(clock.accumulate(0.5), 0); // half a second isn't a whole tick yet
        assert_eq!(clock.accumulate(0.5), 1); // the other half completes it
    }

    #[test]
    fn accumulate_caps_at_max_ticks_per_step_and_carries_the_rest() {
        let mut clock = JarClock::new();
        clock.speed = 60;
        // 10 real seconds at 60x = 600 sim-seconds, capped at 120 per step
        // — 600 / 120 = exactly 5 capped steps, then the accumulator is
        // empty and a further step yields nothing.
        assert_eq!(clock.accumulate(10.0), 120);
        assert_eq!(clock.accumulate(0.0), 120);
        assert_eq!(clock.accumulate(0.0), 120);
        assert_eq!(clock.accumulate(0.0), 120);
        assert_eq!(clock.accumulate(0.0), 120);
        assert_eq!(clock.accumulate(0.0), 0); // accumulator now empty
    }

    #[test]
    fn resume_preserves_sim_seconds_and_speed_with_an_empty_accumulator() {
        let clock = JarClock::resume(1234.0, 30);
        assert_eq!(clock.sim_seconds, 1234.0);
        assert_eq!(clock.speed, 30);

        let mut clock = clock;
        // An empty accumulator means a zero-length step yields no ticks.
        assert_eq!(clock.accumulate(0.0), 0);
    }

    #[test]
    fn is_night_at_the_day_start_boundary() {
        // 7/24 of a 120s jar-day = 35s exactly. The day window is
        // [7/24, 21/24), so 35s is day and anything just below it is night.
        assert!(!JarClock::resume(35.0, 1).is_night());
        assert!(JarClock::resume(34.0, 1).is_night());
    }

    #[test]
    fn is_night_at_the_night_start_boundary() {
        // 21/24 of a 120s jar-day = 105s exactly. The day window's end is
        // exclusive, so 105s is already night; just below it is still day.
        assert!(JarClock::resume(105.0, 1).is_night());
        assert!(!JarClock::resume(104.0, 1).is_night());
    }

    #[test]
    fn is_night_wraps_across_midnight() {
        // A fraction of exactly 0 (a fresh jar-day boundary) is still within
        // the night window, which spans the wrap.
        assert!(JarClock::resume(0.0, 1).is_night());
        assert!(JarClock::resume(120.0, 1).is_night()); // one full jar-day later
    }
}
