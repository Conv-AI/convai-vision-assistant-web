import { describe, expect, it } from 'vitest';
import {
  captionMode,
  initialTranscript,
  layoutFor,
  toggleTranscript,
  transcriptOnResize,
} from './layout';

describe('layoutFor', () => {
  it('pins a 380 column beside the stage at 1440 (D1)', () => {
    expect(layoutFor(1440, true, 'moments')).toEqual({
      wide: true,
      place: 'pinned',
      panelWidth: 380,
      stageWidth: 1440 - 24 - 380 - 12,
      capsule: 'full',
      barTranscript: false,
      continuum: false,
    });
  });

  it('pins a 420 column from 1680 wide (D11)', () => {
    expect(layoutFor(1679, true, 'moments').panelWidth).toBe(380);
    expect(layoutFor(1680, true, 'moments').panelWidth).toBe(420);
    expect(layoutFor(1920, true, 'moments').stageWidth).toBe(1920 - 24 - 420 - 12);
  });

  it('gives the stage the whole width and the bar its tool when the column is hidden', () => {
    expect(layoutFor(1440, false, 'moments')).toMatchObject({
      place: 'closed',
      stageWidth: 1416,
      barTranscript: true,
    });
  });

  it('cannot pin under 960, so the bar has the tool (D10)', () => {
    expect(layoutFor(959, true, 'moments')).toMatchObject({ wide: false, place: 'float' });
    expect(layoutFor(960, true, 'moments')).toMatchObject({ wide: true, place: 'pinned' });
    expect(layoutFor(760, false, 'moments')).toMatchObject({
      place: 'closed',
      barTranscript: true,
    });
  });

  it('floats the panel beside a full capsule at 940 (D10b)', () => {
    expect(layoutFor(940, true, 'moments')).toMatchObject({
      place: 'float',
      panelWidth: 360,
      capsule: 'full',
    });
  });

  it('takes the Compact capsule when the free width is under 452 on a stage of 640 or more (D10c)', () => {
    // 760 − 24 = 736 stage; 736 − 372 = 364 free.
    expect(layoutFor(760, true, 'moments')).toMatchObject({ place: 'float', capsule: 'compact' });
    // 848 − 24 = 824; 824 − 372 = 452: just enough for the full capsule.
    expect(layoutFor(848, true, 'moments').capsule).toBe('full');
    expect(layoutFor(847, true, 'moments').capsule).toBe('compact');
  });

  it('covers a stage under 640 with the sheet, and keeps the full capsule (D10d)', () => {
    expect(layoutFor(600, true, 'moments')).toMatchObject({
      place: 'sheet',
      capsule: 'full',
      panelWidth: 576,
    });
    expect(layoutFor(664, true, 'moments').place).toBe('float');
    expect(layoutFor(663, true, 'moments').place).toBe('sheet');
  });

  it('never lays out narrower than the 560 minimum window', () => {
    expect(layoutFor(320, true, 'moments')).toEqual(layoutFor(560, true, 'moments'));
  });

  it('draws Continuum on the stage while wide, and falls back to the panel under 960 (T5, T6)', () => {
    expect(layoutFor(1440, true, 'continuum')).toMatchObject({
      continuum: true,
      place: 'closed',
      stageWidth: 1416,
      barTranscript: false,
    });
    expect(layoutFor(940, true, 'continuum')).toMatchObject({ continuum: false, place: 'float' });
  });
});

describe('the transcript’s opening state', () => {
  it('opens pinned where it can, and closed where it cannot', () => {
    expect(initialTranscript(1440)).toEqual({ open: true, hiddenByUser: false });
    expect(initialTranscript(800)).toEqual({ open: false, hiddenByUser: false });
  });

  it('keeps a conversation on screen when the column goes, floating', () => {
    const pinned = initialTranscript(1440);
    expect(transcriptOnResize(pinned, true, false, true)).toEqual({
      open: true,
      hiddenByUser: false,
    });
  });

  it('closes when the column goes before there is any conversation', () => {
    expect(transcriptOnResize(initialTranscript(1440), true, false, false).open).toBe(false);
  });

  it('pins again when the column comes back, unless the person hid it', () => {
    const closedNarrow = { open: false, hiddenByUser: false };
    expect(transcriptOnResize(closedNarrow, false, true, true).open).toBe(true);
    const hidden = toggleTranscript(initialTranscript(1440));
    expect(hidden).toEqual({ open: false, hiddenByUser: true });
    expect(transcriptOnResize(hidden, false, true, true).open).toBe(false);
  });

  it('changes nothing while the width stays on one side of 960', () => {
    const state = { open: false, hiddenByUser: true };
    expect(transcriptOnResize(state, true, true, true)).toBe(state);
  });
});

describe('captionMode', () => {
  it('hides them beside a pinned column, under a floating panel or a sheet, and shows them with the transcript closed', () => {
    expect(captionMode(layoutFor(1440, true, 'moments'))).toBe('off');
    expect(captionMode(layoutFor(940, true, 'moments'))).toBe('off');
    expect(captionMode(layoutFor(600, true, 'moments'))).toBe('off');
    expect(captionMode(layoutFor(760, false, 'moments'))).toBe('on');
    expect(captionMode(layoutFor(1440, false, 'moments'))).toBe('on');
  });

  it('leaves the words to Continuum while it is drawn', () => {
    expect(captionMode(layoutFor(1440, true, 'continuum'))).toBe('off');
  });
});
