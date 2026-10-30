import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announceDelayMs, useAnnouncement } from './useAnnouncement';

describe('useAnnouncement', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces a state only once it has held for half a second', () => {
    const { result, rerender } = renderHook(({ text }) => useAnnouncement(text), {
      initialProps: { text: 'Kira, ready' },
    });
    expect(result.current).toBe('Kira, ready');
    rerender({ text: 'Kira, listening' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ text: 'Kira, thinking' });
    act(() => {
      vi.advanceTimersByTime(announceDelayMs - 1);
    });
    expect(result.current).toBe('Kira, ready');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('Kira, thinking');
  });
});
