import { describe, expect, it } from 'vitest';
import { sourcePlace } from './bar';

describe('sourcePlace', () => {
  it('centres the chip in the room the window gives it (A18: window − 760, at least 220)', () => {
    expect(sourcePlace({ width: 1440, characterEnd: 136, toolsStart: 1300, chip: 240 })).toEqual({
      room: 680,
      left: 600,
      menuShift: 0,
    });
    expect(sourcePlace({ width: 900, characterEnd: 136, toolsStart: 760, chip: 200 }).room).toBe(
      220,
    );
  });

  it('gives the chip only what lies 12 clear of the character chip and the tools', () => {
    // 560 with a long name: 12 after the name's chip to 12 before the tools.
    const place = sourcePlace({ width: 560, characterEnd: 346, toolsStart: 472, chip: 102 });
    expect(place.room).toBe(472 - 12 - (346 + 12));
    expect(place.left).toBe(346 + 12);
  });

  it('slides from the centre beside the character chip, never under it', () => {
    expect(sourcePlace({ width: 800, characterEnd: 300, toolsStart: 700, chip: 220 }).left).toBe(
      312,
    );
  });

  it('slides away from the tools when the centre would run under them', () => {
    expect(sourcePlace({ width: 800, characterEnd: 100, toolsStart: 500, chip: 220 }).left).toBe(
      500 - 12 - 220,
    );
  });

  it('keeps clear of the character chip when its least part is wider than the room', () => {
    const place = sourcePlace({ width: 560, characterEnd: 346, toolsStart: 472, chip: 140 });
    expect(place.left).toBe(358);
    expect(place.room).toBe(102);
  });

  it('keeps the source menu centred under the chip while it fits the window', () => {
    expect(
      sourcePlace({ width: 1440, characterEnd: 136, toolsStart: 1300, chip: 240 }).menuShift,
    ).toBe(0);
  });

  it('moves the source menu in from the window’s edge, 8 clear, when the chip has slid', () => {
    // 560 with a long name: the chip at 358, 102 wide; the 352 menu would end at 586.
    const place = sourcePlace({ width: 560, characterEnd: 346, toolsStart: 472, chip: 102 });
    expect(358 + 102 / 2 + 352 / 2 + place.menuShift).toBe(560 - 8);
    // Slid to the left edge's side, it moves right.
    expect(
      sourcePlace({ width: 560, characterEnd: -200, toolsStart: 150, chip: 100 }).menuShift,
    ).toBeGreaterThan(0);
  });

  it('never gives a negative room', () => {
    expect(sourcePlace({ width: 560, characterEnd: 470, toolsStart: 472, chip: 60 }).room).toBe(0);
  });
});
