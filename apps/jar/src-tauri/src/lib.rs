// Tauri shell: wires up `tauri-plugin-jar` (the simulation core adapter)
// and the official `tauri-plugin-window-state` (window geometry — see
// `docs/architecture/rust-core.md` §5.4 for why that's not `jar-core`'s
// job). The `tank` window is declared in `tauri.conf.json`; the critter
// card, family tree and setup windows (SPEC.md §2: "separate WebviewWindows
// positioned beside the tank") are created on demand from the frontend via
// `@tauri-apps/api/webviewWindow`, not declared statically here, since they
// only exist while the user has them open.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

/// Windows excluded from `tauri-plugin-window-state` below. `SPEC.md` §6
/// requires window positions/sizes to persist, and that covers every
/// window in the documented screen inventory (`SCREENS.md`'s W1-W4) —
/// `critter-card`, `family-tree` and `setup` are on-demand
/// (`domain/windows.ts`'s `SPECS`) but still user-facing, tracked windows.
/// `dev-settings`/`fish-monitor` are supplementary tooling rather than core
/// product screens, but they're real, always-available windows now too
/// (`Drawer.tsx`), not a debug-only build feature, so they persist their
/// geometry the same as everything else — nothing left to exclude here.
const EPHEMERAL_WINDOW_LABELS: &[&str] = &[];

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(EPHEMERAL_WINDOW_LABELS)
                // Every window's decoration setting is fixed in its own
                // creation code (`tauri.conf.json` for `tank`,
                // `decorations: false` in `domain/windows.ts` for the
                // satellite windows) and never toggled by the user, so
                // tracking it here only risks a transient bad save (e.g. a
                // momentary decorated=true reported before a window's own
                // setting takes effect) permanently overriding the intended
                // value on every future launch, for that window only.
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        .difference(tauri_plugin_window_state::StateFlags::DECORATIONS),
                )
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
