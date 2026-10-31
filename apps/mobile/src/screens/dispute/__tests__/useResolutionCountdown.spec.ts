/**
 * Unit tests for useResolutionCountdown (Spec 21 · P14): derives from the durable deadline, fires
 * onExpire once, and is display-only (never an authoritative client timer).
 */

import { act, renderHook } from '@testing-library/react-native';

import { useResolutionCountdown } from '../useResolutionCountdown';

jest.useFakeTimers();

describe('useResolutionCountdown', () => {
  it('reports remaining time from a future deadline and is not expired', () => {
    const deadline = new Date(Date.now() + 10_000).toISOString();
    const { result } = renderHook(() => useResolutionCountdown(deadline));
    expect(result.current.expired).toBe(false);
    expect(result.current.remainingMs).toBeGreaterThan(0);
  });

  it('is expired for a past deadline and fires onExpire exactly once', () => {
    const onExpire = jest.fn();
    const deadline = new Date(Date.now() - 1_000).toISOString();
    renderHook(() => useResolutionCountdown(deadline, onExpire));
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('returns zero remaining and not expired for a null deadline', () => {
    const { result } = renderHook(() => useResolutionCountdown(null));
    expect(result.current.remainingMs).toBe(0);
    expect(result.current.expired).toBe(false);
  });
});
