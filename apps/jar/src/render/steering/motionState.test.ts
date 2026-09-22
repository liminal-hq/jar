// Tests for isSelfPropelledMode's self-propelled/decaying mode split.
//
// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it } from 'vitest';

import { isSelfPropelledMode } from './motionState';

describe('isSelfPropelledMode', () => {
  it('is true for active and chasing', () => {
    expect(isSelfPropelledMode('active')).toBe(true);
    expect(isSelfPropelledMode('chasing')).toBe(true);
  });

  it('is false for paused, settling, and settled', () => {
    expect(isSelfPropelledMode('paused')).toBe(false);
    expect(isSelfPropelledMode('settling')).toBe(false);
    expect(isSelfPropelledMode('settled')).toBe(false);
  });
});
