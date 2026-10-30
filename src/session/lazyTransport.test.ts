import { describe, expect, it, vi } from 'vitest';
import { LazyTransport } from './lazyTransport';
import { FakeTransport } from './test/fakeTransport';

describe('LazyTransport', () => {
  it('loads its transport on the first connect, once, and passes its events on', async () => {
    const inner = new FakeTransport();
    const load = vi.fn(() => Promise.resolve(inner));
    const lazy = new LazyTransport(load);
    const events: unknown[] = [];
    lazy.subscribe((event) => events.push(event));
    expect(load).not.toHaveBeenCalled();

    expect(lazy.sendText('Too early')).toBe(false);

    const connecting = lazy.connect({ token: 't', characterId: 'c' });
    await vi.waitFor(() => {
      expect(inner.connects).toHaveLength(1);
    });
    await inner.accept();
    await connecting;
    void lazy.connect({ token: 't2', characterId: 'c' });
    await vi.waitFor(() => {
      expect(inner.connects).toHaveLength(2);
    });
    expect(load).toHaveBeenCalledOnce();

    inner.emit({ type: 'activity', activity: 'speaking' });
    expect(events).toEqual([{ type: 'activity', activity: 'speaking' }]);
    expect(lazy.sendText('Hello')).toBe(true);
    expect(inner.sent).toEqual(['Hello']);
    inner.sends = 'drop';
    expect(lazy.sendText('Dropped')).toBe(false);
  });

  it('starts loading when asked to prepare, and a connect after it loads nothing again', async () => {
    const inner = new FakeTransport();
    const load = vi.fn(() => Promise.resolve(inner));
    const lazy = new LazyTransport(load);

    lazy.prepare();
    lazy.prepare();
    expect(load).toHaveBeenCalledOnce();
    expect(inner.connects).toEqual([]);

    void lazy.connect({ token: 't', characterId: 'c' });
    await vi.waitFor(() => {
      expect(inner.connects).toHaveLength(1);
    });
    expect(load).toHaveBeenCalledOnce();
  });

  it('leaves a load that failed while preparing for the connect to report', async () => {
    const lazy = new LazyTransport(() => Promise.reject(new Error('chunk failed')));
    lazy.prepare();
    // Nothing waits for the load yet, as while the token is fetched: it must not go unhandled.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(lazy.connect({ token: 't', characterId: 'c' })).rejects.toThrow('chunk failed');
  });

  it('is silent and refuses the microphone before anything is loaded', async () => {
    const lazy = new LazyTransport(() => Promise.resolve(new FakeTransport()));

    expect(lazy.characterLevel.sample(0)).toEqual({ level: 0, onset: false });
    await expect(lazy.setMicrophone(true)).resolves.toBe('blocked');
    await expect(lazy.microphonePermission()).resolves.toBe('prompt');
    await expect(lazy.disconnect()).resolves.toBeUndefined();
  });
});
