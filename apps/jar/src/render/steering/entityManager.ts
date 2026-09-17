// A single shared `YUKA.EntityManager` for the tank scene. Separation
// (`docs/architecture/3d-engine.md` §4.1) needs every fish's vehicle to be
// able to see every other fish's vehicle, so vehicles register themselves
// here on mount rather than each `FishController` keeping a private Yuka
// world.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import * as YUKA from 'yuka';

export const entityManager = new YUKA.EntityManager();
