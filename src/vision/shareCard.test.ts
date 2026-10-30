import { describe, expect, it } from 'vitest';
import { ShareCard, shareCardLines } from './shareCard';

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

describe('ShareCard', () => {
  it('is due the first two times, then never again, and keeps the count on the device', () => {
    const storage = new MemoryStorage();
    const card = new ShareCard(storage);
    expect(card.isDue).toBe(true);
    card.countShown();
    expect(card.isDue).toBe(true);
    card.countShown();
    expect(card.isDue).toBe(false);
    card.countShown();
    expect(storage.getItem(ShareCard.storageKey)).toBe('2');

    expect(new ShareCard(storage).isDue).toBe(false);
  });

  it('remembers one showing across visits', () => {
    const storage = new MemoryStorage();
    new ShareCard(storage).countShown();
    const next = new ShareCard(storage);
    expect(next.isDue).toBe(true);
    next.countShown();
    expect(next.isDue).toBe(false);
  });

  it('still stops after two in one visit when the device keeps nothing', () => {
    const refusing = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('blocked');
      },
    };
    for (const storage of [refusing, null]) {
      const card = new ShareCard(storage);
      card.countShown();
      card.countShown();
      expect(card.isDue).toBe(false);
    }
  });

  it('reads a stored count it does not understand as none', () => {
    const storage = new MemoryStorage();
    storage.setItem(ShareCard.storageKey, 'many');
    expect(new ShareCard(storage).isDue).toBe(true);
  });
});

describe('shareCardLines', () => {
  it('says why, then the row’s own sentence (answers 2026-10-15 §B)', () => {
    expect(shareCardLines('Kira', 'screen')).toEqual([
      'Kira sees only what you share.',
      'Choose Entire screen.',
    ]);
    expect(shareCardLines('Kira', 'window')).toEqual([
      'Kira sees only what you share.',
      'Choose Window.',
    ]);
    expect(shareCardLines('Kira', 'tab')).toEqual([
      'Kira sees only what you share.',
      'A tab gives Kira the sharpest view.',
    ]);
  });

  it('stands without a name', () => {
    expect(shareCardLines(' ', 'tab')).toEqual([
      'Only what you share is seen.',
      'A tab gives the sharpest view.',
    ]);
  });
});
