import type { TranscriptPlace } from './layout';
import { previewInset, previewBottom, previewPlace } from './preview';

/** How the bar stands: 12 under the title bar, or 12 under a notice (15b, 2). */
export const cropBar = {
  fromTop: 12,
  underNotice: 12,
  /** Kept between the bar and the picture under it. */
  pictureUnder: 16,
} as const;

/** The bar's height: its 40 buttons, which grow with the text (gain 1), and 8 round them (56 at 1.00). */
export function barHeight(textScale: number): number {
  return 40 * textScale + 16;
}

export const cropMarks = {
  edge: 2,
  hairline: 1,
  handle: 10,
  /** How near a corner a press still takes its handle, in points: more than the handle drawn. */
  reach: 12,
  /** The readout stands this far over the area (36: its 28 and 8 between them). */
  readoutAbove: 36,
  readoutClearance: 8,

  readoutInside: 6,
  /** Under this side an area's handles stand outside its corners, so the least area can be held. */
  smallArea: 40,
} as const;

/** The bar's line: what can be done now; short where it does not fit; then none. */
export const cropHint = {
  whole: 'Drag to change the area · Esc to cancel',
  short: 'Drag to change the area',
  /** Before the share's first picture there is nothing to drag yet: only the way out. */
  waiting: 'Esc to cancel',
} as const;

export const cropCopy = {
  cancel: 'Cancel',
  share: 'Share area',
  waiting: 'Waiting for your browser…',

  slow: 'Taking longer than usual',
} as const;

/**
 * Where the bar stands, from the stage's top: in the Island's place, 12 under the title bar; 12 under
 * a notice that stands there (`noticeBottom`, from the stage's top; null when none shows).
 */
export function cropBarTop(noticeBottom: number | null): number {
  if (noticeBottom === null || noticeBottom <= 0) return cropBar.fromTop;
  return Math.max(cropBar.fromTop, noticeBottom + cropBar.underNotice);
}

export interface Place {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

/**
 * The picture's room: where the preview stands (28 in, 120 over the stage's bottom for the capsule),
 * and always under the bar with 16 between them, so a notice that pushes the bar down moves the
 * picture with it and nothing under the bar takes a press meant for the picture.
 */
export function cropPicturePlace(
  barTop: number,
  place: TranscriptPlace,
  textScale: number,
  floatRight: number,
): Place {
  const preview = previewPlace(place, textScale, floatRight);
  return {
    top: Math.max(preview.top, barTop + barHeight(textScale) + cropBar.pictureUnder),
    left: previewInset,
    right: previewInset + floatRight,
    bottom: previewBottom,
  };
}

export type HintForm = 'whole' | 'short' | 'none';

export interface BarWidths {
  /** The whole line and its short form, at the text size. */
  whole: number;
  short: number;
  /** Cancel and "Share area" with their own padding. */
  cancel: number;
  share: number;
}

/**
 * The bar around its words: 20 before the line and 16 after it; 8 between the buttons and round them.
 * Without a line, the bar is the two buttons with 8 round them.
 */
export const barAround = { start: 20, afterLine: 16, between: 8, end: 8 } as const;

/** The bar's width with a line this wide (0 for none). */
export function barWidth(line: number, widths: BarWidths): number {
  const before = line > 0 ? barAround.start + line + barAround.afterLine : barAround.end;
  return before + widths.cancel + barAround.between + widths.share + barAround.end;
}

export function barRoom(stageWidth: number): number {
  return stageWidth - 2 * previewInset;
}

export function hintForm(room: number, widths: BarWidths): HintForm {
  if (barWidth(widths.whole, widths) <= room) return 'whole';
  if (barWidth(widths.short, widths) <= room) return 'short';
  return 'none';
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The handles' radius with its hairline: what a readout keeps clear of. */
const handleReach = cropMarks.handle / 2 + cropMarks.hairline;

/**
 * Where each handle is drawn in the picture (top left, top right, bottom left, bottom right): on its
 * corner, just outside it for a small area, and never less than its own reach inside the picture, so
 * the frame's clip never cuts one. The area keeps its true place; only its marks move.
 */
export function handleCentres(area: Rect, picture: { width: number; height: number }): Point[] {
  const small = Math.min(area.width, area.height) < cropMarks.smallArea;
  const out = small ? cropMarks.handle / 2 : 0;
  const corners: [number, number, number, number][] = [
    [area.x, area.y, -1, -1],
    [area.x + area.width, area.y, 1, -1],
    [area.x, area.y + area.height, -1, 1],
    [area.x + area.width, area.y + area.height, 1, 1],
  ];
  const clamp = (value: number, size: number) =>
    Math.min(Math.max(value, handleReach), Math.max(handleReach, size - handleReach));
  return corners.map(([x, y, dx, dy]) => ({
    x: clamp(x + dx * out, picture.width),
    y: clamp(y + dy * out, picture.height),
  }));
}

export function readoutPlace(
  area: Rect,
  chip: { width: number; height: number },
  picture: { width: number; height: number },
): Point & { where: 'over' | 'inside' | 'under' } {
  const left = Math.max(0, Math.min(area.x, picture.width - chip.width));
  const handles = handleCentres(area, picture);
  // Past the top handles where a small area's stand outside its corners.
  const over = Math.min(
    area.y - cropMarks.readoutAbove,
    (handles[0]?.y ?? area.y) - handleReach - chip.height,
  );
  if (over >= cropMarks.readoutClearance && left + chip.width <= picture.width) {
    return { x: left, y: over, where: 'over' };
  }
  const topLeft = handles[0] ?? { x: area.x, y: area.y };
  // Past the top-left handle where it is drawn inside the area (an area on the picture's edge).
  const insideX = Math.max(
    area.x + cropMarks.readoutInside,
    topLeft.x > area.x ? topLeft.x + handleReach + cropMarks.readoutInside : 0,
  );
  const insideY = area.y + cropMarks.readoutInside;
  const fitsInside =
    insideX + chip.width <= area.x + area.width - handleReach &&
    insideY + chip.height <= area.y + area.height - handleReach;
  if (fitsInside) return { x: insideX, y: insideY, where: 'inside' };
  const under = area.y + area.height + cropMarks.readoutAbove - chip.height;
  return {
    x: left,
    y: Math.max(0, Math.min(under, picture.height - chip.height)),
    where: 'under',
  };
}
