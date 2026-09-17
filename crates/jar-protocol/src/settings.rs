// Persisted jar settings, per SPEC.md §6 minus window geometry (owned by
// `tauri-plugin-window-state` instead — see `docs/architecture/rust-core.md`
// §5.4).
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
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
    /// One remembered variant name per theme (SPEC.md §4's "Variants" table)
    /// — kept as a free string here since the variant vocabulary differs per
    /// theme and is a presentation-only concern the core doesn't interpret.
    pub theme_variant: String,
    pub light_on: bool,
    pub ambient_particles_on: bool, // "Bubbles" (aquarium) / "Mist" (terrarium)
    pub sound_on: bool,
    /// 1-60, Real time = 1 (SPEC.md §5).
    pub simulation_speed: u8,
    pub always_on_top: bool,
}

impl Default for JarSettings {
    fn default() -> Self {
        Self {
            mode: Species::Fish,
            frame: TankFrame::Bevelled98,
            dialog_theme: DialogTheme::Modern,
            theme_variant: "Lagoon".to_string(),
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

    /// Pinned against `apps/jar/src/domain/jarClient.ts`'s hand-duplicated
    /// `DEFAULT_SETTINGS` object, which mirrors this `Default` impl for the
    /// settings a fresh jar starts with before any snapshot exists — the
    /// two have no shared generated source, so this test is the
    /// sync-enforcement mechanism between them (same pattern as
    /// `jar-core`'s `life_stage_boundaries_match_spec`).
    #[test]
    fn default_settings_match_the_frontends_hand_duplicated_copy() {
        let settings = JarSettings::default();
        assert_eq!(settings.mode, Species::Fish);
        assert_eq!(settings.frame, TankFrame::Bevelled98);
        assert_eq!(settings.dialog_theme, DialogTheme::Modern);
        assert_eq!(settings.theme_variant, "Lagoon");
        assert!(settings.light_on);
        assert!(settings.ambient_particles_on);
        assert!(!settings.sound_on);
        assert_eq!(settings.simulation_speed, 1);
        assert!(!settings.always_on_top);
    }
}
