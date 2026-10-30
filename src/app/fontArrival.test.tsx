import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '../session/session';
import type { Turn } from '../session/turns';
import type { VisionState } from '../vision/vision';
import { SourceChip } from './SourceChip';
import { chipMaxWidth } from './sources';
import { Captions } from './Stage';

// Inter loads one script at a time, so words in letters whose file has not come yet are measured in
// the narrower fallback font first. Each part that cuts shown words by measuring them must measure
// again when a font file arrives. Here a canvas measures 7 a letter until "Inter" arrives, then 9.

let interArrived = false;
const fontListeners = new Set<() => void>();

class StillResizeObserver {
  observe(): void {
    // jsdom lays nothing out.
  }
  disconnect(): void {
    // Nothing to stop.
  }
}

beforeEach(() => {
  interArrived = false;
  vi.stubGlobal('ResizeObserver', StillResizeObserver);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        font: '',
        measureText: (text: string) => ({ width: text.length * (interArrived ? 9 : 7) }),
      }) as unknown as CanvasRenderingContext2D,
  );
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      addEventListener: (_type: string, listener: () => void) => fontListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => fontListeners.delete(listener),
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(document, 'fonts');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function interArrives() {
  act(() => {
    interArrived = true;
    for (const listener of [...fontListeners]) listener();
  });
}

const name = 'Мама мыла раму, '.repeat(6).trim();

describe('words measured before their font arrived', () => {
  it('the source chip cuts its name again', () => {
    const vision = {
      share: 'none',
      source: null,
      stream: null,
      showStarting: false,
      slow: false,
      failure: { cause: name },
      stopped: false,
      cameras: [],
      crop: null,
      paused: false,
    } as unknown as VisionState;
    const { container } = render(
      <SourceChip
        vision={vision}
        failureShows
        menuOpen={false}
        onMenu={() => undefined}
        chipRef={{ current: null }}
        room={chipMaxWidth(1200)}
      />,
    );
    const shown = () => container.querySelector('.va-chip__name')?.textContent ?? '';
    const before = shown();
    expect(before.endsWith('…')).toBe(true);
    interArrives();
    expect(shown().endsWith('…')).toBe(true);
    expect(shown().length).toBeLessThan(before.length);
  });

  it('the caption cuts its question line again', () => {
    const turn: Turn = {
      kind: 'turn',
      id: 1,
      question: name,
      input: 'typed',
      at: 0,
      reply: '',
      replyId: null,
      status: 'waiting',
    };
    const state = { talk: 'thinking', talkSince: 0, spokeUntil: 0, items: [turn] };
    const { container } = render(
      <Captions state={state as unknown as SessionState} mode="on" width={496} />,
    );
    const shown = () => container.querySelector('.va-captions__question')?.textContent ?? '';
    const before = shown();
    expect(before.startsWith('…')).toBe(true);
    interArrives();
    expect(shown().startsWith('…')).toBe(true);
    expect(shown().length).toBeLessThan(before.length);
  });
});
