import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsStore } from '../settings/stored';
import { useReducedMotion } from './hooks';

/** The browser's Reduce Motion, which a test can change while a hook listens. */
function browserAsks(initial: boolean) {
  const listeners = new Set<() => void>();
  let matches = initial;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return matches;
      },
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    })),
  );
  return {
    set(value: boolean) {
      matches = value;
      for (const listener of listeners) listener();
    },
    listening: () => listeners.size,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useReducedMotion', () => {
  it('is On from the first render when stored On and the browser does not ask', () => {
    browserAsks(false);
    const settings = new SettingsStore(null);
    settings.set({ reduceMotion: 'on' });
    const { result } = renderHook(() => useReducedMotion(settings));
    expect(result.current).toBe(true);
  });

  it('keeps motion when stored Off though the browser asks to reduce it', () => {
    browserAsks(true);
    const settings = new SettingsStore(null);
    settings.set({ reduceMotion: 'off' });
    const { result } = renderHook(() => useReducedMotion(settings));
    expect(result.current).toBe(false);
  });

  it('follows the browser on System, and the setting when it changes', () => {
    const browser = browserAsks(false);
    const settings = new SettingsStore(null);
    const { result, unmount } = renderHook(() => useReducedMotion(settings));
    expect(result.current).toBe(false);
    act(() => {
      browser.set(true);
    });
    expect(result.current).toBe(true);
    act(() => {
      settings.set({ reduceMotion: 'off' });
    });
    expect(result.current).toBe(false);
    unmount();
    expect(browser.listening()).toBe(0);
  });
});
