// Persisted jar settings, per SPEC.md §6 minus window geometry (owned by
// `tauri-plugin-window-state` instead — see `docs/architecture/rust-core.md`
// §5.4).
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::Species;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum TankFrame {
    Bevelled98,
    WoodStand,
    BrushedMetal,
    RoundedGlass,
    NeonCrt,
    CardboardCutout,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum DialogTheme {
    Modern,
    ModernDark,
    Classic98,
    PaperNotebook,
    HandheldLcd,
    NeonTerminal,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct JarSettings {
    pub mode: Species, // Fish = aquarium, Gecko = terrarium (SPEC.md §3 W4)
    pub frame: TankFrame,
    pub dialog_theme: DialogTheme,
    /// One remembered variant name per theme (SPEC.md §4's "Variants" table
    /// and §6's "dialog theme + variant per theme" persistence rule) — kept
    /// as free strings here since the variant vocabulary differs per theme
    /// and is a presentation-only concern the core doesn't interpret.
    /// Switching `dialog_theme` never touches this map; only an explicit
    /// variant pick (or the initial default below) writes to it.
    pub theme_variants: BTreeMap<DialogTheme, String>,
    pub light_on: bool,
    pub ambient_particles_on: bool, // "Bubbles" (aquarium) / "Mist" (terrarium)
    pub sound_on: bool,
    /// 1-60, Real time = 1 (SPEC.md §5).
    pub simulation_speed: u8,
    pub always_on_top: bool,
}

/// Every theme's first-listed variant (SPEC.md §4), used to seed
/// `JarSettings::default()` and to backfill `theme_variants` for the other
/// five themes when migrating a pre-variants-map snapshot (see
/// `jar-core`'s `snapshot::migrate_v1`).
pub fn default_theme_variants() -> BTreeMap<DialogTheme, String> {
    BTreeMap::from([
        (DialogTheme::Modern, "Lagoon".to_string()),
        (DialogTheme::ModernDark, "Lagoon".to_string()),
        (DialogTheme::Classic98, "Classic blue".to_string()),
        (DialogTheme::PaperNotebook, "Ruled cream".to_string()),
        (DialogTheme::HandheldLcd, "Pea soup".to_string()),
        (DialogTheme::NeonTerminal, "Magenta".to_string()),
    ])
}

impl Default for JarSettings {
    fn default() -> Self {
        Self {
            mode: Species::Fish,
            frame: TankFrame::Bevelled98,
            dialog_theme: DialogTheme::Modern,
            theme_variants: default_theme_variants(),
            light_on: true,
            ambient_particles_on: true,
            sound_on: false,
            simulation_speed: 1,
            always_on_top: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_match_documented_values() {
        let settings = JarSettings::default();
        assert_eq!(settings.mode, Species::Fish);
        assert_eq!(settings.frame, TankFrame::Bevelled98);
        assert_eq!(settings.dialog_theme, DialogTheme::Modern);
        assert_eq!(
            settings.theme_variants.get(&DialogTheme::Modern),
            Some(&"Lagoon".to_string())
        );
        assert_eq!(settings.theme_variants.len(), 6);
        assert!(settings.light_on);
        assert!(settings.ambient_particles_on);
        assert!(!settings.sound_on);
        assert_eq!(settings.simulation_speed, 1);
        assert!(!settings.always_on_top);
    }

    /// Exports `JarSettings::default()` as a JSON fixture the frontend reads
    /// directly (`apps/jar/src/domain/jarClient.test.ts`), so the two sides
    /// are compared against one generated artifact instead of two
    /// independently hand-copied literals that could drift in lockstep
    /// without either suite noticing. Same regeneration convention as the
    /// `ts-rs` bindings this crate also exports at `cargo test` time — see
    /// `scripts/generate-protocol-bindings.sh`.
    #[test]
    fn export_default_settings_fixture() {
        let settings = JarSettings::default();
        let json = serde_json::to_string_pretty(&settings).expect("serializes");

        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/jar/src/domain/protocol/generated/defaultSettings.json");
        std::fs::write(&path, format!("{json}\n")).expect("writes fixture");

        let round_tripped: JarSettings =
            serde_json::from_str(&json).expect("the fixture we just wrote deserializes");
        assert_eq!(round_tripped.mode, settings.mode);
        assert_eq!(round_tripped.simulation_speed, settings.simulation_speed);
    }
}
