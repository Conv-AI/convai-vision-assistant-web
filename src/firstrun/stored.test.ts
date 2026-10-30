import { describe, expect, it } from 'vitest';
import { FirstRunStore } from './stored';

function memory(values: Record<string, string> = {}) {
  const map = new Map(Object.entries(values));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe('FirstRunStore', () => {
  it('starts with nothing chosen and T', () => {
    const store = new FirstRunStore(memory());
    expect(store.isDone).toBe(false);
    expect(store.talkMode).toBeNull();
    expect(store.talkKey).toBe('t');
  });

  it('keeps what was chosen on the device', () => {
    const storage = memory();
    const store = new FirstRunStore(storage);
    store.markDone();
    store.setTalkMode('hands-free');
    store.setTalkKey('g');
    expect(Object.fromEntries(storage.map)).toEqual({
      'va.first-run-done': '1',
      'va.talk-mode': 'hands-free',
      'va.talk-key': 'g',
    });
    const again = new FirstRunStore(storage);
    expect([again.isDone, again.talkMode, again.talkKey]).toEqual([true, 'hands-free', 'g']);
  });

  it('ignores values it did not write', () => {
    const store = new FirstRunStore(
      memory({ 'va.first-run-done': 'yes', 'va.talk-mode': 'loud', 'va.talk-key': 'Shift' }),
    );
    expect([store.isDone, store.talkMode, store.talkKey]).toEqual([false, null, 't']);
  });

  it('works for the page where storage throws', () => {
    const store = new FirstRunStore({
      getItem: () => {
        throw new Error('off');
      },
      setItem: () => {
        throw new Error('off');
      },
    });
    store.markDone();
    store.setTalkKey('q');
    expect([store.isDone, store.talkKey]).toEqual([true, 'q']);
  });
});

describe('FirstRunStore: the talk key Settings changes', () => {
  it('keeps "/" and a talk key left without one, and refuses what can be no key', () => {
    const storage = memory();
    const store = new FirstRunStore(storage);
    store.setTalkKey('/');
    expect(store.talkKey).toBe('/');
    store.setTalkKey('');
    expect(store.talkKey).toBe('');
    expect(storage.map.get('va.talk-key')).toBe('');
    expect(new FirstRunStore(storage).talkKey).toBe('');
    store.setTalkKey('F5');
    store.setTalkKey('ab');
    expect(store.talkKey).toBe('');
  });

  it('tells its listeners of each real change', () => {
    const store = new FirstRunStore(memory());
    let told = 0;
    store.subscribe(() => {
      told++;
    });
    store.setTalkKey('g');
    store.setTalkKey('g');
    store.setTalkMode('hands-free');
    store.setTalkMode('hands-free');
    store.markDone();
    expect(told).toBe(3);
  });
});

describe('FirstRunStore: where the character stays', () => {
  it('keeps the mode chosen, and reads nothing it did not write', () => {
    const storage = memory();
    const store = new FirstRunStore(storage);
    expect(store.windowMode).toBeNull();
    let told = 0;
    store.subscribe(() => {
      told++;
    });
    store.setWindowMode('compact');
    store.setWindowMode('compact');
    expect(told).toBe(1);
    expect(storage.map.get('va.window-mode')).toBe('compact');
    expect(new FirstRunStore(storage).windowMode).toBe('compact');
    store.setWindowMode('full');
    expect(new FirstRunStore(storage).windowMode).toBe('full');
    expect(new FirstRunStore(memory({ 'va.window-mode': 'sidebar' })).windowMode).toBeNull();
  });
});
