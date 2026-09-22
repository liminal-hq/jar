// Tauri shell: wires up `tauri-plugin-jar` (the simulation core adapter)
// and the official `tauri-plugin-window-state` (window geometry — see
// `docs/architecture/rust-core.md` §5.4 for why that's not `jar-core`'s
// job). The `tank` window is declared in `tauri.conf.json`; the critter
// card, family tree and setup windows (SPEC.md §2: "separate WebviewWindows
// positioned beside the tank") are created on demand from the frontend via
// `@tauri-apps/api/webviewWindow`, not declared statically here, since they
// only exist while the user has them open.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

/// Windows excluded from `tauri-plugin-window-state` below. `SPEC.md` §6
/// requires window positions/sizes to persist, and that covers every
/// window in the documented screen inventory (`SCREENS.md`'s W1-W4) —
/// `critter-card`, `family-tree` and `setup` are on-demand
/// (`domain/windows.ts`'s `SPECS`) but still user-facing, tracked windows,
/// so only `dev-settings` (a debug-only tool, explicitly "not part of
/// `SPEC.md`/`SCREENS.md`" per its own `SPECS` entry) is denylisted here —
/// it's meant to spawn fresh every time rather than remember where a dev
/// last left it.
const EPHEMERAL_WINDOW_LABELS: &[&str] = &["dev-settings"];

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(EPHEMERAL_WINDOW_LABELS)
                .build(),
        )
        .plugin(tauri_plugin_jar::init());

    // Debug-only automation bridge for driving/screenshotting the running
    // app during development — never compiled into a release build's
    // active plugin set (see `Cargo.toml`'s dependency comment for why the
    // crate itself is still a normal, not dev, dependency).
    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running the Jar application");
}
