import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MicrophoneTest, testSeconds, type RecorderMedia } from './microphoneTest';

/** A stream whose tracks say when they are stopped. */
function stream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

/** A recorder a test drives by hand: recording ends after the timers, playing when `ended()` runs. */
function recorder(opened = stream()) {
  let ended: (() => void) | null = null;
  const open = vi.fn<(deviceId: string | null) => Promise<MediaStream>>(() =>
    Promise.resolve(opened.stream),
  );
  const play = vi.fn(
    (_recording: Blob, stop: AbortSignal) =>
      new Promise<void>((resolve) => {
        ended = resolve;
        stop.addEventListener('abort', () => {
          resolve();
        });
      }),
  );
  const media: RecorderMedia = {
    open,
    record: vi.fn(
      (_stream: MediaStream, ms: number, stop: AbortSignal) =>
        new Promise<Blob>((resolve) => {
          const done = setTimeout(() => {
            resolve(new Blob(['heard']));
          }, ms);
          stop.addEventListener('abort', () => {
            clearTimeout(done);
            resolve(new Blob());
          });
        }),
    ),
    play,
  };
  return { media, open, play, track: opened.track, ended: () => ended?.() };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the microphone test', () => {
  it('counts down three seconds of recording, plays them back, and is idle again', async () => {
    const { media, open, track, ended } = recorder();
    const test = new MicrophoneTest(media);
    const seen: string[] = [];
    test.subscribe(() => {
      const state = test.state;
      seen.push(state.phase === 'recording' ? `recording ${String(state.left)}` : state.phase);
    });
    const run = test.start('usb-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(open).toHaveBeenCalledWith('usb-1');
    expect(test.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(testSeconds * 1000);
    expect(track.stop).toHaveBeenCalled();
    expect(test.state.phase).toBe('playing');
    ended();
    await run;
    expect(seen).toEqual(['recording 3', 'recording 2', 'recording 1', 'playing', 'idle']);
  });

  it('starts once while a run is under way', async () => {
    const { media, open } = recorder();
    const test = new MicrophoneTest(media);
    void test.start(null);
    await vi.advanceTimersByTimeAsync(0);
    void test.start(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('says it failed when the microphone cannot be opened, and can be tried again', async () => {
    const { media, open } = recorder();
    open.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    const test = new MicrophoneTest(media);
    await test.start(null);
    expect(test.state.phase).toBe('failed');
    expect(test.busy).toBe(false);
    void test.start(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(test.state.phase).toBe('recording');
  });

  it('stops recording or playing at once when cancelled, and says nothing after', async () => {
    const { media, play, track } = recorder();
    const test = new MicrophoneTest(media);
    const run = test.start(null);
    await vi.advanceTimersByTimeAsync(1000);
    test.cancel();
    expect(test.state.phase).toBe('idle');
    await run;
    expect(track.stop).toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(test.state.phase).toBe('idle');

    const second = test.start(null);
    await vi.advanceTimersByTimeAsync(testSeconds * 1000);
    expect(test.state.phase).toBe('playing');
    test.cancel();
    await second;
    expect(test.state.phase).toBe('idle');
  });
});
