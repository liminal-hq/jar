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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_jar::init())
        .run(tauri::generate_context!())
        .expect("error while running the Jar application");
}
