import { describe, expect, it } from 'vitest';
import {
  barHeight,
  barWidth,
  cropBarTop,
  cropPicturePlace,
  handleCentres,
  hintForm,
  readoutPlace,
} from './crop';

describe('the bar', () => {
  it('stands in the Island’s place, 12 under the title bar, and 12 under a notice there (15b 2)', () => {
    expect(cropBarTop(null)).toBe(12);
    expect(cropBarTop(0)).toBe(12);
    // A banner from 12 to 76: the bar 12 under it.
    expect(cropBarTop(76)).toBe(88);
  });

  it('grows with the text as its 40 buttons do, 8 round them', () => {
    expect(barHeight(1)).toBe(56);
    expect(barHeight(1.3)).toBeCloseTo(68, 6);
    // The picture keeps its 16 under the taller bar.
    expect(cropPicturePlace(12, 'pinned', 1.3, 0).top).toBeCloseTo(12 + 68 + 16, 6);
  });

  it('keeps the picture under itself with 16 between, so a notice moves the picture once', () => {
    // 12 + 56 + 16 = 84 under the title bar (15 §A 1), where the preview's own top (64) is higher.
    expect(cropPicturePlace(12, 'pinned', 1, 0)).toEqual({
      top: 84,
      left: 28,
      right: 28,
      bottom: 120,
    });
    expect(cropPicturePlace(88, 'pinned', 1, 0).top).toBe(160);
    // A floating panel's room stays free at the right.
    expect(cropPicturePlace(12, 'float', 1, 400).right).toBe(428);
  });

  const widths = { whole: 262, short: 152, cancel: 85, share: 112 };

  it('measures 20 + line + 16, then the buttons with 8 between and round them', () => {
    expect(barWidth(262, widths)).toBe(20 + 262 + 16 + 85 + 8 + 112 + 8);
    expect(barWidth(0, widths)).toBe(8 + 85 + 8 + 112 + 8);
  });

  it('says the whole line where it fits, the short one where only that does, then none (D6x-b)', () => {
    expect(hintForm(1408, widths)).toBe('whole');
    expect(hintForm(barWidth(262, widths), widths)).toBe('whole');
    expect(hintForm(barWidth(262, widths) - 1, widths)).toBe('short');
    expect(hintForm(barWidth(152, widths) - 1, widths)).toBe('none');
    // The buttons are never cut: "none" is the narrowest bar, whatever the room.
    expect(hintForm(100, widths)).toBe('none');
  });
});

describe('the marks over the area', () => {
  const picture = { width: 1056, height: 660 };
  const chip = { width: 96, height: 28 };

  it('puts the handles on the area’s corners', () => {
    expect(handleCentres({ x: 100, y: 200, width: 400, height: 300 }, picture)).toEqual([
      { x: 100, y: 200 },
      { x: 500, y: 200 },
      { x: 100, y: 500 },
      { x: 500, y: 500 },
    ]);
  });

  it('keeps a handle whole inside the picture where the area meets its edge', () => {
    const [topLeft, , , bottomRight] = handleCentres(
      { x: 0, y: 0, width: 1056, height: 660 },
      picture,
    );
    expect(topLeft).toEqual({ x: 6, y: 6 });
    expect(bottomRight).toEqual({ x: 1050, y: 654 });
  });

  it('puts a small area’s handles outside its corners, so it can still be held', () => {
    const [topLeft, topRight] = handleCentres({ x: 100, y: 100, width: 33, height: 33 }, picture);
    expect(topLeft).toEqual({ x: 95, y: 95 });
    expect(topRight).toEqual({ x: 138, y: 95 });
  });

  it('stands the readout over the area’s top left where there is room (14b Q10b)', () => {
    expect(readoutPlace({ x: 490, y: 141, width: 422, height: 238 }, chip, picture)).toEqual({
      x: 490,
      y: 105,
      where: 'over',
    });
  });

  it('stands it inside the area, 6 in, where there is no room over it', () => {
    expect(readoutPlace({ x: 100, y: 20, width: 400, height: 300 }, chip, picture)).toEqual({
      x: 106,
      y: 26,
      where: 'inside',
    });
  });

  it('stands it past the top-left handle where that is drawn inside (an area on the edge)', () => {
    const inside = readoutPlace({ x: 0, y: 0, width: 400, height: 300 }, chip, picture);
    expect(inside).toEqual({ x: 6 + 6 + 6, y: 6, where: 'inside' });
  });

  it('stands it under an area too small to hold it, and never past the picture', () => {
    expect(readoutPlace({ x: 100, y: 10, width: 60, height: 40 }, chip, picture)).toEqual({
      x: 100,
      y: 10 + 40 + 36 - 28,
      where: 'under',
    });
    // At the right edge it moves left to stay whole.
    expect(readoutPlace({ x: 1020, y: 300, width: 36, height: 36 }, chip, picture).x).toBe(960);
  });
});
