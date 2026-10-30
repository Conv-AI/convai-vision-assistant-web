import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LensFrame } from './draw';
import { Lens, LensLoader } from './Lens';

// The drawing is tested in lens.test.ts; here only what the component hands it each frame.
const drawn: LensFrame[] = [];
vi.mock('./draw', async (original) => {
  const actual = await original<typeof import('./draw')>();
  const record = (_ctx: unknown, _palette: unknown, ...rest: unknown[]) => {
    drawn.push(rest[rest.length - 1] as LensFrame);
  };
  return { ...actual, drawGlass: vi.fn(record), drawOuter: vi.fn(), drawLoader: vi.fn(record) };
});
vi.mock('./palette', () => ({ readPalette: () => ({}) }));

// One frame on demand instead of the window's animation frame; the loop's wakes are counted.
const items: { frame(now: number, dt: number): number }[] = [];
const loop = vi.hoisted(() => ({ wakes: 0 }));
vi.mock('./loop', () => ({
  animate: (item: { frame(now: number, dt: number): number }) => {
    items.push(item);
    return () => items.splice(items.indexOf(item), 1);
  },
  followVoice: () => [{ level: 0, slow: 0, onset: false, history: [] }, () => undefined],
  wake: () => {
    loop.wakes += 1;
  },
}));

/** What the page's IntersectionObserver was handed: a test calls it as the browser would. */
let seen: (entries: { isIntersecting: boolean }[]) => void = () => undefined;

function drawFrame(): LensFrame {
  drawn.length = 0;
  for (const item of items) item.frame(1000, 0.016);
  const frame = drawn.at(-1);
  if (!frame) throw new Error('nothing was drawn');
  return frame;
}

/** Lets the MutationObserver that watches the theme's root hear a class change. */
const settle = () => act(() => Promise.resolve());

beforeEach(() => {
  const ctx = { setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof seen) {
        seen = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  items.length = 0;
});

function themed(reduce: boolean, owner: Document = document): HTMLElement {
  const root = owner.createElement('div');
  root.className = reduce ? 'convai-theme convai-reduce-motion' : 'convai-theme';
  owner.body.append(root);
  return root;
}

describe('Lens and Reduce Motion', () => {
  it('draws with Reduce Motion while the theme root carries it', () => {
    const root = themed(true);
    render(<Lens name="Kira" state="speaking" />, { container: root });
    expect(drawFrame().reduceMotion).toBe(true);
    root.remove();
  });

  it('draws with motion while the theme root does not carry it', () => {
    const root = themed(false);
    render(<Lens name="Kira" state="speaking" />, { container: root });
    expect(drawFrame().reduceMotion).toBe(false);
    root.remove();
  });

  it('follows the preference when it changes while the Lens is drawn', async () => {
    const root = themed(false);
    render(<Lens name="Kira" state="ready" />, { container: root });
    root.classList.add('convai-reduce-motion');
    await settle();
    expect(drawFrame().reduceMotion).toBe(true);
    root.classList.remove('convai-reduce-motion');
    await settle();
    expect(drawFrame().reduceMotion).toBe(false);
    root.remove();
  });

  it('reads the root of its own document, as in the Compact window', async () => {
    const other = document.implementation.createHTMLDocument('Compact');
    other.documentElement.className = 'convai-theme';
    render(<Lens name="Kira" state="ready" />, { container: other.body });
    expect(drawFrame().reduceMotion).toBe(false);
    // What mirrorRoot does when the person turns Reduce motion on in the tab.
    other.documentElement.className = 'convai-theme convai-reduce-motion';
    await settle();
    expect(drawFrame().reduceMotion).toBe(true);
  });

  it('holds the loader still under Reduce Motion too', () => {
    const root = themed(true);
    render(<LensLoader />, { container: root });
    expect(drawFrame().reduceMotion).toBe(true);
    root.remove();
  });
});

/** Draws counted over `seconds` of 60 Hz frames from `start`. */
function drawsOver(seconds: number, start = 10_000): number {
  drawn.length = 0;
  for (let i = 1; i <= seconds * 60; i++)
    for (const item of items) item.frame(start + (i * 1000) / 60, 1 / 60);
  return drawn.length;
}

describe('how often the Lens is drawn', () => {
  it('draws a resting Lens, ready or muted, 15 times a second', () => {
    const root = themed(false);
    const { rerender } = render(<Lens name="Kira" state="ready" />, { container: root });
    expect(drawsOver(1)).toBe(15);
    rerender(<Lens name="Kira" state="muted" />);
    // The blend to muted draws every frame until it settles.
    drawsOver(3);
    expect(drawsOver(1, 20_000)).toBe(15);
    root.remove();
  });

  it('draws a moving Lens on every frame', () => {
    const root = themed(false);
    const { rerender } = render(<Lens name="Kira" state="listening" />, { container: root });
    expect(drawsOver(1)).toBe(60);
    rerender(<Lens name="Kira" state="speaking" />);
    expect(drawsOver(1, 20_000)).toBe(60);
    root.remove();
  });

  it('draws a still Lens once and then only when something changes', async () => {
    const root = themed(true);
    const { rerender } = render(<Lens name="Kira" state="muted" />, { container: root });
    expect(drawsOver(1)).toBe(1);
    expect(drawsOver(1, 20_000)).toBe(0);
    // A theme change on the root draws the new palette at once.
    root.classList.add('convai-contrast');
    await settle();
    expect(drawsOver(1, 30_000)).toBe(1);
    // Ready breathes under Reduce Motion too: it rests, never stills.
    rerender(<Lens name="Kira" state="ready" />);
    drawsOver(1, 40_000);
    expect(drawsOver(1, 50_000)).toBe(15);
    root.remove();
  });

  it('draws a state change on the very next frame', () => {
    const root = themed(false);
    const { rerender } = render(<Lens name="Kira" state="ready" />, { container: root });
    drawsOver(1);
    rerender(<Lens name="Kira" state="speaking" />);
    drawn.length = 0;
    for (const item of items) item.frame(11_001, 1 / 60);
    expect(drawn).toHaveLength(1);
    root.remove();
  });

  it('draws at once when the pixel ratio changes, since sizing the canvas clears it', () => {
    const listeners: (() => void)[] = [];
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: (_: string, listener: () => void) => listeners.push(listener),
        removeEventListener: vi.fn(),
      })),
    );
    const root = themed(true);
    render(<Lens name="Kira" state="muted" />, { container: root });
    drawsOver(1);
    for (const listener of listeners.splice(0)) listener();
    expect(drawsOver(1, 20_000)).toBe(1);
    root.remove();
  });

  it('tells the loop how long it can wait: not at all moving, a rest, forever still', () => {
    const root = themed(true);
    const { rerender } = render(<Lens name="Kira" state="speaking" />, { container: root });
    const waits = (now: number) => items.map((item) => item.frame(now, 1 / 60));
    expect(waits(5_000)).toEqual([0]);
    rerender(<Lens name="Kira" state="muted" />);
    drawsOver(2, 60_000);
    expect(waits(90_000)).toEqual([Infinity]);
    rerender(<Lens name="Kira" state="ready" />);
    drawsOver(2, 100_000);
    const [wait] = items.map((item) => item.frame(200_000, 1 / 60));
    expect(wait).toBeCloseTo(1000 / 15, 0);
    root.remove();
  });

  it('wakes a waiting loop on a new state and when it comes back on screen', () => {
    const root = themed(true);
    const { rerender } = render(<Lens name="Kira" state="muted" />, { container: root });
    drawsOver(1);
    loop.wakes = 0;
    rerender(<Lens name="Kira" state="ready" />);
    expect(loop.wakes).toBeGreaterThan(0);
    loop.wakes = 0;
    seen([{ isIntersecting: false }]);
    seen([{ isIntersecting: true }]);
    expect(loop.wakes).toBeGreaterThan(0);
    // Back on screen it draws on its next frame, though it is still.
    rerender(<Lens name="Kira" state="muted" />);
    drawsOver(1, 300_000);
    seen([{ isIntersecting: true }]);
    expect(drawsOver(1 / 60, 400_000)).toBe(1);
    root.remove();
  });
});
