import { describe, expect, it } from 'vitest';
import type { VisionState } from '../vision/vision';
import { chipFit, chipMaxWidth, chipWords, floatingSource } from './sources';

const nothing: VisionState = {
  share: 'none',
  source: null,
  stream: null,
  showStarting: false,
  slow: false,
  failure: null,
  stopped: false,
  cameras: [],
  crop: null,
  paused: false,
};

const camera = { kind: 'camera', deviceId: 'cam-1', name: 'Integrated Camera' } as const;

describe('chipWords', () => {
  it('keeps the kind and the name while paused, with the ring, and says "paused" (V5)', () => {
    expect(chipWords({ ...nothing, share: 'live', source: camera, paused: true }, false)).toEqual({
      mark: 'paused',
      icon: 'source-camera',
      passive: false,
      quiet: false,
      kind: 'Camera',
      name: 'Integrated Camera',
      full: 'Camera · Integrated Camera · paused',
      state: '',
    });
    // A still image has no dot slot, paused or not; it is told all the same.
    const image = { kind: 'image', deviceId: null, name: 'mug.jpg' } as const;
    expect(
      chipWords({ ...nothing, share: 'live', source: image, paused: true }, false),
    ).toMatchObject({
      mark: 'none',
      kind: 'Image',
      name: 'mug.jpg',
      full: 'Image · mug.jpg · paused',
      state: '',
    });
  });

  it('measures a paused name as a live one, with the slot taken (A22): no jump on Pause', () => {
    const long = {
      ...camera,
      name: 'A very long camera name that will not fit in the chip at all',
    };
    const measure = (text: string) => text.length * 7;
    const live = chipWords({ ...nothing, share: 'live', source: long }, false);
    const paused = chipWords({ ...nothing, share: 'live', source: long, paused: true }, false);
    expect(chipFit(paused, chipMaxWidth(900), measure, measure)).toEqual(
      chipFit(live, chipMaxWidth(900), measure, measure),
    );
  });

  it('has no dot slot and no glyph with nothing shared, its words stepping back', () => {
    expect(chipWords(nothing, false)).toEqual({
      mark: 'none',
      icon: null,
      passive: false,
      quiet: true,
      kind: 'Nothing shared',
      name: '',
      full: 'Nothing shared',
      state: '',
    });
  });

  it('shows the loader and the kind alone while starting, and mint only once live', () => {
    expect(chipWords({ ...nothing, share: 'starting', source: camera }, false)).toMatchObject({
      mark: 'starting',
      kind: 'Camera',
      name: '',
      full: 'Camera · Integrated Camera',
      state: ', starting',
    });
    expect(chipWords({ ...nothing, share: 'live', source: camera }, false)).toMatchObject({
      mark: 'live',
      icon: 'source-camera',
      full: 'Camera · Integrated Camera',
      state: ', live',
    });
  });

  it('gives a still image no dot slot and no "live", whether starting or shared (D6x-c, A15)', () => {
    const image = { kind: 'image', deviceId: null, name: 'mug.jpg' } as const;
    for (const share of ['starting', 'live'] as const) {
      expect(chipWords({ ...nothing, share, source: image }, false)).toEqual({
        mark: 'none',
        icon: 'source-image',
        passive: false,
        quiet: false,
        kind: 'Image',
        name: share === 'live' ? 'mug.jpg' : '',
        full: 'Image · mug.jpg',
        state: '',
      });
    }
  });

  it('says "Camera" alone until the camera’s name is known', () => {
    const unnamed = { ...camera, name: '' };
    expect(chipWords({ ...nothing, share: 'starting', source: unnamed }, false)).toMatchObject({
      name: '',
      full: 'Camera',
    });
  });

  it('carries a problem’s cause only while its banner shows', () => {
    const failed = { ...nothing, failure: { problem: 'busy', cause: 'Camera in use' } } as const;
    expect(chipWords(failed, true)).toMatchObject({
      mark: 'failed',
      kind: 'Camera',
      name: 'Camera in use',
      state: ', failed',
    });
    expect(chipWords(failed, false).mark).toBe('none');
  });

  it.each([
    ['tab', 'Browser tab', 'source-tab'],
    ['window', 'Window', 'source-window'],
    ['screen', 'Screen', 'source-screen'],
  ] as const)('names a shared %s by its kind and glyph alone', (kind, word, icon) => {
    const source = { kind, deviceId: null, name: '' };
    expect(chipWords({ ...nothing, share: 'live', source }, false)).toEqual({
      mark: 'live',
      icon,
      passive: false,
      quiet: false,
      kind: word,
      name: '',
      full: word,
      state: ', live',
    });
  });
});

describe('chipWords for a region (D6w, D6x-c)', () => {
  const whole = {} as MediaStream;
  const crop = {
    stream: whole,
    area: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    change: false,
  };

  it('says "Choosing an area" while a crop is open: no dot, no glyph, no chevron, passive', () => {
    expect(chipWords({ ...nothing, crop }, false)).toEqual({
      mark: 'none',
      icon: null,
      passive: true,
      quiet: true,
      kind: 'Choosing an area',
      name: '',
      full: 'Choosing an area',
      state: '',
    });
  });

  it('keeps saying so while a shared region’s area is changed, though the region is live', () => {
    const source = { kind: 'region', deviceId: null, name: '1024 × 576' } as const;
    const changing = {
      ...nothing,
      share: 'live',
      source,
      crop: { ...crop, change: true },
    } as const;
    expect(chipWords(changing, false)).toMatchObject({ kind: 'Choosing an area', passive: true });
  });

  it('names a shared region "Region · 1024 × 576", its size in the surface’s pixels', () => {
    const source = { kind: 'region', deviceId: null, name: '1024 × 576' } as const;
    expect(chipWords({ ...nothing, share: 'live', source }, false)).toEqual({
      mark: 'live',
      icon: 'source-region',
      passive: false,
      quiet: false,
      kind: 'Region',
      name: '1024 × 576',
      full: 'Region · 1024 × 576',
      state: ', live',
    });
  });
});

describe('chipFit', () => {
  /** Every letter is 1 wide, so a room is a count. */
  const letters = (text: string) => text.length;
  const words = (name: string, mark: 'live' | 'none' = 'live') =>
    ({
      mark,
      icon: 'source-camera',
      passive: false,
      quiet: false,
      kind: 'Camera',
      name,
      full: '',
      state: '',
    }) as const;

  it('shows "Kind · name" whole while it fits the room the bar leaves the chip', () => {
    // At 900 wide the chip has its least, 220: 24 padding, 16 slot and 20 chevron leave 160, of
    // which the glyph takes 24, "Camera" 6 and " · " 3, so 127 for the name.
    expect(chipMaxWidth(900)).toBe(220);
    expect(chipMaxWidth(1440)).toBe(680);
    const name = 'x'.repeat(127);
    expect(chipFit(words(name), chipMaxWidth(900), letters, letters)).toEqual({ kind: true, name });
    // Without a slot, 16 more.
    const longer = `${name}${'y'.repeat(16)}`;
    expect(chipFit(words(longer, 'none'), chipMaxWidth(900), letters, letters)).toEqual({
      kind: true,
      name: longer,
    });
  });

  it('lets the kind and its glyph go before the name is cut', () => {
    const name = 'x'.repeat(128);
    expect(chipFit(words(name), chipMaxWidth(900), letters, letters)).toEqual({
      kind: false,
      name,
    });
    expect(chipFit(words('x'.repeat(161)), chipMaxWidth(900), letters, letters)).toEqual({
      kind: false,
      name: `${'x'.repeat(159)}…`,
    });
  });

  it('cuts by the title rule, so the app’s name stays', () => {
    const title = 'Budget Q3 forecast · regional breakdown — Sheets';
    expect(chipFit(words(title), chipMaxWidth(900), letters, (text) => text.length * 4)).toEqual({
      kind: false,
      name: 'Budget Q3 forecast · regional… — Sheets',
    });
  });

  it('shows no name when there is none', () => {
    expect(chipFit(words(''), chipMaxWidth(1440), letters, letters)).toEqual({
      kind: true,
      name: '',
    });
  });
});

describe('floatingSource', () => {
  it('carries the chip’s dot and whole words, and nothing while nothing is seen', () => {
    const live = chipWords({ ...nothing, share: 'live', source: camera }, false);
    expect(floatingSource(live)).toEqual({ mark: 'live', words: 'Camera · Integrated Camera' });
    const paused = chipWords({ ...nothing, share: 'live', source: camera, paused: true }, false);
    expect(floatingSource(paused)).toEqual({
      mark: 'paused',
      words: 'Camera · Integrated Camera · paused',
    });
    const starting = chipWords({ ...nothing, share: 'starting', source: camera }, false);
    expect(floatingSource(starting)?.mark).toBe('none');
    expect(floatingSource(chipWords(nothing, false))).toBeNull();
  });
});
