/** The gutter round the stage and between the stage and the transcript column. */
export const gutter = 12;

export const pinFrom = 960;

export const widePanelFrom = 1680;
export const panelWidth = 380;
export const widePanelWidth = 420;

export const floatWidth = 360;
export const floatInset = 12;
/** What a floating panel takes from the stage: its width and its inset (stage − 372). */
export const floatTakes = floatWidth + floatInset;
/** The full capsule needs 420 + 2 × 16 beside a floating panel; less, and it goes Compact. */
export const fullCapsuleNeeds = 452;

export const sheetBelow = 640;
export const minimumWindow = 560;

export type TranscriptPlace = 'pinned' | 'float' | 'sheet' | 'closed';
export type TranscriptStyle = 'moments' | 'conversation' | 'continuum';

export interface WindowLayout {
  /** The window is wide enough to pin the column. */
  wide: boolean;
  place: TranscriptPlace;
  /** The pinned column's width, or the floating panel's. */
  panelWidth: number;
  stageWidth: number;

  capsule: 'full' | 'compact';

  barTranscript: boolean;

  continuum: boolean;
}

/** Lays the window out for its width, whether the transcript is open, and its style. */
export function layoutFor(width: number, open: boolean, style: TranscriptStyle): WindowLayout {
  const room = Math.max(width, minimumWindow);
  const wide = room >= pinFrom;
  const column = room >= widePanelFrom ? widePanelWidth : panelWidth;

  const continuum = style === 'continuum' && wide;
  const full = room - 2 * gutter;
  if (continuum) {
    return {
      wide,
      place: 'closed',
      panelWidth: 0,
      stageWidth: full,
      capsule: 'full',
      barTranscript: false,
      continuum,
    };
  }
  if (wide) {
    return {
      wide,
      place: open ? 'pinned' : 'closed',
      panelWidth: column,
      stageWidth: open ? full - column - gutter : full,
      capsule: 'full',
      barTranscript: !open,
      continuum,
    };
  }
  const place: TranscriptPlace = !open ? 'closed' : full < sheetBelow ? 'sheet' : 'float';
  return {
    wide,
    place,
    panelWidth: place === 'float' ? floatWidth : full,
    stageWidth: full,
    capsule: place === 'float' && full - floatTakes < fullCapsuleNeeds ? 'compact' : 'full',
    barTranscript: true,
    continuum,
  };
}

/** Whether the transcript is open, and whether the person hid it themselves. */
export interface TranscriptOpen {
  open: boolean;
  hiddenByUser: boolean;
}

/** The transcript's opening state for a window that opens at `width`: pinned when it can be. */
export function initialTranscript(width: number): TranscriptOpen {
  return { open: width >= pinFrom, hiddenByUser: false };
}

/**
 * What a change of width does to the transcript. Losing the column while it shows a
 * conversation keeps it on screen, floating; with no turns yet it closes. The column coming back pins
 * it again, unless the person hid it.
 */
export function transcriptOnResize(
  state: TranscriptOpen,
  wasWide: boolean,
  isWide: boolean,
  hasTurns: boolean,
): TranscriptOpen {
  if (wasWide === isWide) return state;
  if (isWide) return { ...state, open: !state.hiddenByUser };
  return { ...state, open: state.open && hasTurns };
}

/** The person opens or closes the transcript (R, the bar tool, Close, Esc). */
export function toggleTranscript(state: TranscriptOpen, open = !state.open): TranscriptOpen {
  return { open, hiddenByUser: !open };
}

export type CaptionMode = 'off' | 'on';

export function captionMode(layout: WindowLayout): CaptionMode {
  if (layout.continuum) return 'off';
  switch (layout.place) {
    case 'pinned':
    case 'float':
    case 'sheet':
      return 'off';
    case 'closed':
      return 'on';
  }
}
