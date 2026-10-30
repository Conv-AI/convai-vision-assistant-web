import { describe, expect, it } from 'vitest';
import type { Turn } from '../session/turns';
import {
  captionFor,
  captionHoldMs,
  charactersPerSecond,
  lines,
  pageAt,
  pages,
  questionLine,
} from './captions';

// Every character is 10 wide, so a 100-wide line holds 10 characters.
const measure = (text: string) => text.length * 10;

describe('lines', () => {
  it('breaks at spaces before the width', () => {
    expect(lines('one two three four five', measure, 100)).toEqual([
      'one two',
      'three four',
      'five',
    ]);
  });

  it('lets a word wider than the line stand alone', () => {
    expect(lines('a extraordinarily b', measure, 100)).toEqual(['a', 'extraordinarily', 'b']);
  });

  it('gives nothing for empty text', () => {
    expect(lines('   ', measure, 100)).toEqual([]);
  });
});

describe('pages', () => {
  it('groups two lines a page and knows where each starts', () => {
    expect(pages('one two three four five six', measure, 100)).toEqual([
      { text: 'one two three four', lines: ['one two', 'three four'], start: 0 },
      { text: 'five six', lines: ['five six'], start: 19 },
    ]);
  });
});

describe('pageAt', () => {
  it('turns to a page once the voice has reached its start', () => {
    const starts = [0, 30, 60];
    const msFor = (chars: number) => (chars / charactersPerSecond) * 1000;
    expect(pageAt(starts, 0)).toBe(0);
    expect(pageAt(starts, msFor(29))).toBe(0);
    expect(pageAt(starts, msFor(30))).toBe(1);
    expect(pageAt(starts, msFor(1000))).toBe(2);
  });
});

describe('questionLine', () => {
  it('keeps a question that fits', () => {
    expect(questionLine('What is this?', measure, 200)).toBe('What is this?');
  });

  it('keeps the end of a long question after an ellipsis', () => {
    expect(questionLine('Can you compare August with July?', measure, 120)).toBe('…with July?');
  });

  it('keeps at least the last word', () => {
    expect(questionLine('Supercalifragilistic', measure, 50)).toBe('…Supercalifragilistic');
  });
});

describe('captionFor', () => {
  const turn: Turn = {
    kind: 'turn',
    id: 1,
    question: 'What is this?',
    input: 'typed',
    at: 0,
    reply: 'A ceramic mug.',
    replyId: 'r1',
    status: 'done',
  };
  const at = (talk: 'ready' | 'thinking' | 'speaking' | 'held', talkSince: number) => ({
    talk,
    talkSince,
    spokeUntil: talk === 'speaking' ? 0 : talkSince,
  });

  it('shows nothing when captions are off or there is no turn', () => {
    expect(captionFor(at('speaking', 0), turn, 'off', 10)).toBeNull();
    expect(captionFor(at('speaking', 0), undefined, 'on', 10)).toBeNull();
  });

  it('follows the voice while the character speaks', () => {
    expect(captionFor(at('speaking', 1000), turn, 'on', 3000)).toEqual({
      turn,
      spokenMs: 2000,
      answer: true,
    });
  });

  it('shows the question alone while the reply is on its way', () => {
    expect(
      captionFor(at('thinking', 0), { ...turn, status: 'waiting', reply: '' }, 'on', 1),
    ).toEqual({
      turn: { ...turn, status: 'waiting', reply: '' },
      spokenMs: 0,
      answer: false,
    });
  });

  it('holds the last page for a moment after the voice ends, then lets it go', () => {
    expect(captionFor(at('ready', 1000), turn, 'on', 1000 + captionHoldMs - 1)).toEqual({
      turn,
      spokenMs: Infinity,
      answer: true,
    });
    expect(captionFor(at('ready', 1000), turn, 'on', 1000 + captionHoldMs)).toBeNull();
  });

  it('never brings a finished page back when the person talks again later (T6)', () => {
    const later = { talk: 'held' as const, talkSince: 9000, spokeUntil: 1000 };
    expect(captionFor(later, turn, 'on', 9100)).toBeNull();
  });
});
