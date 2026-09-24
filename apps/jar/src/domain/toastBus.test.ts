// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { describe, expect, it, vi } from 'vitest';

import { onToastPush, pushToast } from './toastBus';

describe('toastBus', () => {
  it('calls every subscribed listener with the pushed text', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubscribeA = onToastPush(a);
    const unsubscribeB = onToastPush(b);

    pushToast('Screenshot copied to clipboard');
    unsubscribeA();
    unsubscribeB();

    expect(a).toHaveBeenCalledOnce();
    expect(a).toHaveBeenCalledWith('Screenshot copied to clipboard');
    expect(b).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledWith('Screenshot copied to clipboard');
  });

  it('stops delivering to a listener once unsubscribed', () => {
    const listener = vi.fn();
    const unsubscribe = onToastPush(listener);

    unsubscribe();
    pushToast('should not arrive');

    expect(listener).not.toHaveBeenCalled();
  });

  it("doesn't let one listener's subscription affect another's", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubscribeA = onToastPush(a);
    const unsubscribeB = onToastPush(b);

    unsubscribeA();
    pushToast('only b hears this');
    unsubscribeB();

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledWith('only b hears this');
  });
});
