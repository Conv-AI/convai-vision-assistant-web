import { describe, expect, it, vi } from 'vitest';
import { animate, followVoice, wake } from './loop';

/** A window whose animation frames come only when the test says so, 16 ms apart. */
function fakeWindow() {
  let queue: FrameRequestCallback[] = [];
  let timers = new Map<number, { at: number; run: () => void }>();
  let id = 0;
  let now = 0;
  const view = {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      queue.push(callback);
      return queue.length;
    },
    setTimeout: (run: () => void, ms: number) => {
      timers.set(++id, { at: now + ms, run });
      return id;
    },
    clearTimeout: (timer: number) => {
      timers.delete(timer);
    },
  };
  const frame = () => {
    now += 16;
    const ended = [...timers].filter(([, t]) => t.at <= now);
    timers = new Map([...timers].filter(([, t]) => t.at > now));
    for (const [, t] of ended) t.run();
    const due = queue;
    queue = [];
    for (const callback of due) callback(now);
  };
  return { view, frame, waiting: () => queue.length, timers: () => timers.size };
}

describe('the Lens loop', () => {
  it('draws an item on its own window’s frames, whatever another window does', () => {
    const page = fakeWindow();
    const compact = fakeWindow();
    const onPage = { visible: true, frame: vi.fn(() => 0) };
    const inCompact = { visible: true, frame: vi.fn(() => 0) };
    const stopPage = animate(onPage, page.view);
    const stopCompact = animate(inCompact, compact.view);
    // The page's tab is hidden: its frames stop, the Compact window's keep coming.
    compact.frame();
    compact.frame();
    expect(inCompact.frame).toHaveBeenCalledTimes(2);
    expect(onPage.frame).not.toHaveBeenCalled();
    page.frame();
    expect(onPage.frame).toHaveBeenCalledTimes(1);
    expect(inCompact.frame).toHaveBeenCalledTimes(2);
    stopPage();
    stopCompact();
    page.frame();
    compact.frame();
    expect(page.waiting()).toBe(0);
    expect(compact.waiting()).toBe(0);
  });

  it('steps a voice once per frame of the window that follows it', () => {
    const compact = fakeWindow();
    const source = { sample: vi.fn(() => ({ level: 0.5, onset: false })) };
    const [, releaseA] = followVoice(source, compact.view);
    const [, releaseB] = followVoice(source, compact.view);
    const stop = animate({ visible: true, frame: () => 0 }, compact.view);
    compact.frame();
    expect(source.sample).toHaveBeenCalledTimes(1);
    releaseA();
    releaseB();
    stop();
  });

  it('skips an item while it is off screen', () => {
    const page = fakeWindow();
    const item = { visible: false, frame: vi.fn(() => 0) };
    const stop = animate(item, page.view);
    page.frame();
    expect(item.frame).not.toHaveBeenCalled();
    stop();
  });

  it('asks for no frame while every item is still, until one wakes it', () => {
    const page = fakeWindow();
    const item = { visible: true, frame: vi.fn(() => Infinity) };
    const stop = animate(item, page.view);
    page.frame();
    for (let i = 0; i < 60; i++) page.frame();
    expect(item.frame).toHaveBeenCalledTimes(1);
    expect(page.waiting() + page.timers()).toBe(0);
    wake(page.view);
    page.frame();
    expect(item.frame).toHaveBeenCalledTimes(2);
    stop();
  });

  it('waits for a resting item with a timer, not every frame', () => {
    const page = fakeWindow();
    const item = { visible: true, frame: vi.fn(() => 1000 / 15) };
    const stop = animate(item, page.view);
    for (let i = 0; i < 60; i++) page.frame();
    // About 15 draws in 60 frames of 16 ms; every frame would be 60.
    expect(item.frame.mock.calls.length).toBeGreaterThanOrEqual(12);
    expect(item.frame.mock.calls.length).toBeLessThanOrEqual(16);
    stop();
  });

  it('draws on the next frame when woken during a wait', () => {
    const page = fakeWindow();
    const item = { visible: true, frame: vi.fn(() => 1000) };
    const stop = animate(item, page.view);
    page.frame();
    expect(page.timers()).toBe(1);
    wake(page.view);
    expect(page.timers()).toBe(0);
    page.frame();
    expect(item.frame).toHaveBeenCalledTimes(2);
    stop();
  });

  it('starts again for a new item after the last one stopped during a wait', () => {
    const page = fakeWindow();
    const stop = animate({ visible: true, frame: () => 1000 }, page.view);
    page.frame();
    stop();
    const next = { visible: true, frame: vi.fn(() => 0) };
    const stopNext = animate(next, page.view);
    page.frame();
    page.frame();
    expect(next.frame).toHaveBeenCalledTimes(2);
    stopNext();
  });

  it('asks for no frame while every item is off screen', () => {
    const page = fakeWindow();
    const stop = animate({ visible: false, frame: () => 0 }, page.view);
    page.frame();
    expect(page.waiting() + page.timers()).toBe(0);
    stop();
  });

  it('ticks once a frame however often it is woken', () => {
    const page = fakeWindow();
    const item = { visible: true, frame: vi.fn(() => Infinity) };
    const stop = animate(item, page.view);
    page.frame();
    wake(page.view);
    wake(page.view);
    page.frame();
    page.frame();
    expect(item.frame).toHaveBeenCalledTimes(2);
    stop();
  });

  it('steps the first frame after a wait by at most 50 ms', () => {
    const page = fakeWindow();
    const steps: number[] = [];
    const stop = animate(
      {
        visible: true,
        frame: (_now, dt) => {
          steps.push(dt);
          return 1000;
        },
      },
      page.view,
    );
    for (let i = 0; i < 70; i++) page.frame();
    expect(steps.length).toBeGreaterThan(1);
    expect(Math.max(...steps)).toBeLessThanOrEqual(0.05);
    stop();
  });
});
