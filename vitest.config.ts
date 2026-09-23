// Root vitest config: the frontend's only test suite lives under
// `apps/jar/src/`, so this is a bun-workspace-root config rather than a
// per-package one. `jsdom` is needed for `theme.ts`'s tests, which touch
// `document.documentElement`.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
  },
});
