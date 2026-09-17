//! Native Tauri v2 adapter for `jar-core`. Runs the simulation tick on a
//! background thread independent of the webview (so it is not subject to
//! any webview visibility throttling — see `docs/architecture/rust-core.md`
//! §5.1), pushes events to the frontend over a `Channel<SimEvent>`
//! (§5.2), and autosaves periodically plus unconditionally on shutdown
//! (§5.3). Window geometry persistence is deliberately *not* handled
//! here — see §5.4; use the official `tauri-plugin-window-state` alongside
//! this plugin.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

mod commands;
mod error;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use jar_core::rng::JarRng;
use jar_core::JarState;
use jar_protocol::{JarSettings, SimEvent};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime};

pub use error::{Error, Result};

/// How often the background loop wakes to advance the sim clock. Sim
/// speed/timing itself comes entirely from `JarClock`'s accumulator
/// (`crates/jar-core/src/clock.rs`) — this interval only bounds how
/// granular real time is sampled, and has no bearing on jar-day length.
const LOOP_INTERVAL: Duration = Duration::from_millis(250);

/// Periodic autosave cadence per `docs/architecture/rust-core.md` §5.3 —
/// deliberately not on every tick, to avoid constant small disk writes for
/// the app's entire runtime.
const AUTOSAVE_INTERVAL: Duration = Duration::from_secs(45);

const SNAPSHOT_FILE_NAME: &str = "jar.snapshot";

pub(crate) struct Inner {
    pub jar: Option<JarState>,
    pub rng: JarRng,
    pub channel: Option<Channel<SimEvent>>,
}

pub struct JarPlugin {
    pub(crate) inner: Mutex<Inner>,
    pub(crate) running: AtomicBool,
}

impl JarPlugin {
    fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                jar: None,
                rng: JarRng::new(),
                channel: None,
            }),
            running: AtomicBool::new(false),
        }
    }
}

fn snapshot_path<R: Runtime>(app: &AppHandle<R>) -> std::result::Result<std::path::PathBuf, Error> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| Error::Io(std::io::Error::other(e)))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join(SNAPSHOT_FILE_NAME))
}

fn flush<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let state = app.state::<JarPlugin>();
    let inner = state.inner.lock().expect("jar plugin mutex poisoned");
    if let Some(jar) = &inner.jar {
        let bytes = jar_core::snapshot::encode(jar)?;
        std::fs::write(snapshot_path(app)?, bytes)?;
    }
    Ok(())
}

fn spawn_background_loop<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || {
        let mut last_wake = Instant::now();
        let mut since_last_autosave = Duration::ZERO;

        loop {
            std::thread::sleep(LOOP_INTERVAL);
            let now = Instant::now();
            let elapsed = now.duration_since(last_wake);
            last_wake = now;
            since_last_autosave += elapsed;

            let plugin = app.state::<JarPlugin>();
            if !plugin.running.load(Ordering::Relaxed) {
                continue;
            }

            let mut guard = plugin.inner.lock().expect("jar plugin mutex poisoned");
            // Split into independent field borrows up front — borrowing
            // `guard.jar` via a method call (`.as_mut()`) ties up the whole
            // guard for the borrow's lifetime, which then conflicts with
            // touching `guard.rng`/`guard.channel` below. Destructuring
            // once avoids that.
            let Inner { jar, rng, channel } = &mut *guard;
            let Some(jar) = jar.as_mut() else {
                continue;
            };

            let ticks = jar.clock.accumulate(elapsed.as_secs_f64());
            for _ in 0..ticks {
                let outcome = jar_core::tick::tick(jar, rng);
                let events = jar_core::events::events_for_tick(jar, &outcome);
                if let Some(channel) = channel {
                    for event in events {
                        // A send failure just means the frontend isn't
                        // listening right now (e.g. window recreated) —
                        // sim state itself is unaffected, so this is
                        // intentionally not propagated as an error.
                        let _ = channel.send(event);
                    }
                }
            }
            drop(guard);

            if since_last_autosave >= AUTOSAVE_INTERVAL {
                since_last_autosave = Duration::ZERO;
                if let Err(e) = flush(&app) {
                    eprintln!("jar: periodic autosave failed: {e}");
                }
            }
        }
    });
}

pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("jar")
        .invoke_handler(tauri::generate_handler![
            commands::start,
            commands::stop,
            commands::set_speed,
            commands::set_mode,
            commands::add_critter,
            commands::rename_critter,
            commands::set_toggle,
            commands::set_theme,
            commands::set_frame,
            commands::get_snapshot,
            commands::load_snapshot,
        ])
        .setup(|app, _api| {
            app.manage(JarPlugin::new());
            spawn_background_loop(app.clone());
            Ok(())
        })
        .on_event(|app, event| {
            // Unconditional flush-on-shutdown per
            // `docs/architecture/rust-core.md` §5.3 — the periodic
            // autosave alone can't guarantee the very latest state
            // survives a clean exit.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Err(e) = flush(app) {
                    eprintln!("jar: shutdown flush failed: {e}");
                }
            }
        })
        .build()
}

/// Loads a previously autosaved jar, if one exists, otherwise starts fresh
/// with `settings`. Called from `commands::start`.
pub(crate) fn load_or_new<R: Runtime>(
    app: &AppHandle<R>,
    settings: JarSettings,
) -> Result<JarState> {
    let path = snapshot_path(app)?;
    match std::fs::read(&path) {
        Ok(bytes) => Ok(jar_core::snapshot::decode(&bytes)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(JarState::new(settings)),
        Err(e) => Err(Error::Io(e)),
    }
}
