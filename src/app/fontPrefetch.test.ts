import { afterEach, describe, expect, it, vi } from 'vitest';
import { lettersFor, prefetchLetters } from './fontPrefetch';

describe('lettersFor', () => {
  it('asks for nothing where Latin alone writes the languages', () => {
    expect(lettersFor([])).toBe('');
    expect(lettersFor(['en-US', 'es-ES', 'fr-FR', 'de-DE', 'pt-BR'])).toBe('');
  });

  it('names one letter for each other Inter file the languages need, once', () => {
    expect(lettersFor(['ru-RU'])).toBe('Ж');
    expect(lettersFor(['uk-UA', 'bg-BG', 'sr'])).toBe('Ж');
    expect(lettersFor(['el-GR'])).toBe('Ω');
    expect(lettersFor(['vi-VN'])).toBe('ệ');
    expect(lettersFor(['tr-TR', 'pl-PL', 'sr-Latn-RS'])).toBe('ő');
    expect(lettersFor(['en-US', 'ru-RU', 'el-GR', 'tr-TR'])).toBe('ЖΩő');
  });

  it('passes over a code that is no language', () => {
    expect(lettersFor(['not a language', 'ru'])).toBe('Ж');
  });
});

describe('prefetchLetters', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'fonts');
    vi.unstubAllGlobals();
  });

  it('loads the letters in Inter once the page is idle, and not after a cancel', () => {
    const load = vi.fn(() => Promise.resolve([]));
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
    const idle: (() => void)[] = [];
    vi.stubGlobal('requestIdleCallback', (run: () => void) => idle.push(run));
    vi.stubGlobal('cancelIdleCallback', (id: number) => idle.splice(id - 1, 1));

    prefetchLetters('Ж');
    expect(load).not.toHaveBeenCalled();
    idle[0]?.();
    expect(load).toHaveBeenCalledWith('400 16px Inter', 'Ж');

    load.mockClear();
    idle.length = 0;
    const cancel = prefetchLetters('Ω');
    cancel();
    expect(idle).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it('does nothing for no letters', () => {
    const load = vi.fn(() => Promise.resolve([]));
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
    vi.stubGlobal('requestIdleCallback', (run: () => void) => {
      run();
      return 1;
    });
    prefetchLetters('');
    expect(load).not.toHaveBeenCalled();
  });
});
