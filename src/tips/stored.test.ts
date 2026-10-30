import { describe, expect, it } from 'vitest';
import { TipsStore } from './stored';

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe('TipsStore', () => {
  it('keeps the tips on the device under va.tips', () => {
    const storage = memory();
    const store = new TipsStore(storage);
    expect(store.startSession()).toBe(1);
    store.learn('talk');
    store.shown('stop', 1);
    store.addAnswer();
    const again = new TipsStore(storage);
    expect(storage.values.has('va.tips')).toBe(true);
    expect(again.sessions).toBe(1);
    expect(again.answers).toBe(1);
    expect(again.isLearned('talk')).toBe(true);
    expect(again.isDue('talk', 2)).toBe(false);
    expect(again.isDue('stop', 1)).toBe(false);
    expect(again.isDue('stop', 2)).toBe(true);
  });

  it('shows a tip at most twice, never twice in one session', () => {
    const store = new TipsStore(memory());
    expect(store.isDue('type', 1)).toBe(true);
    store.shown('type', 1);
    expect(store.isDue('type', 1)).toBe(false);
    store.shown('type', 2);
    expect(store.isDue('type', 3)).toBe(false);
  });

  it('skips a tip for one session only', () => {
    const store = new TipsStore(memory());
    store.skip('talk', 1);
    expect(store.isDue('talk', 1)).toBe(false);
    expect(store.isDue('talk', 2)).toBe(true);
  });

  it('makes every tip new again on reset, keeping the sessions', () => {
    const storage = memory();
    const store = new TipsStore(storage);
    store.startSession();
    store.startSession();
    store.learn('quick');
    store.shown('talk', 2);
    store.addAnswer();
    store.reset();
    expect(store.isDue('quick', 2)).toBe(true);
    expect(store.isDue('talk', 2)).toBe(true);
    expect(store.answers).toBe(0);
    expect(new TipsStore(storage).sessions).toBe(2);
  });

  it('reads what an e2e test seeds: partial records, all learned', () => {
    const learned = { learned: true };
    const store = new TipsStore(
      memory({
        'va.tips': JSON.stringify({
          sessions: 1,
          answers: 0,
          tips: { talk: learned, quick: learned },
        }),
      }),
    );
    expect(store.isLearned('talk')).toBe(true);
    expect(store.isLearned('quick')).toBe(true);
    expect(store.isDue('stop', 2)).toBe(true);
  });

  it('starts afresh from anything it cannot read, and lasts for the page without storage', () => {
    for (const text of ['not json', 'null', '7', '{"sessions":-1,"tips":null}']) {
      const store = new TipsStore(memory({ 'va.tips': text }));
      expect(store.sessions).toBe(0);
      expect(store.isDue('talk', 1)).toBe(true);
    }
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const store = new TipsStore(blocked);
    store.learn('talk');
    expect(store.isLearned('talk')).toBe(true);
    expect(new TipsStore(null).startSession()).toBe(1);
  });
});
