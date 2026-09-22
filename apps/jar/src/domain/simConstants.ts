// `age_sec`-to-days conversion for display, plus the life-stage render
// scale — both frontend-only presentation concerns. Life-stage
// *classification* lives entirely in `crates/jar-core/src/tick.rs` and
// arrives pushed on `Critter`/`CritterStats.life_stage` (a sim fact, like
// `mood`/`energy`/`alive`) — this file has no copy of those thresholds to
// keep in sync.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { LifeStage } from './protocol/generated/LifeStage';

export const SECONDS_PER_JAR_DAY = 120;

/** `docs/architecture/3d-engine.md` §6.3: fry x0.45, juvenile x0.75, adult
 * x1.0, elder x1.0 (no separate elder scale defined yet). */
export function lifeStageScale(lifeStage: LifeStage): number {
  switch (lifeStage) {
    case 'Fry':
      return 0.45;
    case 'Juvenile':
      return 0.75;
    default:
      return 1.0;
  }
}
