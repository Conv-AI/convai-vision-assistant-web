import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useMeasure } from './measure';

/** The page's fonts, which a test makes finish loading while a hook listens. */
function fonts() {
  const listeners = new Set<() => void>();
  const set = {
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  // jsdom has no FontFaceSet.
  Object.defineProperty(document, 'fonts', { configurable: true, value: set });
  return {
    loaded() {
      for (const listener of [...listeners]) listener();
    },
    listening: () => listeners.size,
  };
}

afterEach(() => {
  Reflect.deleteProperty(document, 'fonts');
});

describe('useMeasure', () => {
  it('gives the same function until a font file arrives, then a new one', () => {
    const page = fonts();
    const { result, rerender } = renderHook(() => useMeasure('400 12px Inter'));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);

    act(() => {
      page.loaded();
    });
    expect(result.current).not.toBe(first);
    expect(result.current('Привет')).toBeGreaterThan(0);
  });

  it('listens once for every part that measures, and lets go when the last one goes', () => {
    const page = fonts();
    const one = renderHook(() => useMeasure('400 12px Inter'));
    const two = renderHook(() => useMeasure('600 13px Inter'));
    expect(page.listening()).toBe(1);
    one.unmount();
    expect(page.listening()).toBe(1);
    two.unmount();
    expect(page.listening()).toBe(0);
  });
});
