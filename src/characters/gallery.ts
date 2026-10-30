import type { Character } from '../credentials/characters';
import { languageWords } from './languages';

export const sectionsFrom = 24;

export const recentFrom = 2;

export const facesShown = 3;
/** The dialog's width at most, and the room it keeps from the window's edges. */
export const dialogWidth = 880;
export const dialogMargin = 16;

export interface Card {
  character: Character;
  /** The name the card shows: the character's, or the fallback when the server had none. */
  name: string;
  current: boolean;
  /** The letter over the first card of each letter in "All characters"; '' elsewhere. */
  caption: string;
}

export type Gallery =
  /** Under 24: one grid, the current character first, then the app's order; faces when known. */
  | { kind: 'grid'; cards: Card[]; faces: Card[] }
  /** From 24: Recent (when known) and All characters in name order with letter captions. */
  | { kind: 'sections'; recent: Card[]; all: Card[] }
  | { kind: 'results'; cards: Card[] };

function card(character: Character, fallback: string, currentId: string | null): Card {
  return {
    character,
    name: character.name ?? fallback,
    current: character.id === currentId,
    caption: '',
  };
}

/** The first letter a card or a monogram stands under: the name's, raised. */
export function initialOf(name: string): string {
  const point = name.trim().codePointAt(0);
  const first = point === undefined ? '' : String.fromCodePoint(point);
  return first.toLocaleUpperCase();
}

/** True when the character answers the search: its name or a language it speaks. */
export function matches(character: Character, fallback: string, query: string): boolean {
  const wanted = query.trim().toLocaleLowerCase();
  if (wanted === '') return true;
  const words = [character.name ?? fallback, ...character.languages.flatMap(languageWords)];
  return words.some((word) => word.toLocaleLowerCase().includes(wanted));
}

/** The recent characters still offered, newest first. */
function recentCards(cards: readonly Card[], recent: readonly string[]): Card[] {
  return recent
    .map((id) => cards.find((one) => one.character.id === id))
    .filter((one): one is Card => one !== undefined);
}

export function galleryFor(
  characters: readonly Character[],
  currentId: string | null,
  recent: readonly string[],
  query: string,
  fallback: string,
): Gallery {
  const all = characters.map((character) => card(character, fallback, currentId));
  const known = recentCards(all, recent);
  if (characters.length >= sectionsFrom) {
    const byName = [...all].sort((a, b) => a.name.localeCompare(b.name));
    if (query.trim() !== '') {
      return {
        kind: 'results',
        cards: byName.filter((one) => matches(one.character, fallback, query)),
      };
    }
    let previous = '';
    const lettered = byName.map((one) => {
      const letter = initialOf(one.name);
      const caption = letter !== previous ? letter : '';
      previous = letter;
      return { ...one, caption };
    });
    return {
      kind: 'sections',
      recent: known.length >= recentFrom ? known : [],
      all: lettered,
    };
  }
  const ordered = [...all.filter((one) => one.current), ...all.filter((one) => !one.current)];
  if (query.trim() !== '') {
    return {
      kind: 'results',
      cards: ordered.filter((one) => matches(one.character, fallback, query)),
    };
  }
  return {
    kind: 'grid',
    cards: ordered,
    faces: known.length >= recentFrom ? known.slice(0, facesShown) : [],
  };
}

/** The gallery's grids, top to bottom, as the arrow keys walk them. */
export function gridsOf(gallery: Gallery): Card[][] {
  switch (gallery.kind) {
    case 'grid':
    case 'results':
      return [gallery.cards];
    case 'sections':
      return gallery.recent.length > 0 ? [gallery.recent, gallery.all] : [gallery.all];
  }
}

/** The characters in the order the stage's arrows and dots step through: the gallery's own. */
export function stageOrder(gallery: Gallery): Card[] {
  switch (gallery.kind) {
    case 'grid':
    case 'results':
      return gallery.cards;
    case 'sections':
      return gallery.all;
  }
}

export function columnsFor(windowWidth: number): number {
  const width = Math.min(dialogWidth, windowWidth - 2 * dialogMargin);
  if (width >= 760) return 4;
  if (width >= 480) return 3;
  return 2;
}

export interface GridPlace {
  grid: number;
  index: number;
}

/**
 * Where an arrow key (or Home, End) moves the focus. Down past a grid's last row goes on to the
 * next grid's first row in the same column, and Up back; a move with nowhere to go stays.
 */
export function moveInGrid(
  place: GridPlace,
  key: string,
  sizes: readonly number[],
  columns: number,
): GridPlace {
  const size = sizes[place.grid] ?? 0;
  const column = place.index % columns;
  switch (key) {
    case 'ArrowRight':
      return place.index + 1 < size ? { ...place, index: place.index + 1 } : place;
    case 'ArrowLeft':
      return place.index > 0 ? { ...place, index: place.index - 1 } : place;
    case 'ArrowDown': {
      if (place.index + columns < size) return { ...place, index: place.index + columns };
      // A last row that is short: from a column it lacks below, the row's last card.
      const lastRowStart = size - (size % columns || columns);
      if (place.index < lastRowStart) return { ...place, index: size - 1 };
      const next = sizes[place.grid + 1];
      return next ? { grid: place.grid + 1, index: Math.min(column, next - 1) } : place;
    }
    case 'ArrowUp': {
      if (place.index - columns >= 0) return { ...place, index: place.index - columns };
      const previous = sizes[place.grid - 1];
      if (!previous) return place;
      const lastRowStart = previous - (previous % columns || columns);
      return { grid: place.grid - 1, index: Math.min(lastRowStart + column, previous - 1) };
    }
    case 'Home':
      return { grid: 0, index: 0 };
    case 'End': {
      const last = sizes.length - 1;
      return { grid: last, index: Math.max(0, (sizes[last] ?? 1) - 1) };
    }
    default:
      return place;
  }
}

export function dotsFor(windowWidth: number): number {
  const dialog = Math.min(dialogWidth, windowWidth - 2 * dialogMargin);
  const portrait = (dialog * 420) / dialogWidth;
  return Math.max(1, Math.floor((portrait - 2 * 16 - 2 * 13 - 18) / 12) + 1);
}

export function dotWindow(
  index: number,
  count: number,
  room: number,
): { start: number; end: number } {
  if (count <= room) return { start: 0, end: count };
  const start = Math.min(Math.max(0, index - Math.floor(room / 2)), count - room);
  return { start, end: start + room };
}
