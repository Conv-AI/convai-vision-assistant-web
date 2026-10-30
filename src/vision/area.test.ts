import { describe, expect, it } from 'vitest';
import {
  AreaSelection,
  areaOf,
  least,
  middleHalf,
  noArea,
  sentSize,
  shareArea,
  sizeWords,
  toPixels,
} from './area';

const surface = { width: 1280, height: 800 };
const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const drawn = (x: number, y: number, width: number, height: number) =>
  new AreaSelection(areaOf(rect(x, y, width, height), surface));
const pixels = (selection: AreaSelection) => toPixels(selection.area, surface);

describe('a share’s area', () => {
  it('is kept as fractions, and counted in the surface’s pixels as they are now', () => {
    const area = areaOf(rect(160, 100, 1024, 576), surface);
    expect(toPixels(area, surface)).toEqual(rect(160, 100, 1024, 576));

    expect(toPixels(area, { width: 640, height: 400 })).toEqual(rect(80, 50, 512, 288));
    expect(area.width).toBeCloseTo(0.8, 6);
    expect(toPixels(noArea, surface)).toBeNull();
    expect(toPixels(area, { width: 0, height: 0 })).toBeNull();
    expect(areaOf(rect(0, 0, 10, 10), { width: 0, height: 0 })).toEqual(noArea);
  });

  it('opens as the middle half, half each way and centred, on any surface', () => {
    expect(toPixels(middleHalf, surface)).toEqual(rect(320, 200, 640, 400));
    expect(toPixels(middleHalf, { width: 1920, height: 1080 })).toEqual(rect(480, 270, 960, 540));
    expect(toPixels(middleHalf, { width: 2048, height: 1152 })).toEqual(rect(512, 288, 1024, 576));
    expect(new AreaSelection(middleHalf).hasArea).toBe(true);
  });

  it('stays inside the surface', () => {
    const area = shareArea(0.9, -0.2, 0.5, 2);
    expect(area.x).toBeCloseTo(0.9, 6);
    expect(area.y).toBe(0);
    expect(area.width).toBeCloseTo(0.1, 6);
    expect(area.height).toBe(1);
    const p = toPixels(area, surface);
    expect(p).not.toBeNull();
    if (!p) return;
    expect(p.x + p.width).toBeLessThanOrEqual(surface.width);
    expect(p.y + p.height).toBeLessThanOrEqual(surface.height);
    expect(shareArea(Number.NaN, 0, 0.5, 0.5).x).toBe(0);
  });

  it('rounds each edge half away from zero, and keeps at least one pixel', () => {
    // 0.5 px edges: 0.25 × 2 = 0.5 → 1; the right edge 0.75 × 2 = 1.5 → 2.
    expect(toPixels(shareArea(0.25, 0.25, 0.5, 0.5), { width: 2, height: 2 })).toEqual(
      rect(1, 1, 1, 1),
    );
    expect(toPixels(shareArea(0.999, 0.999, 0.001, 0.001), { width: 100, height: 100 })).toEqual(
      rect(99, 99, 1, 1),
    );
  });

  it('reads its size as the readout and the chip say it', () => {
    expect(sizeWords(1024, 576)).toBe('1024 × 576');
  });
});

describe('the gesture that chooses it', () => {
  it('draws an area with a drag, and a click leaves the one before', () => {
    const selection = new AreaSelection();
    expect(selection.hasArea).toBe(false);
    selection.press(100, 120, surface, 12);
    expect(selection.grip).toBe('new');
    selection.dragTo(612, 408, surface);
    selection.release(surface);
    expect(pixels(selection)).toEqual(rect(100, 120, 512, 288));

    selection.press(1000, 700, surface, 12);
    selection.dragTo(1030, 720, surface);
    expect(selection.release(surface)).toBe(false);
    expect(pixels(selection)).toEqual(rect(100, 120, 512, 288));
  });

  it('draws a new area from a drag outside it, whichever way the drag goes', () => {
    const selection = new AreaSelection(middleHalf);
    expect(selection.gripAt(100, 100, surface, 12)).toBe('new');
    selection.press(700, 700, surface, 12);
    selection.dragTo(100, 100, surface);
    expect(selection.release(surface)).toBe(true);
    expect(pixels(selection)).toEqual(rect(100, 100, 600, 600));
  });

  it('moves the area with a drag inside it, and keeps it inside the surface', () => {
    const selection = drawn(100, 100, 400, 300);
    selection.press(300, 250, surface, 12);
    expect(selection.grip).toBe('move');
    selection.dragTo(400, 260, surface);
    expect(pixels(selection)).toEqual(rect(200, 110, 400, 300));
    selection.dragTo(5000, 5000, surface);
    selection.release(surface);
    expect(pixels(selection)).toEqual(rect(880, 500, 400, 300));
  });

  it('resizes from each handle across the corner, and stops at 64 surface pixels', () => {
    const selection = drawn(400, 300, 400, 300);
    expect(selection.gripAt(405, 295, surface, 12)).toBe('top-left');
    expect(selection.gripAt(800, 600, surface, 12)).toBe('bottom-right');
    expect(selection.gripAt(790, 310, surface, 12)).toBe('top-right');
    expect(selection.gripAt(410, 590, surface, 12)).toBe('bottom-left');
    expect(selection.gripAt(413, 300, surface, 12)).toBe('move');

    selection.press(800, 600, surface, 12);
    selection.dragTo(900, 700, surface);
    expect(pixels(selection)).toEqual(rect(400, 300, 500, 400));
    // Past the corner across: the handle stops 64 from it, it does not turn the area over.
    selection.dragTo(100, 100, surface);
    expect(pixels(selection)).toEqual(rect(400, 300, 64, 64));
    selection.release(surface);

    selection.press(400, 300, surface, 12);
    expect(selection.grip).toBe('top-left');
    selection.dragTo(460, 330, surface);
    expect(pixels(selection)).toEqual(rect(400, 300, 64, 64));
    selection.dragTo(-50, -50, surface);
    selection.release(surface);
    expect(pixels(selection)).toEqual(rect(0, 0, 464, 364));
  });

  it('resizes from the top right and bottom left with the corner across held', () => {
    const selection = drawn(400, 300, 400, 300);
    selection.press(800, 300, surface, 12);
    expect(selection.grip).toBe('top-right');
    selection.dragTo(1000, 200, surface);
    expect(pixels(selection)).toEqual(rect(400, 200, 600, 400));
    selection.release(surface);
    selection.press(400, 600, surface, 12);
    expect(selection.grip).toBe('bottom-left');
    selection.dragTo(300, 700, surface);
    selection.release(surface);
    expect(pixels(selection)).toEqual(rect(300, 200, 700, 500));
  });

  it('takes the whole surface as the least on a surface smaller than the minimum', () => {
    expect(least(surface)).toEqual({ width: 64, height: 64 });
    expect(least({ width: 40, height: 90 })).toEqual({ width: 40, height: 64 });
  });

  it('leaves the area before a gesture that is let go of', () => {
    const selection = drawn(100, 100, 400, 300);
    selection.press(300, 250, surface, 12);
    selection.dragTo(600, 500, surface);
    selection.abandon();
    expect(pixels(selection)).toEqual(rect(100, 100, 400, 300));
    expect(selection.grip).toBe('none');
  });

  it('takes nothing on a surface without a size', () => {
    const selection = new AreaSelection(middleHalf);
    selection.press(10, 10, { width: 0, height: 0 }, 12);
    expect(selection.grip).toBe('none');
    expect(selection.dragTo(100, 100, surface)).toBe(false);
    expect(selection.release(surface)).toBe(false);
    expect(selection.area).toEqual(middleHalf);
  });
});

describe('the size an area is sent at', () => {
  it('is its own up to a short edge of 1080, and even each way', () => {
    expect(sentSize(1024, 576)).toEqual({ width: 1024, height: 576 });
    expect(sentSize(641, 401)).toEqual({ width: 640, height: 400 });
    expect(sentSize(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(sentSize(1080, 4000)).toEqual({ width: 1080, height: 4000 });
    expect(sentSize(1, 1)).toEqual({ width: 2, height: 2 });
  });
});
