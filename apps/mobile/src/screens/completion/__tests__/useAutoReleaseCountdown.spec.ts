/**
 * Unit tests for useAutoReleaseCountdown (Spec 20 · P11): it derives a display-only countdown from
 * the durable server deadline and, on expiry, re-fetches via GET (`onExpire`) rather than mutating
 * state locally — never an authoritative client timer.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useAutoReleaseCountdown } from '../useAutoReleaseCountdown';

describe('useAutoReleaseCountdown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('derives remaining time from a future deadline (not expired)', () => {
    const deadline = new Date('2024-01-01T00:01:00.000Z').toISOString(); // +60s
    const { result } = renderHook(() => useAutoReleaseCountdown(deadline));
    expect(result.current.expired).toBe(false);
    expect(result.current.remainingMs).toBeGreaterThan(0);
    expect(result.current.remainingMs).toBeLessThanOrEqual(60_000);
  });

  it('reports expired and calls onExpire once when the deadline passes', () => {
    const onExpire = jest.fn();
    const deadline = new Date('2024-01-01T00:00:02.000Z').toISOString(); // +2s
    const { result } = renderHook(() => useAutoReleaseCountdown(deadline, onExpire));
    expect(result.current.expired).toBe(false);
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(result.current.expired).toBe(true);
    expect(result.current.remainingMs).toBe(0);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('is a no-op display when there is no deadline', () => {
    const { result } = renderHook(() => useAutoReleaseCountdown(null));
    expect(result.current.remainingMs).toBe(0);
    expect(result.current.expired).toBe(false);
  });
});
