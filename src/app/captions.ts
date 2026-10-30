import type { SessionState } from '../session/session';
import type { Turn } from '../session/turns';
import type { CaptionMode } from './layout';

export type Measure = (text: string) => number;

export const captionWidth = 560;

/** The answer is read at about this many characters a second, to turn its pages with the voice. */
export const charactersPerSecond = 15;
/** A finished caption stays this long after the voice ends, unless a pinned column holds the words. */
export const captionHoldMs = 4000;

/** Breaks `text` into lines no wider than `width`, at spaces; a word wider than a line stands alone. */
export function lines(text: string, measure: Measure, width: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const result: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > width) {
      result.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) result.push(line);
  return result;
}

/** The answer in pages of `perPage` lines, each page with where it starts in the text. */
export function pages(
  text: string,
  measure: Measure,
  width: number,
  perPage = 2,
): { text: string; lines: string[]; start: number }[] {
  const all = lines(text, measure, width);
  const result: { text: string; lines: string[]; start: number }[] = [];
  let start = 0;
  for (let i = 0; i < all.length; i += perPage) {
    const pageLines = all.slice(i, i + perPage);
    const page = pageLines.join(' ');
    result.push({ text: page, lines: pageLines, start });
    start += page.length + 1;
  }
  return result;
}

/** The page the voice has reached after `spokenMs` of speaking; the last one once it has passed it. */
export function pageAt(starts: readonly number[], spokenMs: number): number {
  const reached = (spokenMs / 1000) * charactersPerSecond;
  let index = 0;
  starts.forEach((start, i) => {
    if (start <= reached) index = i;
  });
  return index;
}

export function questionLine(text: string, measure: Measure, width: number): string {
  const whole = text.trim();
  if (measure(whole) <= width) return whole;
  const words = whole.split(/\s+/);
  let tail = '';
  for (let i = words.length - 1; i >= 0; i--) {
    const next = tail ? `${words[i] ?? ''} ${tail}` : (words[i] ?? '');
    if (measure(`…${next}`) > width) break;
    tail = next;
  }
  return `…${tail || (words.at(-1) ?? '')}`;
}

/** What the caption shows now: the turn, the page of its answer, or nothing. */
export function captionFor(
  state: Pick<SessionState, 'talk' | 'talkSince' | 'spokeUntil'>,
  turn: Turn | undefined,
  mode: CaptionMode,
  now: number,
): { turn: Turn; spokenMs: number; answer: boolean } | null {
  if (!turn || mode === 'off') return null;
  const answering = state.talk === 'thinking' || state.talk === 'speaking';
  const fresh = turn.status === 'waiting' || turn.status === 'streaming';
  if (state.talk === 'speaking') return { turn, spokenMs: now - state.talkSince, answer: true };
  if (answering || fresh) return { turn, spokenMs: 0, answer: false };
  // Finished: the last page holds for a moment after the voice ends, then goes.
  // Counted from the voice's end, so talking again later never brings an old page back.
  if (state.spokeUntil > 0 && now - state.spokeUntil < captionHoldMs && turn.reply !== '')
    return { turn, spokenMs: Infinity, answer: true };
  return null;
}
