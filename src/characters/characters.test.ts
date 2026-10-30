import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Character } from '../credentials/characters';
import {
  columnsFor,
  dotWindow,
  dotsFor,
  galleryFor,
  gridsOf,
  initialOf,
  matches,
  moveInGrid,
  stageOrder,
  type Gallery,
} from './gallery';
import { languageWords, ownName, spokenLanguages } from './languages';
import { CharacterList, loadGiveUpMs } from './list';
import { RecentCharacters } from './recent';

const who = (id: string, name: string | null, languages: string[] = []): Character => ({
  id,
  name,
  languages,
  portrait: null,
});

const kira = who('k', 'Kira', ['en-US']);
const elena = who('e', 'Elena', ['es-ES', 'en-US']);
const marcus = who('m', 'Marcus', ['de-DE']);
const nine = [kira, elena, marcus, who('a', 'Aria'), who('j', 'Julia'), who('l', 'Lyra')];

const names = (cards: readonly { name: string }[]) => cards.map((card) => card.name);

/** 26 characters, one per letter A–Z, the current one "Kira". */
const many = Array.from({ length: 26 }, (_, i) => {
  const letter = String.fromCharCode(90 - i);
  return who(`id-${letter}`, letter === 'K' ? 'Kira' : `${letter}name`);
});

describe('galleryFor, under 24 characters', () => {
  it('puts the current character first, then the app’s order (V6a)', () => {
    const gallery = galleryFor(nine, 'e', [], '', 'Character');
    expect(gallery.kind).toBe('grid');
    expect(names(gridsOf(gallery)[0] ?? [])).toEqual([
      'Elena',
      'Kira',
      'Marcus',
      'Aria',
      'Julia',
      'Lyra',
    ]);
    expect(gridsOf(gallery)[0]?.map((card) => card.current)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('shows the Recent faces only once two characters were talked to, at most three', () => {
    const one = galleryFor(nine, 'k', ['k'], '', 'Character') as Extract<Gallery, { kind: 'grid' }>;
    expect(one.faces).toEqual([]);
    const four = galleryFor(nine, 'k', ['k', 'e', 'gone', 'm', 'a'], '', 'Character') as Extract<
      Gallery,
      { kind: 'grid' }
    >;
    expect(names(four.faces)).toEqual(['Kira', 'Elena', 'Marcus']);
  });

  it('names a card the fallback when the server had no name', () => {
    const gallery = galleryFor([who('x', null)], 'x', [], '', 'Character');
    expect(names(stageOrder(gallery))).toEqual(['Character']);
  });
});

describe('galleryFor, from 24 characters (V6f)', () => {
  it('lists all characters by name with a caption over each letter’s first card', () => {
    const gallery = galleryFor(many, 'id-K', [], '', 'Character');
    expect(gallery.kind).toBe('sections');
    if (gallery.kind !== 'sections') return;
    expect(gallery.all.map((card) => card.name.slice(0, 1))).toEqual(
      Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
    );
    expect(gallery.all.every((card) => card.caption === card.name.slice(0, 1))).toBe(true);
    expect(gallery.recent).toEqual([]);
  });

  it('captions only the first card of a letter', () => {
    const list = [...many.slice(3), who('x1', 'Bea'), who('x2', 'Ben')];
    const gallery = galleryFor(list, null, [], '', 'Character');
    if (gallery.kind !== 'sections') throw new Error('sections expected');
    const bs = gallery.all.filter((card) => card.name.startsWith('B'));
    expect(bs.map((card) => [card.name, card.caption])).toEqual([
      ['Bea', 'B'],
      ['Ben', ''],
      ['Bname', ''],
    ]);
  });

  it('adds the Recent section once two characters were talked to', () => {
    const gallery = galleryFor(many, 'id-K', ['id-K', 'id-A', 'id-M'], '', 'Character');
    if (gallery.kind !== 'sections') throw new Error('sections expected');
    expect(names(gallery.recent)).toEqual(['Kira', 'Aname', 'Mname']);
    expect(gridsOf(gallery)).toHaveLength(2);
  });

  it('keeps 23 characters a plain grid and makes 24 sections', () => {
    expect(galleryFor(many.slice(0, 23), null, [], '', 'C').kind).toBe('grid');
    expect(galleryFor(many.slice(0, 24), null, [], '', 'C').kind).toBe('sections');
  });
});

describe('search (C3, C4)', () => {
  it('finds by name, any case, as one flowing grid', () => {
    const gallery = galleryFor(nine, 'k', ['k', 'e'], 'LE', 'Character');
    expect(gallery.kind).toBe('results');
    expect(names(stageOrder(gallery))).toEqual(['Elena']);
  });

  it('finds by a language’s own name and its English one', () => {
    expect(names(stageOrder(galleryFor(nine, 'k', [], 'español', 'C')))).toEqual(['Elena']);
    expect(names(stageOrder(galleryFor(nine, 'k', [], 'german', 'C')))).toEqual(['Marcus']);
    expect(names(stageOrder(galleryFor(nine, 'k', [], 'english', 'C')))).toEqual(['Kira', 'Elena']);
  });

  it('shows no captions or Recent while searching 24 or more', () => {
    const gallery = galleryFor(many, 'id-K', ['id-K', 'id-A'], 'name', 'C');
    expect(gallery.kind).toBe('results');
    expect(stageOrder(gallery).every((card) => card.caption === '')).toBe(true);
    expect(stageOrder(gallery)).toHaveLength(25);
  });

  it('finds nothing for words no character has', () => {
    expect(stageOrder(galleryFor(nine, 'k', [], 'astronomy', 'C'))).toEqual([]);
  });

  it('treats blank words as no search', () => {
    expect(galleryFor(nine, 'k', [], '   ', 'C').kind).toBe('grid');
    expect(matches(kira, 'C', ' ')).toBe(true);
  });
});

describe('initialOf', () => {
  it.each([
    ['elena', 'E'],
    [' Ömer', 'Ö'],
    ['', ''],
  ])('gives %j the monogram %j', (name, letter) => {
    expect(initialOf(name)).toBe(letter);
  });
});

describe('columnsFor', () => {
  it.each([
    [1440, 4],
    [912, 4],
    [791, 3],
    [800, 4],
    [560, 3],
    [511, 2],
  ])('fits %i wide with %i cards a row', (width, columns) => {
    expect(columnsFor(width)).toBe(columns);
  });
});

describe('moveInGrid', () => {
  const at = (index: number, grid = 0) => ({ grid, index });

  it('moves across and down a row of four', () => {
    expect(moveInGrid(at(0), 'ArrowRight', [9], 4)).toEqual(at(1));
    expect(moveInGrid(at(1), 'ArrowDown', [9], 4)).toEqual(at(5));
    expect(moveInGrid(at(5), 'ArrowUp', [9], 4)).toEqual(at(1));
    expect(moveInGrid(at(4), 'ArrowLeft', [9], 4)).toEqual(at(3));
  });

  it('stays at the edges', () => {
    expect(moveInGrid(at(0), 'ArrowLeft', [9], 4)).toEqual(at(0));
    expect(moveInGrid(at(8), 'ArrowRight', [9], 4)).toEqual(at(8));
    expect(moveInGrid(at(8), 'ArrowDown', [9], 4)).toEqual(at(8));
    expect(moveInGrid(at(2), 'ArrowUp', [9], 4)).toEqual(at(2));
  });

  it('goes to the short last row’s last card from a column it lacks', () => {
    expect(moveInGrid(at(6), 'ArrowDown', [9], 4)).toEqual(at(8));
  });

  it('goes on from Recent to All characters in the same column, and back', () => {
    expect(moveInGrid(at(2), 'ArrowDown', [3, 26], 4)).toEqual(at(2, 1));
    expect(moveInGrid(at(3, 1), 'ArrowUp', [3, 26], 4)).toEqual(at(2, 0));
    expect(moveInGrid(at(1, 1), 'ArrowUp', [3, 26], 4)).toEqual(at(1, 0));
  });

  it('takes Home and End to the first and last card', () => {
    expect(moveInGrid(at(5, 1), 'Home', [3, 26], 4)).toEqual(at(0, 0));
    expect(moveInGrid(at(0, 0), 'End', [3, 26], 4)).toEqual(at(25, 1));
  });

  it('leaves other keys alone', () => {
    expect(moveInGrid(at(3), 'Enter', [9], 4)).toEqual(at(3));
  });
});

describe('dotWindow', () => {
  it.each([
    [0, 3, 5, 0, 3],
    [3, 9, 29, 0, 9],
    [2, 9, 5, 0, 5],
    [4, 9, 5, 2, 7],
    [8, 9, 5, 4, 9],
  ])('at %i of %i with room for %i shows dots %i to %i', (index, count, room, start, end) => {
    expect(dotWindow(index, count, room)).toEqual({ start, end });
  });
});

describe('dotsFor', () => {
  it('gives every character a dot on the 420 portrait of an 880 dialog', () => {
    expect(dotsFor(1440)).toBe(29);
  });

  it('gives fewer as the dialog narrows to a 560 window', () => {
    // 528 wide: a 252 portrait.
    expect(dotsFor(560)).toBe(15);
  });
});

describe('languages', () => {
  it('names each language in English, the device’s first, once per language', () => {
    expect(spokenLanguages(['tr-TR', 'en-US', 'es-ES', 'en-GB'], 'es-MX')).toEqual([
      { lang: 'es', name: 'Spanish' },
      { lang: 'tr', name: 'Turkish' },
      { lang: 'en', name: 'English' },
    ]);
  });

  it('leaves out what is no language', () => {
    expect(spokenLanguages(['zz-ZZ', '', 'en-US'], 'en')).toEqual([
      { lang: 'en', name: 'English' },
    ]);
    expect(ownName('qq')).toBeNull();
  });

  it('finds a language by its own and its English name', () => {
    expect(languageWords('de-DE')).toEqual(['Deutsch', 'German']);
  });
});

describe('RecentCharacters', () => {
  function storage(initial: string | null = null) {
    let value = initial;
    return {
      getItem: vi.fn(() => value),
      setItem: vi.fn((_key: string, next: string) => {
        value = next;
      }),
    };
  }

  it('keeps the newest first, once each, four at most, on the device', () => {
    const store = storage();
    const recent = new RecentCharacters(store);
    for (const id of ['a', 'b', 'c', 'a', 'd', 'e']) recent.remember(id);
    expect(recent.list).toEqual(['e', 'd', 'a', 'c']);
    expect(new RecentCharacters(store).list).toEqual(['e', 'd', 'a', 'c']);
  });

  it('moves a character talked to again to the front, once', () => {
    const recent = new RecentCharacters(storage());
    for (const id of ['a', 'b', 'a']) recent.remember(id);
    expect(recent.list).toEqual(['a', 'b']);
  });

  it('writes nothing when the first is remembered again', () => {
    const store = storage('["a"]');
    new RecentCharacters(store).remember('a');
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it.each(['not json', '{"a":1}', '[1,"",null,"b","b"]'])('reads %j safely', (raw) => {
    const recent = new RecentCharacters(storage(raw));
    expect(recent.list.every((id) => id === 'b')).toBe(true);
  });

  it('works for the page without storage', () => {
    const recent = new RecentCharacters(null);
    recent.remember('a');
    expect(recent.list).toEqual(['a']);
  });
});

describe('CharacterList', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares initial discovery between Welcome and the session, then permits a fresh retry', async () => {
    const fetch = vi
      .fn<() => Promise<Character[]>>()
      .mockRejectedValueOnce(new Error('setup required'))
      .mockResolvedValue([kira]);
    const list = new CharacterList(fetch);
    await expect(list.loadInitial()).rejects.toThrow('setup required');
    await expect(list.loadInitial()).rejects.toThrow('setup required');
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(list.load()).resolves.toEqual([kira]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('loads, and shares a load that is running', async () => {
    const fetch = vi.fn(() => Promise.resolve([kira]));
    const list = new CharacterList(fetch);
    const first = list.load();
    const second = list.load();
    expect(list.state.loading).toBe(true);
    await expect(first).resolves.toEqual([kira]);
    await second;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(list.state).toEqual({ characters: [kira], loading: false, failed: false });
  });

  it('keeps the cards that loaded when a refresh fails (C5)', async () => {
    let answer: Promise<Character[]> = Promise.resolve([kira, elena]);
    const list = new CharacterList(() => answer);
    await list.load();
    answer = Promise.reject(new Error('offline'));
    await expect(list.load()).rejects.toThrow('offline');
    expect(list.state).toEqual({ characters: [kira, elena], loading: false, failed: true });
  });

  it('cancels a timed-out load, allows retry, and ignores its late answer', async () => {
    let resolve: (value: Character[]) => void = () => undefined;
    let signal: AbortSignal | undefined;
    const fetch = vi.fn((requestSignal: AbortSignal) => {
      signal = requestSignal;
      return new Promise<Character[]>((done) => {
        resolve = done;
      });
    });
    const list = new CharacterList(fetch);
    const loading = list.load();
    const rejection = expect(loading).rejects.toThrow('Loading characters took too long');
    vi.advanceTimersByTime(loadGiveUpMs - 1);
    expect(list.state.failed).toBe(false);
    vi.advanceTimersByTime(1);
    await rejection;
    expect(signal?.aborted).toBe(true);
    expect(list.state).toMatchObject({ loading: false, failed: true });
    fetch.mockImplementation(() => Promise.resolve([elena]));
    await expect(list.load()).resolves.toEqual([elena]);
    resolve([kira]);
    await Promise.resolve();
    expect(list.state).toEqual({ characters: [elena], loading: false, failed: false });
  });

  it('tells its listeners', async () => {
    const list = new CharacterList(() => Promise.resolve([kira]));
    const listener = vi.fn();
    list.subscribe(listener);
    await list.load();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
