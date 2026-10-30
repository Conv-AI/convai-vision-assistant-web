import { describe, expect, it } from 'vitest';
import {
  bandHeight,
  fitFrame,
  lineForm,
  lineLeft,
  imageLine,
  pausedLine,
  previewLine,
  previewPlace,
  widestToast,
} from './preview';

describe('previewPlace', () => {
  it('starts the preview 8 under the Island’s band, which grows with the text (V10, K30)', () => {
    // Docked: 64 / 68 / 72; floating: 60 / 64 / 68.
    expect([1, 1.15, 1.3].map((s) => previewPlace('pinned', s, 0).top)).toEqual([64, 68, 72]);
    expect([1, 1.15, 1.3].map((s) => previewPlace('float', s, 372).top)).toEqual([60, 64, 68]);
    expect([1, 1.15, 1.3].map((s) => previewPlace('closed', s, 0).top)).toEqual([64, 68, 72]);
  });

  it('centres the line on the band, and keeps 28 from the sides and 120 from the bottom', () => {
    expect(previewPlace('pinned', 1, 0)).toEqual({
      top: 64,
      lineTop: 24,
      left: 28,
      right: 28,
      bottom: 120,
    });
    expect(previewPlace('float', 1.3, 372)).toMatchObject({ lineTop: 24, right: 400 });
    expect(bandHeight(1.14)).toBe(40);
  });
});

describe('lineForm', () => {
  // Inter at 12 / 13.8 px: the whole line, and "Now sharing · " in a toast's 600 at 13 / 15 px.
  const at100 = { whole: 250, nowSharingWords: 92 };
  const at115 = { whole: 288, nowSharingWords: 106 };

  it('keeps the whole line at 1440 docked at text 1.00 and shortens it at 1.15 (V13, D14)', () => {
    expect(lineForm({ left: 28, islandRoom: 1024, bannerShows: false, ...at100 }).short).toBe(
      false,
    );
    expect(lineForm({ left: 28, islandRoom: 1024, bannerShows: false, ...at115 }).short).toBe(true);
  });

  it('measures against the widest toast the app posts, not the one showing (V19)', () => {
    // 72 around + the words + the 240 slot, never wider than 460 or the Island's room.
    expect(widestToast(92, 1024)).toBe(404);
    expect(widestToast(200, 1024)).toBe(460);
    expect(widestToast(92, 400)).toBe(368);
    // Exactly 12 clear of the widest toast keeps the whole line; one pixel nearer shortens it.
    const reach = 512 - 404 / 2;
    expect(
      lineForm({
        left: 28,
        islandRoom: 1024,
        bannerShows: false,
        nowSharingWords: 92,
        whole: reach - 40,
      }).short,
    ).toBe(false);
    expect(
      lineForm({
        left: 28,
        islandRoom: 1024,
        bannerShows: false,
        nowSharingWords: 92,
        whole: reach - 39,
      }).short,
    ).toBe(true);
  });

  it('is short while a banner stands in the row', () => {
    expect(lineForm({ left: 28, islandRoom: 1024, bannerShows: true, ...at100 }).short).toBe(true);
  });

  it('is short on a narrow stage', () => {
    expect(lineForm({ left: 28, islandRoom: 600, bannerShows: false, ...at100 }).short).toBe(true);
  });

  it('gives an image its kind and name, with no Live wording, and the kind alone as its short form', () => {
    expect(imageLine('mug.jpg')).toEqual({ whole: 'Image · mug.jpg', short: 'Image' });
  });

  it('says that nothing is seen while paused, and an image keeps its name (H12b, A17)', () => {
    expect(pausedLine('Kira')).toEqual({ whole: 'Paused · Kira can’t see this', short: 'Paused' });
    expect(imageLine('mug.jpg', true)).toEqual({
      whole: 'Paused · Image · mug.jpg',
      short: 'Paused',
    });
  });

  it('names the character in the whole line', () => {
    expect(previewLine('Kira')).toEqual({
      whole: 'Live preview · Kira sees this while you share',
      short: 'Live preview',
    });
  });
});

describe('fitFrame and lineLeft', () => {
  it('fits the picture whole, at the top and in the middle, never cropped', () => {
    expect(fitFrame({ width: 1000, height: 500 }, { width: 800, height: 800 })).toEqual({
      x: 250,
      y: 0,
      width: 500,
      height: 500,
    });
    expect(fitFrame({ width: 800, height: 800 }, { width: 1600, height: 900 })).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 450,
    });

    expect(fitFrame({ width: 1012, height: 656 }, { width: 720, height: 1028 })).toEqual({
      x: 277,
      y: 0,
      width: 459,
      height: 656,
    });
    expect(fitFrame({ width: 800, height: 600 }, null)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
  });

  it('starts the line at the frame’s left, or in a narrow frame’s middle, never nearer than 28', () => {
    expect(lineLeft(84, 600, 250)).toBe(84);
    expect(lineLeft(300, 200, 250)).toBe(275);
    expect(lineLeft(40, 100, 250)).toBe(28);
  });

  it('decides the form from where the line starts', () => {
    const base = { islandRoom: 1024, bannerShows: false, nowSharingWords: 92, whole: 250 };
    expect(lineForm({ ...base, left: 28 }).short).toBe(false);
    expect(lineForm({ ...base, left: 60 }).short).toBe(true);
  });
});
