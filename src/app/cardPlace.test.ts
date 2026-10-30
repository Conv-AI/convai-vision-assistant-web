import { describe, expect, it } from 'vitest';
import { cardPlace } from './cardPlace';

describe('cardPlace (answers 2026-10-16b V12)', () => {
  const switchBox = { bottom: 40, right: 1180 };

  it('stands 8 under the switch, its right edge on the switch’s, 360 wide', () => {
    expect(cardPlace(switchBox, null, 1280)).toEqual({ top: 48, right: 100, width: 360 });
  });

  it('stands 8 under a frame’s top when that is lower than under the switch', () => {
    expect(cardPlace(switchBox, 112, 1280)).toMatchObject({ top: 120 });
  });

  it('keeps under the switch when a frame starts higher', () => {
    expect(cardPlace(switchBox, 20, 1280)).toMatchObject({ top: 48 });
  });

  it('starts 8 past a frame’s side its left edge would sit near', () => {
    // Left edge at 820: a side at 827 (inside) or 814 (outside) is closer than 8.
    expect(cardPlace(switchBox, null, 1280, [827]).width).toBe(1180 - 835);
    expect(cardPlace(switchBox, null, 1280, [814]).width).toBe(1180 - 822);
  });

  it('keeps its width when every side is 8 or more away', () => {
    expect(cardPlace(switchBox, null, 1280, [812, 828, 1260]).width).toBe(360);
  });
});
