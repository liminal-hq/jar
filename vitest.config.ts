// Root vitest config: the frontend's only test suite lives under
// `apps/jar/src/`, so this is a bun-workspace-root config rather than a
// per-package one. `jsdom` is needed for `theme.ts`'s tests, which touch
// `document.documentElement`.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // Vitest's own default excludes (node_modules, .git, dist, etc.) don't
    // know about `.claude/worktrees/` — a nested git worktree checked out
    // there for agent work has its own `node_modules` symlinks that don't
    // resolve from this root, so its test files fail to import rather than
    // being skipped. Extend, don't replace, the defaults.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
});
