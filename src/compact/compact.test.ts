import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Compact,
  compactNoticeMs,
  compactNoticeRepeatMs,
  compactWindowSize,
  type CompactOptions,
} from './compact';
import { browserPictureWindows, dressWindow, type PictureWindows, type WindowSize } from './pip';
import { cardLine } from './copy';

/** A floating window the test closes, as the browser's own close or "Back to tab" does. */
function fakeWindow() {
  const listeners = new Set<() => void>();
  const doc = document.implementation.createHTMLDocument('');
  const close = vi.fn(() => {
    for (const listener of listeners) listener();
  });
  const opened = {
    document: doc,
    close,
    addEventListener: (kind: string, listener: () => void) => {
      if (kind === 'pagehide') listeners.add(listener);
    },
  } as unknown as Window;
  return Object.assign(opened, { closeMock: close });
}

/** Floating windows whose opening the test settles. */
function fakeWindows(supported = true) {
  const asked: WindowSize[] = [];
  let settle: { resolve: (w: Window) => void; reject: (e: Error) => void } | null = null;
  const windows: PictureWindows = {
    supported,
    open: (size) => {
      asked.push(size);
      return new Promise<Window>((resolve, reject) => {
        settle = { resolve, reject };
      });
    },
  };
  return {
    windows,
    asked,
    async open(w: Window) {
      settle?.resolve(w);
      await Promise.resolve();
      await Promise.resolve();
    },
    async refuse() {
      settle?.reject(new Error('NotAllowedError'));
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function clock() {
  let now = 0;
  const timers: { at: number; run: () => void }[] = [];
  const options: CompactOptions = {
    now: () => now,
    setTimer: (run, ms) => {
      const timer = { at: now + ms, run };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      const i = timers.indexOf(timer as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  return {
    options,
    advance(ms: number) {
      now += ms;
      for (const timer of [...timers]) {
        if (timer.at <= now) {
          timers.splice(timers.indexOf(timer), 1);
          timer.run();
        }
      }
    },
  };
}

describe('compactWindowSize', () => {
  it('is the 360 × 64 capsule with 8 on every side, its height following the text size', () => {
    expect(compactWindowSize(1)).toEqual({ width: 376, height: 80 });
    expect(compactWindowSize(1.3)).toEqual({ width: 376, height: 99 });
  });
});

describe('Compact', () => {
  it('asks for the window at once, in the press, at the capsule’s size', () => {
    const fake = fakeWindows();
    const compact = new Compact(fake.windows);
    compact.enter(1.15);
    // Nothing awaited before the ask: the press still counts for the browser.
    expect(fake.asked).toEqual([compactWindowSize(1.15)]);
    expect(compact.state).toMatchObject({ mode: 'full', opening: true });
  });

  it('becomes Compact once the window opens, and the full window again when it closes', async () => {
    const fake = fakeWindows();
    const compact = new Compact(fake.windows);
    const seen = vi.fn();
    compact.subscribe(seen);
    compact.enter();
    const opened = fakeWindow();
    await fake.open(opened);
    expect(compact.state).toMatchObject({ mode: 'compact', window: opened, opening: false });
    // The browser's own close, or Chrome's "Back to tab".
    opened.close();
    expect(compact.state).toMatchObject({ mode: 'full', window: null });
    expect(seen).toHaveBeenCalled();
  });

  it('closes the window when it leaves Compact', async () => {
    const fake = fakeWindows();
    const compact = new Compact(fake.windows);
    compact.enter();
    const opened = fakeWindow();
    await fake.open(opened);
    compact.leave();
    expect(opened.closeMock).toHaveBeenCalledTimes(1);
    expect(compact.state.mode).toBe('full');
  });

  it('asks once while the browser opens the window', () => {
    const fake = fakeWindows();
    const compact = new Compact(fake.windows);
    compact.enter();
    compact.enter();
    expect(fake.asked).toHaveLength(1);
  });

  it('stays in the full window when the browser refuses', async () => {
    const fake = fakeWindows();
    const compact = new Compact(fake.windows);
    compact.enter();
    await fake.refuse();
    expect(compact.state).toMatchObject({ mode: 'full', opening: false, window: null });
    // And it can ask again.
    compact.enter();
    expect(fake.asked).toHaveLength(2);
  });

  it('closes a window that opens after the page went back to the full window', async () => {
    const fake = fakeWindows();
    const compact = new Compact(fake.windows);
    compact.enter();
    compact.leave();
    const late = fakeWindow();
    await fake.open(late);
    expect(late.closeMock).toHaveBeenCalledTimes(1);
    expect(compact.state.mode).toBe('full');
  });

  it('opens the card where the browser has no floating windows, and a second press closes it', () => {
    const fake = fakeWindows(false);
    const compact = new Compact(fake.windows);
    compact.enter();
    expect(fake.asked).toHaveLength(0);
    expect(compact.state).toMatchObject({ mode: 'full', card: true, cardSeen: true });
    compact.enter();
    expect(compact.state.card).toBe(false);
    compact.enter();
    compact.closeCard();
    expect(compact.state).toMatchObject({ card: false, cardSeen: true });
  });

  it('keeps the floating window’s root as the page’s while the preferences change', async () => {
    const page = document.implementation.createHTMLDocument('');
    page.documentElement.className = 'convai-theme';
    const fake = fakeWindows();
    const compact = new Compact(fake.windows, { page });
    compact.enter();
    const opened = fakeWindow();
    await fake.open(opened);
    page.documentElement.classList.add('convai-reduce-motion');
    page.documentElement.style.setProperty('--convai-text-scale', '1.15');
    await new Promise((resolve) => setTimeout(resolve, 0));
    // A document with no window of its own: jest-dom's matchers refuse its elements.
    expect(opened.document.documentElement.className).toBe('convai-theme convai-reduce-motion');
    expect(opened.document.documentElement.style.getPropertyValue('--convai-text-scale')).toBe(
      '1.15',
    );
    // Closed, it follows no more.
    opened.close();
    page.documentElement.classList.add('convai-high-contrast');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(opened.document.documentElement.classList.contains('convai-high-contrast')).toBe(false);
  });

  describe('the image toast', () => {
    async function inCompact() {
      const fake = fakeWindows();
      const time = clock();
      const compact = new Compact(fake.windows, time.options);
      compact.enter();
      const opened = fakeWindow();
      await fake.open(opened);
      return { compact, time, opened };
    }

    it('shows for 6 s', async () => {
      const { compact, time } = await inCompact();
      expect(compact.refuseImage()).toBe(true);
      expect(compact.state.notice).toBe(true);
      time.advance(compactNoticeMs - 1);
      expect(compact.state.notice).toBe(true);
      time.advance(1);
      expect(compact.state.notice).toBe(false);
    });

    it('never shows twice within 10 s', async () => {
      const { compact, time } = await inCompact();
      compact.refuseImage();
      time.advance(compactNoticeMs);
      time.advance(compactNoticeRepeatMs - compactNoticeMs - 1);
      expect(compact.refuseImage()).toBe(false);
      expect(compact.state.notice).toBe(false);
      time.advance(1);
      expect(compact.refuseImage()).toBe(true);
    });

    it('holds while pointed at or focused, then stays its whole 6 s again', async () => {
      const { compact, time } = await inCompact();
      compact.refuseImage();
      time.advance(compactNoticeMs - 1000);
      compact.holdNotice(true);
      time.advance(20_000);
      expect(compact.state.notice).toBe(true);
      compact.holdNotice(false);
      time.advance(compactNoticeMs - 1);
      expect(compact.state.notice).toBe(true);
      time.advance(1);
      expect(compact.state.notice).toBe(false);
    });

    it('does not show in the full window', () => {
      const compact = new Compact(fakeWindows().windows);
      expect(compact.refuseImage()).toBe(false);
      expect(compact.state.notice).toBe(false);
    });

    it('goes when closed, and with the window', async () => {
      const { compact, opened } = await inCompact();
      compact.refuseImage();
      compact.closeNotice();
      expect(compact.state.notice).toBe(false);
      const second = await inCompact();
      second.compact.refuseImage();
      second.opened.close();
      expect(second.compact.state.notice).toBe(false);
      opened.close();
    });
  });
});

describe('dressWindow', () => {
  it('gives the floating window the page’s sheets, root classes, style, language and title', () => {
    const page = document.implementation.createHTMLDocument('Convai Vision Assistant');
    const base = page.createElement('base');
    base.href = 'http://localhost:4173/';
    page.head.append(base);
    page.documentElement.className = 'convai-theme convai-high-contrast';
    page.documentElement.lang = 'en';
    page.documentElement.style.setProperty('--convai-text-scale', '1.3');
    const style = page.createElement('style');
    style.textContent = '.va-x { color: red; }';
    const link = page.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/assets/index.css';
    const icon = page.createElement('link');
    icon.rel = 'icon';
    page.head.append(style, link, icon);
    const floating = document.implementation.createHTMLDocument('');
    dressWindow(page, floating);
    // A sheet whose rules the page reads goes over as their text: nothing to load.
    expect(floating.head.querySelector('style')?.textContent).toMatch(
      /^\.va-x \{\s*color: red;\s*\}$/,
    );
    // One not loaded (or another origin's) goes as a link, by its whole address: the floating
    // window's own is about:blank.
    expect(floating.head.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe(
      'http://localhost:4173/assets/index.css',
    );
    expect(floating.head.querySelector('link[rel="icon"]')).toBeNull();
    expect(floating.documentElement.className).toBe('convai-theme convai-high-contrast');
    expect(floating.documentElement.lang).toBe('en');
    expect(floating.documentElement.style.getPropertyValue('--convai-text-scale')).toBe('1.3');
    expect(floating.title).toBe('Convai Vision Assistant');
  });

  it('carries a sheet’s rules as they are now, not its markup', () => {
    // Rules added through the CSSOM (as a bundler's runtime may) are in no element's text.
    const style = document.createElement('style');
    document.head.append(style);
    style.sheet?.insertRule('.va-added { color: blue; }');
    const floating = document.implementation.createHTMLDocument('');
    dressWindow(document, floating);
    const copied = [...floating.head.querySelectorAll('style')].map((s) => s.textContent).join('');
    style.remove();
    expect(copied).toMatch(/\.va-added \{\s*color: blue;\s*\}/);
  });
});

describe('browserPictureWindows', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is unsupported without the browser’s floating windows', async () => {
    const windows = browserPictureWindows(window);
    expect(windows.supported).toBe(false);
    await expect(windows.open({ width: 1, height: 1 })).rejects.toThrow();
  });

  it('asks the browser synchronously and dresses what it opens', async () => {
    const floating = document.implementation.createHTMLDocument('');
    const requestWindow = vi.fn(() => Promise.resolve({ document: floating } as unknown as Window));
    const view = { document, documentPictureInPicture: { requestWindow } } as unknown as Window;
    const windows = browserPictureWindows(view);
    expect(windows.supported).toBe(true);
    const opening = windows.open({ width: 376, height: 72 });
    expect(requestWindow).toHaveBeenCalledWith({ width: 376, height: 72 });
    document.documentElement.classList.add('convai-theme');
    await opening;
    expect(floating.documentElement.classList.contains('convai-theme')).toBe(true);
    document.documentElement.classList.remove('convai-theme');
  });
});

describe('cardLine', () => {
  it('names the character where the design says Kira', () => {
    expect(cardLine('Vision Spike')).toBe(
      'Vision Spike stays in this tab because this browser does not support floating windows. Try a desktop browser with Document Picture-in-Picture support.',
    );
  });
});
