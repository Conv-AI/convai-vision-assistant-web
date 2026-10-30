/** What stands where letters were left out. */
export const ellipsis = '…';

export const leastDocumentLetters = 6;

/** What a title has between the document and the app: an em dash, a hyphen or a bar, spaced. */
const separators = [' — ', ' - ', ' | '];

/**
 * Where the app's part of `title` starts, with its separator; -1 when it has none. The last
 * separator counts ("Page — notes - Google Chrome"), and only one with a document before it.
 */
export function appPartStart(title: string): number {
  if (title === '') return -1;
  const start = Math.max(...separators.map((separator) => title.lastIndexOf(separator)));
  return start > 0 && title.slice(0, start).trim() !== '' ? start : -1;
}

/**
 * How many letters of `document` must stand before the app's name for that name to be kept: the
 * document's first word whole, and never fewer than six.
 */
export function leastDocument(document: string): number {
  if (document === '') return leastDocumentLetters;
  const space = document.indexOf(' ');
  return Math.max(space < 0 ? document.length : space, leastDocumentLetters);
}

/**
 * The longest form of `title` that is at most `room` wide: whole where it fits; else its document
 * cut before the app's part while the least of the document stands; else the title cut at its end;
 * nothing when not one letter fits before the ellipsis, which alone would name nothing.
 */
export function fitTitle(title: string, room: number, measure: (text: string) => number): string {
  if (title === '') return '';
  if (measure(title) <= room) return title;

  const app = appPartStart(title);
  if (app > 0) {
    const document = title.slice(0, app);
    const cut = longest(
      document,
      ellipsis + title.slice(app),
      room,
      measure,
      leastDocument(document),
    );
    if (cut !== null) return cut;
  }
  return longest(title, ellipsis, room, measure, 1) ?? '';
}

/** The most letters of the head that fit with the tail after them, and at least so many; null when none does. */
function longest(
  head: string,
  tail: string,
  room: number,
  measure: (text: string) => number,
  least: number,
): string | null {
  // Fewer letters are never wider by more than a kerning pair: halve to the place, then step down to what fits.
  let low = least;
  let high = head.length - 1;
  let most = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (measure(start(head, middle) + tail) <= room) {
      most = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  for (; most >= least; most--) {
    const first = start(head, most);
    if (first.length >= least && measure(first + tail) <= room) return first + tail;
  }
  return null;
}

/** The first letters, never half of a surrogate pair, and with no space left before the ellipsis. */
function start(text: string, length: number): string {
  let end = length;
  if (end > 0 && isHighSurrogate(text.charCodeAt(end - 1))) end--;
  return text.slice(0, end).trimEnd();
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
