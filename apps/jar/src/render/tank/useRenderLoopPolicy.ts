// Implements `docs/architecture/3d-engine.md` §1.3's render-loop policy:
// `"always"` while the window is visible, `"never"` while it's hidden or
// minimized. This is render/physics-only — it must never be reached for by
// anything that also gates the simulation tick, which keeps running on the
// Rust side regardless (`docs/architecture/rust-core.md` §5.1).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';

export function useRenderLoopPolicy(): 'always' | 'never' {
  const [frameloop, setFrameloop] = useState<'always' | 'never'>('always');

  useEffect(() => {
    const appWindow = getCurrentWindow();

    // Polling `isVisible()` rather than relying solely on focus/blur events
    // covers minimized and fully-occluded cases too, not just unfocused —
    // a poll interval this cheap is a fine trade against a dedicated
    // native visibility-changed event, which Tauri doesn't expose directly
    // as of v2.
    const checkVisibility = async () => {
      const visible = await appWindow.isVisible();
      setFrameloop(visible ? 'always' : 'never');
    };
    checkVisibility();
    const interval = setInterval(checkVisibility, 1000);

    return () => clearInterval(interval);
  }, []);

  return frameloop;
}
