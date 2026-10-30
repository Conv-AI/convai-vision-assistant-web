import { describe, expect, it } from 'vitest';
import { appPartStart, ellipsis, fitTitle, leastDocument } from './titleCut';

const board = 'Budget Q3 forecast · regional breakdown — Sheets';

/** Every letter is as wide as the next: a width is a count, and each expectation reads off the text. */
const letters = (text: string) => text.length;

/** Letters of different widths, as a proportional face has them. */
function proportional(text: string): number {
  let wide = 0;
  for (const letter of text.split('')) {
    wide +=
      letter === ' '
        ? 3
        : letter === 'i' || letter === 'l' || letter === '.'
          ? 3.5
          : letter !== letter.toLowerCase()
            ? 9
            : 6.5;
  }
  return wide;
}

const face = String.fromCodePoint(0x1f600);

describe('fitTitle', () => {
  it('shows a title that fits whole', () => {
    expect(fitTitle(board, board.length, letters)).toBe(board);
    expect(fitTitle(board, 1000, letters)).toBe(board);
    expect(fitTitle('mug.jpg', 7, letters)).toBe('mug.jpg');
  });

  it('cuts a long title inside the document, and the app’s name stays', () => {
    expect(fitTitle(board, 35, letters)).toBe('Budget Q3 forecast · regi… — Sheets');
    expect(fitTitle(board, 34, letters)).toBe('Budget Q3 forecast · reg… — Sheets');
    expect(fitTitle(board, 16, letters)).toBe('Budget… — Sheets');
  });

  it('keeps the app’s name only while the document’s first word, and six letters of it, stand before it', () => {
    // "Budget… — Sheets" is 16: one less, and the document stays and the app's name goes.
    expect(fitTitle(board, 15, letters)).toBe('Budget Q3 fore…');
    expect(fitTitle(board, 11, letters)).toBe('Budget Q3…');

    // A first word longer than six letters stands whole.
    const longWord = 'Quarterly numbers, final and reviewed | Notion';
    expect(leastDocument('Quarterly numbers, final and reviewed')).toBe(9);
    expect(fitTitle(longWord, 19, letters)).toBe('Quarterly… | Notion');
    expect(fitTitle(longWord, 18, letters)).toBe('Quarterly numbers…');

    // A first word shorter than six letters is not enough: six letters stand.
    const shortWord = 'My budget for the autumn — Sheets';
    expect(leastDocument('My budget for the autumn')).toBe(6);
    expect(fitTitle(shortWord, 16, letters)).toBe('My bud… — Sheets');
    expect(fitTitle(shortWord, 15, letters)).toBe('My budget for…');

    // A document that has no six letters cannot keep them: its title is cut at the end.
    expect(fitTitle('Inbox — Google Chrome', 17, letters)).toBe('Inbox — Google C…');
  });

  it('leaves no space before the ellipsis', () => {
    // 19 letters would end on the space after "forecast": the ellipsis follows the word.
    expect(fitTitle(board, 29, letters)).toBe('Budget Q3 forecast… — Sheets');
    expect(fitTitle(board, 28, letters)).toBe('Budget Q3 forecast… — Sheets');
  });

  it.each([
    ['Inbox (3) and a long subject line - Google Chrome', 'Inbox (3) and a… - Google Chrome'],
    ['Quarterly numbers, final | Notion', 'Quarterly numbers, fin… | Notion'],
    ['Launch plan — review notes and more - Google Chrome', 'Launch plan — r… - Google Chrome'],
    ['Launch plan - review notes and more words — Sheets', 'Launch plan - review n… — Sheets'],
    ['Report - Q3 - regional numbers - Google Chrome', 'Report - Q3 - r… - Google Chrome'],
  ])('starts the app’s name at the last separator of any kind: %s', (title, expected) => {
    expect(fitTitle(title, 32, letters)).toBe(expected);
    expect(expected).toHaveLength(32);
  });

  it('cuts a name without a separator at its end', () => {
    expect(fitTitle('Quarterly planning workbook for the launch team', 21, letters)).toBe(
      'Quarterly planning w…',
    );
    // A hyphen without spaces is no separator.
    expect(fitTitle('holiday-in-the-alps-2026-final.jpg', 19, letters)).toBe('holiday-in-the-alp…');
    expect(appPartStart('holiday-in-the-alps-2026-final.jpg')).toBe(-1);
    // Nothing stands before it: there is no document to cut.
    expect(appPartStart(' - Google Chrome')).toBe(-1);
    expect(fitTitle(' - Google Chrome', 12, letters)).toBe(' - Google C…');
  });

  it('cuts the title at its end without room for the app’s name', () => {
    // " — Sheets" with the ellipsis and the document's first word needs 16.
    expect(fitTitle(board, 10, letters)).toBe('Budget Q3…');
    expect(fitTitle(board, 2, letters)).toBe('B…');
  });

  it('shows nothing, never the ellipsis alone, without room for one letter', () => {
    expect(fitTitle(board, 1, letters)).toBe('');
    expect(fitTitle(board, 0, letters)).toBe('');
    expect(fitTitle('mug.jpg', 1.5, letters)).toBe('');
    expect(fitTitle('mug.jpg', 2, letters)).toBe('m…');
  });

  it('shows nothing for nothing', () => {
    expect(fitTitle('', 100, letters)).toBe('');
    expect(fitTitle('', 0, letters)).toBe('');
  });

  it('never cuts a surrogate pair in half', () => {
    // Each face is two code units; a cut that falls inside one leaves it out whole.
    const faces = `ab${face}${face}${face} notes — Sheets`;
    for (let room = 0; room <= faces.length; room++) {
      const shown = fitTitle(faces, room, letters);
      for (let at = 0; at < shown.length; at++) {
        const code = shown.charCodeAt(at);
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = shown.charCodeAt(at + 1);
          expect(next >= 0xdc00 && next <= 0xdfff, `room ${String(room)}: "${shown}"`).toBe(true);
        }
        if (code >= 0xdc00 && code <= 0xdfff) {
          const before = shown.charCodeAt(at - 1);
          expect(before >= 0xd800 && before <= 0xdbff, `room ${String(room)}: "${shown}"`).toBe(
            true,
          );
        }
      }
    }
    // The first word whole.
    expect(fitTitle(faces, 18, letters)).toBe(`ab${face}${face}${face}… — Sheets`);
    expect(fitTitle(faces, 14, letters)).toBe(`ab${face}${face}${face} note…`);
    // Room for half of the second face shows the first only.
    expect(fitTitle(faces, 6, letters)).toBe(`ab${face}…`);
  });

  it.each([
    board,
    'Inbox (3) and a long subject line with little letters - Google Chrome',
    'Quarterly planning workbook for the whole launch team, final version (2)',
    'IMG_2041 (illustrations, filled).jpeg',
  ])(
    'at every room fits, never shows less with more room, and keeps the app’s name: %s',
    (title) => {
      const whole = proportional(title);
      const app = appPartStart(title);
      const tail = app > 0 ? title.slice(app) : null;
      // The least of the document that keeps the app's name, with no space before the ellipsis.
      let tailNeeds = Infinity;
      if (tail !== null) {
        const least = leastDocument(title.slice(0, app));
        for (let count = least; count < app && tailNeeds === Infinity; count++) {
          const head = title.slice(0, count).trimEnd();
          if (head.length >= least) tailNeeds = proportional(head + ellipsis + tail);
        }
      }

      let before = 0;
      let sawCut = false;
      for (let room = 12; room <= whole + 4; room += 0.5) {
        const shown = fitTitle(title, room, proportional);
        const wide = proportional(shown);
        const at = `room ${String(room)}: "${shown}"`;
        expect(wide, at).toBeLessThanOrEqual(room);
        expect(wide, `${at} shows less than a smaller room did`).toBeGreaterThanOrEqual(before);
        before = wide;

        if (room >= whole) {
          expect(shown, at).toBe(title);
          continue;
        }
        if (shown === '') {
          expect(proportional(title.slice(0, 1) + ellipsis), at).toBeGreaterThan(room);
          continue;
        }
        sawCut = true;
        expect(shown, at).toContain(ellipsis);
        if (tail !== null && room >= tailNeeds)
          expect(shown.endsWith(ellipsis + tail), at).toBe(true);
        else expect(shown.endsWith(ellipsis), at).toBe(true);
        // The longest that fits: a space and the widest letter more would not.
        expect(wide + 12, `${at} leaves room for more letters`).toBeGreaterThan(room);
      }
      expect(sawCut).toBe(true);
    },
  );
});
