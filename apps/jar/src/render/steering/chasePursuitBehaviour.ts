// Null-safe wrapper around Yuka's own `PursuitBehavior` — its `calculate()`
// dereferences `this.evader.position` unguarded (`yuka.module.js`), but this
// behavior is added once per fish at spawn and stays permanently `active`
// (the weight-ramp architecture in `steeringWeights.ts` — behaviors are
// never toggled, only their `.weight`), long before any chase has ever
// assigned it a target. Without this guard every fish would throw on its
// very first frame.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as YUKA from 'yuka';

export class ChasePursuitBehaviour extends YUKA.PursuitBehavior {
  calculate(vehicle: YUKA.Vehicle, force: YUKA.Vector3): YUKA.Vector3 {
    if (this.evader === null) {
      force.set(0, 0, 0);
      return force;
    }
    return super.calculate(vehicle, force);
  }
}
