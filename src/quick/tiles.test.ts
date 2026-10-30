import { describe, expect, it } from 'vitest';
import { appTiles, packageTiles, showsWindowTile, switchGivesWay, type QuickState } from './tiles';

const base: QuickState = {
  name: 'Kira',
  talkMode: 'push-to-talk',
  captions: true,
  transcriptOpen: false,
  continuum: false,
  muted: false,
  microphoneMissing: false,
  textScale: 1,
  typeKey: '/',
  paused: false,
  sourceKind: null,
  windowTile: true,
  windowMode: 'full',
};

const ids = (tiles: { id: string }[]) => tiles.map((tile) => tile.id);
const tile = (state: QuickState, id: string) =>
  [...packageTiles(state), ...appTiles(state)].find((each) => each.id === id);

describe('packageTiles', () => {
  it('are six in the kit’s fixed order', () => {
    expect(ids(packageTiles(base))).toEqual([
      'hands-free',
      'captions',
      'transcript',
      'type',
      'mute',
      'text-size',
    ]);
  });

  it('say On or Off as toggles, and turn white only while on', () => {
    expect(tile(base, 'hands-free')).toMatchObject({ on: false, value: 'Off' });
    expect(tile({ ...base, talkMode: 'hands-free' }, 'hands-free')).toMatchObject({
      on: true,
      value: 'On',
    });
    expect(tile(base, 'captions')).toMatchObject({ on: true, value: 'On' });
    expect(tile({ ...base, captions: false }, 'captions')).toMatchObject({
      on: false,
      value: 'Off',
    });
    expect(tile({ ...base, muted: true }, 'mute')).toMatchObject({ on: true, value: 'On' });
    expect(tile({ ...base, transcriptOpen: true }, 'transcript')).toMatchObject({
      on: true,
      value: 'On',
    });
  });

  it('never show an action as on: Type and Text size', () => {
    expect(tile(base, 'type')?.on).toBeNull();
    expect(tile(base, 'text-size')?.on).toBeNull();
  });

  it('write the Type key as its cap alone, and nothing on the line when it has no key', () => {
    expect(tile(base, 'type')).toMatchObject({ value: '', keyCap: '/' });
    expect(tile({ ...base, typeKey: 'K' }, 'type')?.keyCap).toBe('K');
    expect(tile({ ...base, typeKey: '' }, 'type')).not.toHaveProperty('keyCap');
  });

  it('write the text size as Settings does, and open its options', () => {
    expect(tile({ ...base, textScale: 1.15 }, 'text-size')).toMatchObject({
      value: '115%',
      options: true,
    });
  });

  it('dim Hands free and Mute without a microphone and say why on the value line', () => {
    const none = { ...base, microphoneMissing: true };
    expect(tile(none, 'hands-free')).toMatchObject({
      reason: 'No microphone',
      value: 'No microphone',
    });
    expect(tile(none, 'mute')).toMatchObject({ reason: 'No microphone', value: 'No microphone' });
    expect(tile(base, 'hands-free')).not.toHaveProperty('reason');
    expect(tile(base, 'mute')).not.toHaveProperty('reason');
  });

  it('keep Transcript while the column is open, as D13 draws it, and leave it out in Continuum', () => {
    expect(ids(packageTiles({ ...base, transcriptOpen: true }))).toContain('transcript');
    expect(ids(packageTiles({ ...base, continuum: true }))).not.toContain('transcript');
  });
});

describe('appTiles', () => {
  it('are Pause vision, Source and Window, in that order', () => {
    expect(ids(appTiles(base))).toEqual(['pause-vision', 'source', 'window']);
    expect(ids(appTiles({ ...base, windowTile: false }))).toEqual(['pause-vision', 'source']);
  });

  it('pause as a toggle, dimmed with the capsule tool’s reason', () => {
    expect(tile({ ...base, paused: true }, 'pause-vision')).toMatchObject({
      on: true,
      value: 'On',
    });
    const detail = 'Share something to pause vision';
    expect(
      tile({ ...base, pauseBlocked: { cause: 'nothing', detail } }, 'pause-vision'),
    ).toMatchObject({ reason: 'Nothing shared', value: 'Nothing shared', detail });
    expect(
      tile({ ...base, pauseBlocked: { cause: 'starting', detail } }, 'pause-vision')?.value,
    ).toBe('Starting…');
    expect(
      tile({ ...base, pauseBlocked: { cause: 'choosing', detail } }, 'pause-vision')?.value,
    ).toBe('Choosing area');
    expect(tile(base, 'pause-vision')).not.toHaveProperty('reason');
  });

  it('name what is shared on Source, and Nothing while nothing is', () => {
    expect(tile(base, 'source')).toMatchObject({ on: null, value: 'Nothing' });
    expect(tile({ ...base, sourceKind: 'tab' }, 'source')).toMatchObject({
      value: 'Browser tab',
      icon: 'source-tab',
    });
  });

  it('label Window with the mode in force and open a menu, never cycling', () => {
    expect(tile(base, 'window')).toMatchObject({ value: 'Full', menu: true, on: null });
    expect(tile({ ...base, windowMode: 'compact' }, 'window')?.value).toBe('Compact');
  });
});

describe('showsWindowTile', () => {
  it('always where the browser floats a window; only under 640 where Compact only explains', () => {
    expect(showsWindowTile(true, 1440)).toBe(true);
    expect(showsWindowTile(true, 600)).toBe(true);
    expect(showsWindowTile(false, 640)).toBe(false);
    expect(showsWindowTile(false, 639)).toBe(true);
  });

  it('gives the switch way under 640 alone', () => {
    expect(switchGivesWay(639)).toBe(true);
    expect(switchGivesWay(640)).toBe(false);
  });
});
