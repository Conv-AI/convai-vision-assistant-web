import { describe, expect, it, vi } from 'vitest';
import {
  applyPreferences,
  clampTextScale,
  defaultPreferences,
  reducesMotion,
  type KitPreferences,
} from './preferences';

function fakeMedia(initial: Record<string, boolean>) {
  const lists = new Map<string, { matches: boolean; listeners: Set<() => void> }>();
  const matchMedia = (query: string) => {
    let list = lists.get(query);
    if (!list) {
      list = { matches: initial[query] ?? false, listeners: new Set() };
      lists.set(query, list);
    }
    const entry = list;
    return {
      get matches() {
        return entry.matches;
      },
      addEventListener: vi.fn((_type: string, listener: () => void) =>
        entry.listeners.add(listener),
      ),
      removeEventListener: vi.fn((_type: string, listener: () => void) => {
        entry.listeners.delete(listener);
      }),
    } as unknown as MediaQueryList;
  };
  const set = (query: string, matches: boolean) => {
    const list = lists.get(query);
    if (!list) throw new Error(`${query} was never asked`);
    list.matches = matches;
    for (const listener of list.listeners) listener();
  };
  const listenerCount = () => [...lists.values()].reduce((n, l) => n + l.listeners.size, 0);
  return { matchMedia, set, listenerCount };
}

function rootElement() {
  const root = document.createElement('div');
  root.className = 'convai-theme';
  return root;
}

const prefs = (changes: Partial<KitPreferences>): KitPreferences => ({
  ...defaultPreferences,
  ...changes,
});

describe('clampTextScale', () => {
  it.each([
    [1, 1],
    [0.9, 0.9],
    [1.3, 1.3],
    [0.5, 0.9],
    [2, 1.3],
    [1.12, 1.1],
    [1.13, 1.15],
    [Number.NaN, 1],
  ])('draws %s as %s', (input, expected) => {
    expect(clampTextScale(input)).toBeCloseTo(expected, 10);
  });
});

describe('applyPreferences', () => {
  it('sets the text size and the character color', () => {
    const root = rootElement();
    const media = fakeMedia({});
    applyPreferences(root, prefs({ textScale: 1.15, aiColor: 'cyan' }), media.matchMedia);
    expect(root.style.getPropertyValue('--convai-text-scale')).toBe('1.15');
    expect(root.classList.contains('convai-ai--cyan')).toBe(true);
    expect(root.classList.contains('convai-ai--yellow')).toBe(false);
    expect(root.classList.contains('convai-ai--mint')).toBe(false);
  });

  it('follows the browser while a setting is "system"', () => {
    const root = rootElement();
    const media = fakeMedia({ '(prefers-contrast: more)': true });
    applyPreferences(root, defaultPreferences, media.matchMedia);
    expect(root.classList.contains('convai-high-contrast')).toBe(true);
    expect(root.classList.contains('convai-reduce-motion')).toBe(false);

    media.set('(prefers-reduced-motion: reduce)', true);
    media.set('(prefers-contrast: more)', false);
    expect(root.classList.contains('convai-reduce-motion')).toBe(true);
    expect(root.classList.contains('convai-high-contrast')).toBe(false);
  });

  it('lets "on" and "off" win over the browser', () => {
    const root = rootElement();
    const media = fakeMedia({
      '(prefers-contrast: more)': true,
      '(prefers-reduced-motion: reduce)': false,
    });
    applyPreferences(root, prefs({ highContrast: 'off', reduceMotion: 'on' }), media.matchMedia);
    expect(root.classList.contains('convai-high-contrast')).toBe(false);
    expect(root.classList.contains('convai-reduce-motion')).toBe(true);

    media.set('(prefers-contrast: more)', true);
    expect(root.classList.contains('convai-high-contrast')).toBe(false);
  });

  it('stops listening when its cleanup runs', () => {
    const root = rootElement();
    const media = fakeMedia({});
    const cleanup = applyPreferences(root, defaultPreferences, media.matchMedia);
    expect(media.listenerCount()).toBe(2);
    cleanup();
    expect(media.listenerCount()).toBe(0);
    media.set('(prefers-contrast: more)', true);
    expect(root.classList.contains('convai-high-contrast')).toBe(false);
  });
});

describe('reducesMotion', () => {
  const asks = (reduce: boolean) =>
    fakeMedia({ '(prefers-reduced-motion: reduce)': reduce }).matchMedia;

  it('follows the browser on System', () => {
    expect(reducesMotion('system', asks(true))).toBe(true);
    expect(reducesMotion('system', asks(false))).toBe(false);
  });

  it('reduces on On even when the browser does not ask', () => {
    expect(reducesMotion('on', asks(false))).toBe(true);
  });

  it('keeps motion on Off even when the browser asks to reduce it', () => {
    expect(reducesMotion('off', asks(true))).toBe(false);
  });
});
