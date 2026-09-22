// Thin wrapper over `invoke()`/`Channel` for `tauri-plugin-jar`'s command
// surface (see `docs/architecture/rust-core.md` §3.4). Deliberately
// untyped at this layer — the generated protocol types live in
// `apps/jar/src/domain/protocol/generated/` (produced by `jar-protocol`'s
// `ts-rs` export, not by this package), and `apps/jar/src/domain/jarClient.ts`
// is where the two are combined into a typed façade the rest of the
// frontend imports. Keeping this package type-agnostic means it doesn't
// need a build-order dependency on the app's generated-types folder.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { Channel, invoke } from '@tauri-apps/api/core';

const COMMAND_PREFIX = 'plugin:jar|';

export function start(settings: unknown, onEvent: (event: unknown) => void): Promise<void> {
  const channel = new Channel<unknown>();
  channel.onmessage = onEvent;
  return invoke(`${COMMAND_PREFIX}start`, { settings, onEvent: channel });
}

export function stop(): Promise<void> {
  return invoke(`${COMMAND_PREFIX}stop`);
}

export function setSpeed(speed: number): Promise<void> {
  return invoke(`${COMMAND_PREFIX}set_speed`, { speed });
}

export function setMode(mode: unknown): Promise<void> {
  return invoke(`${COMMAND_PREFIX}set_mode`, { mode });
}

export function addCritter(species: unknown): Promise<unknown> {
  return invoke(`${COMMAND_PREFIX}add_critter`, { species });
}

export function renameCritter(id: unknown, name: string): Promise<void> {
  return invoke(`${COMMAND_PREFIX}rename_critter`, { id, name });
}

export function setToggle(toggle: unknown, on: boolean): Promise<void> {
  return invoke(`${COMMAND_PREFIX}set_toggle`, { toggle, on });
}

export function setTheme(theme: unknown, variant: string): Promise<void> {
  return invoke(`${COMMAND_PREFIX}set_theme`, { theme, variant });
}

export function setFrame(frame: unknown): Promise<void> {
  return invoke(`${COMMAND_PREFIX}set_frame`, { frame });
}

export function setLightColour(colour: unknown): Promise<void> {
  return invoke(`${COMMAND_PREFIX}set_light_colour`, { colour });
}

export function getSnapshot(): Promise<unknown> {
  return invoke(`${COMMAND_PREFIX}get_snapshot`);
}

export function loadSnapshot(bytes: Uint8Array): Promise<void> {
  return invoke(`${COMMAND_PREFIX}load_snapshot`, { bytes: Array.from(bytes) });
}
