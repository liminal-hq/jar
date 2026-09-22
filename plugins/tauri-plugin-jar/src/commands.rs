// Thin command handlers: validate, mutate `JarState`, return. No business
// logic lives here — that's `jar-core`'s job (`docs/architecture/rust-core.md`
// §5.5), which is also why every rule in this file can be traced back to a
// specific `jar-core` module rather than being decided on the spot.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use chrono::Timelike;
use jar_protocol::{
    Critter, CritterId, DialogTheme, JarSettings, LightColour, SimEvent, Species, TankFrame,
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
pub fn set_mode(plugin: State<'_, JarPlugin>, mode: Species) -> Result<()> {
    let settings = with_jar(&plugin, |jar| {
        jar.settings.mode = mode;
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

/// A point-in-time read of the full jar state — used when a UI window
/// (re)opens and needs to hydrate before the next `TickUpdate` arrives,
/// distinct from the periodic on-disk autosave. `SnapshotView` itself lives
/// in `jar-protocol` (not defined here) so `ts-rs` generates a real type
/// for it — see `crates/jar-protocol/src/view.rs`.
#[command]
pub fn get_snapshot(plugin: State<'_, JarPlugin>) -> Result<jar_protocol::SnapshotView> {
    with_jar(&plugin, |jar| {
        let local_hour = chrono::Local::now().hour() as u8;
        Ok(jar_protocol::SnapshotView {
            critters: jar.critters.clone(),
            settings: jar.settings.clone(),
            sim_seconds: jar.clock.sim_seconds,
            is_night: jar.clock.is_night(local_hour),
        })
    })
}

/// Explicitly replaces the running jar with the state encoded in `bytes` —
/// used by a "reset jar" / import flow, not by ordinary startup (which goes
/// through `crate::load_or_new` inside `start`).
#[command]
pub fn load_snapshot(plugin: State<'_, JarPlugin>, bytes: Vec<u8>) -> Result<()> {
    let restored = jar_core::snapshot::decode(&bytes)?;
    let mut inner = plugin.inner.lock().expect("jar plugin mutex poisoned");
    inner.jar = Some(restored);
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
}
