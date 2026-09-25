// Redirects `console.*` calls into `@tauri-apps/plugin-log`, so webview
// messages end up in the same log stream as the native Rust side (the
// backend's own `tauri_plugin_log::Builder` in `src-tauri/src/lib.rs`
// re-emits everything through one process-global logger, tagged
// `webview[:file:line:col]` for anything forwarded from here) — the same
// pattern other Liminal HQ apps use. `console.log` maps to `info`; the
// plugin has no separate "log" level.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { debug, error, info, warn } from '@tauri-apps/plugin-log';

type ConsoleMethod = 'log' | 'debug' | 'info' | 'warn' | 'error';
type PluginLogger = (message: string, options?: { file?: string; line?: number }) => Promise<void>;

function serialiseConsoleArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function forwardConsole(method: ConsoleMethod, logger: PluginLogger): void {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    original(...args);
    void logger(args.map(serialiseConsoleArg).join(' '));
  };
}

/** Call once at startup — see `main.tsx`. */
export function initLogger(): void {
  forwardConsole('log', info);
  forwardConsole('debug', debug);
  forwardConsole('info', info);
  forwardConsole('warn', warn);
  forwardConsole('error', error);
}
