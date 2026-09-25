// Thin command handlers: validate, mutate `JarState`, return. No business
// logic lives here — that's `jar-core`'s job (`docs/architecture/rust-core.md`
// §5.5), which is also why every rule in this file can be traced back to a
// specific `jar-core` module rather than being decided on the spot.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use chrono::Timelike;
use jar_protocol::{
    Critter, CritterId, DialogTheme, Habitat, JarSettings, LightColour, SimEvent, Species,
    TankFrame,
};
use serde::Deserialize;
use tauri::ipc::Channel;
use tauri::{command, AppHandle, Runtime, State};

use crate::error::{Error, Result};
use crate::JarPlugin;

/// Starts (or resumes) the jar and registers the event channel the
/// background loop pushes `SimEvent`s to. Idempotent: calling `start` again
/// with a new channel just re-points where events go, which is exactly
/// what's needed when the tank window is recreated without the whole
/// simulation restarting.
#[command]
pub async fn start<R: Runtime>(
    app: AppHandle<R>,
    plugin: State<'_, JarPlugin>,
    settings: JarSettings,
    on_event: Channel<jar_protocol::SimEvent>,
) -> Result<()> {
    let mut inner = plugin.inner.lock().expect("jar plugin mutex poisoned");
    if inner.jar.is_none() {
        inner.jar = Some(crate::load_or_new(&app, settings)?);
    }
    inner.channel = Some(on_event);
    drop(inner);
    plugin
        .running
        .store(true, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

/// Pauses the background tick loop. State is retained in memory — this is
/// not the same as an autosave flush, and does not by itself write
/// anything to disk.
#[command]
pub fn stop(plugin: State<'_, JarPlugin>) -> Result<()> {
    plugin
        .running
        .store(false, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

#[command]
pub fn set_speed(plugin: State<'_, JarPlugin>, speed: u8) -> Result<()> {
    let settings = with_jar(&plugin, |jar| {
        let clamped = speed.clamp(1, 60);
        jar.clock.speed = clamped;
        // `clock.speed` drives the sim; `settings.simulation_speed` is the
        // persisted/reported copy `get_snapshot` and every window's
        // hydration read — both must stay equal, since they're one fact.
        jar.settings.simulation_speed = clamped;
        Ok(jar.settings.clone())
    })?;
    push_event(&plugin, SimEvent::SettingsChanged { settings });
    Ok(())
}

#[command]
pub fn set_habitat(plugin: State<'_, JarPlugin>, habitat: Habitat) -> Result<()> {
    let settings = with_jar(&plugin, |jar| {
        jar.settings.habitat = habitat;
        Ok(jar.settings.clone())
    })?;
    push_event(&plugin, SimEvent::SettingsChanged { settings });
    Ok(())
}

/// Adds an original critter of the given species (SPEC.md §4 W4's
/// `+ Add a critter`). Returns the new critter so the frontend can spawn
/// its Yuka vehicle/RigidBody immediately, the same as it would on a
/// `Born` event.
#[command]
pub fn add_critter(plugin: State<'_, JarPlugin>, species: Species) -> Result<Critter> {
    let critter = with_jar_mut(&plugin, |jar, rng| {
        // `try_breed` (jar-core's tick.rs) already enforces this cap on the
        // breeding path — this is the same cap, checked here too, since an
        // original critter enters the population through this command
        // instead, not through breeding.
        if jar.living_count(species) >= jar_core::state::population_cap(species) {
            return Err(Error::PopulationCapReached);
        }
        let id = jar.next_critter_id();
        let existing_names: Vec<String> = jar.critters.iter().map(|c| c.name.clone()).collect();
        let critter = jar_core::genetics::roll_original(
            id,
            species,
            1,
            jar.clock.sim_seconds,
            rng,
            &existing_names,
        );
        jar.critters.push(critter.clone());
        Ok(critter)
    })?;
    push_event(
        &plugin,
        SimEvent::Added {
            critter: critter.clone(),
        },
    );
    Ok(critter)
}

#[command]
pub fn rename_critter(plugin: State<'_, JarPlugin>, id: CritterId, name: String) -> Result<()> {
    with_jar(&plugin, |jar| {
        let critter = jar
            .critters
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or(Error::UnknownCritter)?;
        critter.name = name.clone();
        Ok(())
    })?;
    push_event(&plugin, SimEvent::Renamed { id, name });
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Toggle {
    Light,
    AmbientParticles,
    Sound,
    AlwaysOnTop,
}

#[command]
pub fn set_toggle(plugin: State<'_, JarPlugin>, toggle: Toggle, on: bool) -> Result<()> {
    let settings = with_jar(&plugin, |jar| {
        match toggle {
            Toggle::Light => jar.settings.light_on = on,
            Toggle::AmbientParticles => jar.settings.ambient_particles_on = on,
            Toggle::Sound => jar.settings.sound_on = on,
            Toggle::AlwaysOnTop => jar.settings.always_on_top = on,
        }
        Ok(jar.settings.clone())
    })?;
    push_event(&plugin, SimEvent::SettingsChanged { settings });
    Ok(())
}

/// Switches the active dialog theme and/or updates that theme's remembered
/// variant (SPEC.md §4 — "one remembered per theme") in one call: the
/// frontend passes the already-remembered variant on a plain theme switch,
/// or the current theme with a newly picked variant on a chip click, so
/// this always just records whatever `variant` it's given against `theme`.
#[command]
pub fn set_theme(plugin: State<'_, JarPlugin>, theme: DialogTheme, variant: String) -> Result<()> {
    let settings = with_jar(&plugin, |jar| {
        jar.settings.dialog_theme = theme;
        jar.settings.theme_variants.insert(theme, variant);
        Ok(jar.settings.clone())
    })?;
    push_event(&plugin, SimEvent::SettingsChanged { settings });
    Ok(())
}

#[command]
pub fn set_frame(plugin: State<'_, JarPlugin>, frame: TankFrame) -> Result<()> {
    let settings = with_jar(&plugin, |jar| {
        jar.settings.frame = frame;
        Ok(jar.settings.clone())
    })?;
    push_event(&plugin, SimEvent::SettingsChanged { settings });
    Ok(())
}

#[command]
pub fn set_light_colour(plugin: State<'_, JarPlugin>, colour: LightColour) -> Result<()> {
    let settings = with_jar(&plugin, |jar| {
        jar.settings.light_colour = colour;
        Ok(jar.settings.clone())
    })?;
    push_event(&plugin, SimEvent::SettingsChanged { settings });
    Ok(())
}

#[command]
pub fn set_light_intensity(plugin: State<'_, JarPlugin>, intensity: u8) -> Result<()> {
    let settings = with_jar(&plugin, |jar| {
        jar.settings.light_intensity = intensity.min(200);
        Ok(jar.settings.clone())
    })?;
    push_event(&plugin, SimEvent::SettingsChanged { settings });
    Ok(())
}

#[command]
pub fn set_bubble_intensity(plugin: State<'_, JarPlugin>, intensity: u8) -> Result<()> {
    let settings = with_jar(&plugin, |jar| {
        jar.settings.bubble_intensity = intensity.min(200);
        Ok(jar.settings.clone())
    })?;
    push_event(&plugin, SimEvent::SettingsChanged { settings });
    Ok(())
}

/// Restores every `JarSettings` field to `JarSettings::default()` — the
/// Setup window's "Restore defaults" button. Factored out as a plain
/// function (below) so it's unit-testable without a `State<JarPlugin>`.
/// Flushes immediately rather than waiting for the periodic autosave: a
/// user who just confirmed a reset shouldn't be able to lose it to a crash
/// in the next `AUTOSAVE_INTERVAL`.
#[command]
pub fn reset_settings<R: Runtime>(app: AppHandle<R>, plugin: State<'_, JarPlugin>) -> Result<()> {
    let settings = with_jar(&plugin, |jar| {
        reset_to_defaults(&mut jar.settings);
        // `clock.speed` and `settings.simulation_speed` must stay equal —
        // see `set_speed`'s own comment on why. `reset_to_defaults` only
        // touches `settings`; without this, a jar running faster than 1x
        // keeps ticking at its old speed while the UI reports "1x".
        jar.clock.speed = jar.settings.simulation_speed;
        Ok(jar.settings.clone())
    })?;
    push_event(&plugin, SimEvent::SettingsChanged { settings });
    crate::flush(&app)?;
    Ok(())
}

fn reset_to_defaults(settings: &mut JarSettings) {
    *settings = JarSettings::default();
}

/// Wipes every critter and the sim clock, and restores settings to their
/// defaults too — the Setup window's "Reset jar" button, a strict superset
/// of `reset_settings`. Reuses `new_jar_seeded_from_now` rather than
/// re-deriving the wall-clock seeding it needs: a reset jar should start
/// "now," exactly like a genuinely new one does, not at jar-midnight.
/// Pushes `SimEvent::Reset` rather than `SettingsChanged` — every open
/// window's critter list changed too, not just its settings.
///
/// Builds the snapshot and sends it over the channel while still holding
/// `inner`'s lock, rather than the `with_jar` + `push_event` two-lock
/// pattern most commands use — release-then-reacquire would leave a gap
/// where the background tick loop, or another command, could observe the
/// freshly-reset jar and push its own event (a `TickUpdate`/`Added`)
/// before this `Reset` reaches the frontend. A plain field mutation
/// (`set_mode` and friends) only risks event *ordering* if that happens;
/// this command *replaces the whole population*, so the same race can
/// silently drop a concurrently-added critter's `Added` event once this
/// snapshot — captured before that addition — overwrites the store.
/// Flushes immediately after, same reasoning as `reset_settings`, but
/// this one matters more: it's permanently destroying every critter.
#[command]
pub fn reset_jar<R: Runtime>(
    app: AppHandle<R>,
    plugin: State<'_, JarPlugin>,
) -> Result<jar_protocol::SnapshotView> {
    let snapshot = {
        let mut inner = plugin.inner.lock().expect("jar plugin mutex poisoned");
        let jar = inner.jar.as_mut().ok_or(Error::NotStarted)?;
        *jar = crate::new_jar_seeded_from_now(JarSettings::default());
        let snapshot = build_snapshot(jar);
        if let Some(channel) = &inner.channel {
            let _ = channel.send(SimEvent::Reset {
                snapshot: snapshot.clone(),
            });
        }
        snapshot
    };
    crate::flush(&app)?;
    Ok(snapshot)
}

/// Shared by every command that reads (or just replaced) the whole jar and
/// needs it as a wire-format `SnapshotView` — `get_snapshot`, `reset_jar`,
/// `load_snapshot`. `is_night` is recomputed from the current wall clock
/// each time rather than cached, matching `JarClock::is_night`'s own
/// contract.
fn build_snapshot(jar: &jar_core::JarState) -> jar_protocol::SnapshotView {
    let local_hour = chrono::Local::now().hour() as u8;
    jar_protocol::SnapshotView {
        critters: jar.critters.clone(),
        settings: jar.settings.clone(),
        sim_seconds: jar.clock.sim_seconds,
        is_night: jar.clock.is_night(local_hour),
    }
}

/// A point-in-time read of the full jar state — used when a UI window
/// (re)opens and needs to hydrate before the next `TickUpdate` arrives,
/// distinct from the periodic on-disk autosave.
#[command]
pub fn get_snapshot(plugin: State<'_, JarPlugin>) -> Result<jar_protocol::SnapshotView> {
    with_jar(&plugin, |jar| Ok(build_snapshot(jar)))
}

/// Explicitly replaces the running jar with the state encoded in `bytes` —
/// used by a "reset jar" / import flow, not by ordinary startup (which goes
/// through `crate::load_or_new` inside `start`). Distinct from the
/// `reset_jar` command above: this one loads an arbitrary saved snapshot
/// (an import), that one always resets to a genuinely empty jar. Both push
/// the same `SimEvent::Reset`, and both build+send it under one held lock
/// for the same reason `reset_jar`'s own doc comment explains.
#[command]
pub fn load_snapshot<R: Runtime>(
    app: AppHandle<R>,
    plugin: State<'_, JarPlugin>,
    bytes: Vec<u8>,
) -> Result<()> {
    let restored = jar_core::snapshot::decode(&bytes)?;
    {
        let mut inner = plugin.inner.lock().expect("jar plugin mutex poisoned");
        inner.jar = Some(restored);
        let jar = inner.jar.as_ref().expect("just set above");
        let snapshot = build_snapshot(jar);
        if let Some(channel) = &inner.channel {
            let _ = channel.send(SimEvent::Reset { snapshot });
        }
    }
    crate::flush(&app)?;
    Ok(())
}

fn with_jar<T>(
    plugin: &State<'_, JarPlugin>,
    f: impl FnOnce(&mut jar_core::JarState) -> Result<T>,
) -> Result<T> {
    let mut inner = plugin.inner.lock().expect("jar plugin mutex poisoned");
    let jar = inner.jar.as_mut().ok_or(Error::NotStarted)?;
    f(jar)
}

fn with_jar_mut<T>(
    plugin: &State<'_, JarPlugin>,
    f: impl FnOnce(&mut jar_core::JarState, &mut jar_core::rng::JarRng) -> Result<T>,
) -> Result<T> {
    let mut inner = plugin.inner.lock().expect("jar plugin mutex poisoned");
    let inner = &mut *inner;
    let jar = inner.jar.as_mut().ok_or(Error::NotStarted)?;
    f(jar, &mut inner.rng)
}

/// Pushes an event to whichever window currently owns the live `Channel`
/// (the tank window — see `jarClient.ts`'s header comment on why only one
/// window ever holds it) so a change made from any window's command call
/// reaches every window via the tank's rebroadcast, not just the caller.
/// A missing channel (jar started but no window has connected yet) is not
/// an error — the event is simply not observable yet.
fn push_event(plugin: &State<'_, JarPlugin>, event: SimEvent) {
    let inner = plugin.inner.lock().expect("jar plugin mutex poisoned");
    if let Some(channel) = &inner.channel {
        let _ = channel.send(event);
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    /// Pins `Toggle`'s wire format against the exact camelCase strings
    /// `apps/jar/src/domain/jarClient.ts`'s `jar.setToggle` sends. The two
    /// have no shared generated source — `Toggle` isn't `#[ts(export)]`ed,
    /// since it's this plugin's own command-argument shape, not a
    /// `jar-protocol` type — so nothing else in the build (`cargo
    /// build`/`clippy`, the frontend's own type-check) can catch a
    /// hand-typed mismatch between the two; only this test can.
    #[test]
    fn toggle_deserializes_from_the_frontends_camelcase_strings() {
        assert!(matches!(
            serde_json::from_str::<Toggle>("\"light\""),
            Ok(Toggle::Light)
        ));
        assert!(matches!(
            serde_json::from_str::<Toggle>("\"ambientParticles\""),
            Ok(Toggle::AmbientParticles)
        ));
        assert!(matches!(
            serde_json::from_str::<Toggle>("\"sound\""),
            Ok(Toggle::Sound)
        ));
        assert!(matches!(
            serde_json::from_str::<Toggle>("\"alwaysOnTop\""),
            Ok(Toggle::AlwaysOnTop)
        ));
    }

    /// Guards against `reset_to_defaults` ever becoming a hand-rolled
    /// per-field reset — a single struct assignment is the whole point
    /// (`JarSettings::default()` stays the one place defaults are listed),
    /// so this exercises every field disagreeing with its default at once.
    #[test]
    fn reset_to_defaults_restores_every_field() {
        let mut settings = JarSettings {
            habitat: Habitat::Terrarium,
            frame: TankFrame::NeonCrt,
            dialog_theme: DialogTheme::NeonTerminal,
            theme_variants: BTreeMap::new(),
            light_on: false,
            light_colour: LightColour::Party,
            light_intensity: 200,
            ambient_particles_on: false,
            bubble_intensity: 0,
            sound_on: true,
            simulation_speed: 60,
            always_on_top: true,
        };
        reset_to_defaults(&mut settings);
        assert_eq!(settings, JarSettings::default());
    }
}
