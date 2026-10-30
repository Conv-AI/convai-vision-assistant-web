import { describe, expect, it } from 'vitest';
import {
  columnsFor,
  moveInTiles,
  tileRows,
  freeRoom,
  panelHeight,
  stepFor,
  tileHeight,
  widthOn,
  wordsRoom,
  type PanelContent,
} from './layout';

const whole: PanelContent = { textScale: 1, packageTiles: 6, appTiles: 3, columns: 3 };

describe('tileHeight', () => {
  it('is 84 up to 1.00 and grows with the text to the even pixel above (kit HeightAt)', () => {
    expect(tileHeight(0.9)).toBe(84);
    expect(tileHeight(1)).toBe(84);
    expect(tileHeight(1.15)).toBe(96);
    expect(tileHeight(1.3)).toBe(110);
  });
});

describe('panelHeight', () => {
  it('adds the component’s rows: character, two rows of tiles, the app’s row, the rule and All settings', () => {
    expect(panelHeight(whole, 0)).toBe(429);
  });

  it('gives way by whole rows: the second row of tiles, then the character, then all but All settings', () => {
    expect(panelHeight(whole, 1)).toBe(429 - 92);
    expect(panelHeight(whole, 2)).toBe(429 - 92 - 64);
    expect(panelHeight(whole, 3)).toBe(16 + 44);
  });

  it('grows with the text: tiles, the character, the label and All settings', () => {
    // 16, 72 + 8, 110 + 8 + 110, 42, 110, 8, 58.
    expect(panelHeight({ ...whole, textScale: 1.3 }, 0)).toBe(542);
  });

  it('keeps one row of tiles for five, and has no label without an app row', () => {
    expect(panelHeight({ ...whole, packageTiles: 5 }, 0)).toBe(429);
    expect(panelHeight({ ...whole, appTiles: 0 }, 0)).toBe(429 - 37 - 84);
  });

  it('counts the rows two tiles a row make', () => {
    // Three rows of package tiles and two of the app's.
    expect(panelHeight({ ...whole, columns: 2 }, 0)).toBe(429 + 92 + 92);
    expect(panelHeight({ ...whole, columns: 2 }, 1)).toBe(429 - 92 + 92);
  });
});

describe('stepFor', () => {
  it('takes the least giving way that fits, to the half pixel', () => {
    expect(stepFor(whole, 429)).toBe(0);
    expect(stepFor(whole, 428.5)).toBe(0);
    expect(stepFor(whole, 428)).toBe(1);
    expect(stepFor(whole, 337)).toBe(1);
    expect(stepFor(whole, 336)).toBe(2);
    expect(stepFor(whole, 273)).toBe(2);
    expect(stepFor(whole, 272)).toBe(3);
    expect(stepFor(whole, 60)).toBe(3);
  });

  it('is null where not even All settings alone fits: Quick controls is not offered', () => {
    expect(stepFor(whole, 59)).toBeNull();
  });

  it('gives way sooner at a larger text size on the same stage', () => {
    expect(stepFor(whole, 450)).toBe(0);
    expect(stepFor({ ...whole, textScale: 1.3 }, 450)).toBe(1);
  });
});

describe('freeRoom', () => {
  it('is what stands between the Island’s band and the capsule, 8 from each', () => {
    // A 560 high window: a 500 stage, the capsule 24 + 64 up, the band 16 + 40 down.
    expect(freeRoom({ height: 500, width: 536, capsuleTop: 88, islandBottom: 56 })).toBe(340);
  });
});

describe('widthOn', () => {
  it('is 420, or the stage less 8 on each side', () => {
    expect(widthOn(1200)).toBe(420);
    expect(widthOn(420)).toBe(404);
  });
});

describe('columnsFor', () => {
  it('holds three a row while every word fits, two where one would be cut', () => {
    const room = wordsRoom(420, 3);

    expect(room).toBeCloseTo((404 - 16) / 3 - 24);
    expect(columnsFor(420, room - 2)).toBe(3);
    // A word that measures to the last pixel is drawn wider: two a row.
    expect(columnsFor(420, room - 1.9)).toBe(2);
    expect(columnsFor(420, room + 1)).toBe(2);
  });
});

describe('tileRows', () => {
  it('lays the package’s tiles and the app’s in rows of their own', () => {
    expect(tileRows(6, 3, 3)).toEqual([3, 3, 3]);
    expect(tileRows(5, 3, 3)).toEqual([3, 2, 3]);
    expect(tileRows(5, 2, 2)).toEqual([2, 2, 1, 2]);
    expect(tileRows(3, 0, 3)).toEqual([3]);
  });
});

describe('moveInTiles', () => {
  const rows = [3, 2, 3];

  it('goes before and after along the rows, and stays at the ends', () => {
    expect(moveInTiles(rows, 2, 'right')).toBe(3);
    expect(moveInTiles(rows, 3, 'left')).toBe(2);
    expect(moveInTiles(rows, 0, 'left')).toBe(0);
    expect(moveInTiles(rows, 7, 'right')).toBe(7);
  });

  it('goes up and down in the column, to a shorter row’s last tile', () => {
    expect(moveInTiles(rows, 1, 'down')).toBe(4);
    expect(moveInTiles(rows, 2, 'down')).toBe(4);
    expect(moveInTiles(rows, 4, 'down')).toBe(6);
    expect(moveInTiles(rows, 7, 'up')).toBe(4);
    expect(moveInTiles(rows, 5, 'up')).toBe(3);
    expect(moveInTiles(rows, 1, 'up')).toBe(1);
    expect(moveInTiles(rows, 6, 'down')).toBe(6);
  });
});
