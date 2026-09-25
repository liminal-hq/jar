// Tests for `initLogger`'s two previously-broken behaviours:
// - it must be a true no-op outside a real Tauri webview (no throwing, no
//   unhandled rejections from the wrapped console methods), and must never
//   produce an unhandled rejection even if the bridge exists but fails; and
// - it must tag each forwarded message with the actual application call
//   site, not the fixed location of `forwardConsole`'s own wrapper.
// Also covers the two related minor fixes: `initLogger()` being idempotent,
// and the circular-reference fallback in `serialiseConsoleArg` preserving
// more than `String(arg)`'s bare `"[object Object]"`.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockPluginLogger = (
  message: string,
  options?: { file?: string; line?: number },
) => Promise<void>;

const pluginLog: Record<
  'debug' | 'info' | 'warn' | 'error',
  ReturnType<typeof vi.fn<MockPluginLogger>>
> = {
  debug: vi.fn(async () => {}),
  info: vi.fn(async () => {}),
  warn: vi.fn(async () => {}),
  error: vi.fn(async () => {}),
};

// Mutable so each test can flip whether the mocked `@tauri-apps/api/core`
// reports a Tauri context, without needing a fresh module registry per
// combination of mocks.
let tauriEnv = false;

vi.mock('@tauri-apps/plugin-log', () => pluginLog);
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => tauriEnv,
}));

const CONSOLE_METHODS = ['log', 'debug', 'info', 'warn', 'error'] as const;
let consoleSnapshot: Record<(typeof CONSOLE_METHODS)[number], (...args: unknown[]) => void>;

beforeEach(() => {
  // `forwardConsole` mutates the real, global `console` object -
  // `vi.resetModules()` only resets the *module* registry, so console
  // methods wrapped by a previous test's `initLogger()` call would
  // otherwise leak into the next test and get double-wrapped.
  consoleSnapshot = Object.fromEntries(
    CONSOLE_METHODS.map((method) => [method, console[method]]),
  ) as typeof consoleSnapshot;
  vi.resetModules();
  tauriEnv = false;
  for (const fn of Object.values(pluginLog)) {
    fn.mockReset();
    fn.mockResolvedValue(undefined);
  }
});

afterEach(() => {
  for (const method of CONSOLE_METHODS) {
    console[method] = consoleSnapshot[method];
  }
});

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('initLogger outside a Tauri context', () => {
  it('does not wrap console or throw, and never touches the log bridge', async () => {
    tauriEnv = false;
    const { initLogger } = await import('./logger');
    const originalLog = vi.fn();
    console.log = originalLog;

    expect(() => initLogger()).not.toThrow();
    expect(() => console.log('hello')).not.toThrow();
    await flushMicrotasks();

    // Left entirely unwrapped: the original console.log still ran, and the
    // plugin bridge was never touched.
    expect(originalLog).toHaveBeenCalledWith('hello');
    expect(pluginLog.info).not.toHaveBeenCalled();
  });
});

describe('initLogger inside a Tauri context', () => {
  it('forwards console.log through info without throwing or rejecting, even if the bridge call fails', async () => {
    tauriEnv = true;
    pluginLog.info.mockRejectedValue(new Error('bridge misconfigured'));
    const { initLogger } = await import('./logger');
    console.log = vi.fn();

    initLogger();
    expect(() => console.log('hi')).not.toThrow();
    await flushMicrotasks();

    // If the `.catch()` backstop were missing, the rejection above would
    // surface as an unhandled rejection and fail this test under vitest.
    expect(pluginLog.info).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: calling it twice does not double-wrap console', async () => {
    tauriEnv = true;
    const { initLogger } = await import('./logger');
    console.log = vi.fn();

    initLogger();
    initLogger();
    console.log('once');
    await flushMicrotasks();

    expect(pluginLog.info).toHaveBeenCalledTimes(1);
  });

  it('tags each forwarded message with the real caller location, not a fixed wrapper location', async () => {
    tauriEnv = true;
    const { initLogger } = await import('./logger');
    console.log = vi.fn();
    initLogger();

    console.log('first');
    console.log('second');
    await flushMicrotasks();

    expect(pluginLog.info).toHaveBeenCalledTimes(2);
    const [, firstOptions] = pluginLog.info.mock.calls[0]!;
    const [, secondOptions] = pluginLog.info.mock.calls[1]!;

    expect(firstOptions?.file).toMatch(/logger\.test\.ts$/);
    expect(secondOptions?.file).toMatch(/logger\.test\.ts$/);
    expect(typeof firstOptions?.line).toBe('number');
    // The two calls above are on consecutive source lines - if the call
    // site were fixed (the bug this guards against), both would report the
    // exact same location instead of one line apart.
    expect(secondOptions?.line).toBe((firstOptions?.line ?? 0) + 1);
  });

  it('keeps circular-reference content instead of collapsing to "[object Object]"', async () => {
    tauriEnv = true;
    const { initLogger } = await import('./logger');
    console.log = vi.fn();
    initLogger();

    const circular: Record<string, unknown> = { name: 'ringo' };
    circular.self = circular;
    console.log(circular);
    await flushMicrotasks();

    const [message] = pluginLog.info.mock.calls[0]!;
    expect(message).not.toBe('[object Object]');
    expect(message).toContain('ringo');
  });
});
