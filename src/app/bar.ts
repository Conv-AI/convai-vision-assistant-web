import { chipMaxWidth } from './sources';

/** The bar's gap between its parts (app.css `.va-bar`). */
const gap = 12;

/** Where the bar's parts end and start, measured, and the source chip's width as drawn. */
export interface BarParts {
  width: number;
  /** The character chip's right edge (the bar's left padding when there is none). */
  characterEnd: number;
  /** The tools' left edge. */
  toolsStart: number;
  /** The source chip's width. */
  chip: number;
}

export interface SourcePlace {
  /** The widest the source chip may be: what the window gives it, within the room left free. */
  room: number;
  /** The chip's left edge in the bar. */
  left: number;
  /** How far the source menu moves from under the chip's centre to stay 8 inside the window. */
  menuShift: number;
}

/** The source menu's width (app.css `.va-source-menu`) and its least distance from the window's sides. */
const menuWidth = 352;
const menuMargin = 8;

export function sourcePlace({ width, characterEnd, toolsStart, chip }: BarParts): SourcePlace {
  const from = characterEnd + gap;
  const to = toolsStart - gap;
  const room = Math.max(0, Math.min(chipMaxWidth(width), to - from));
  let left = width / 2 - chip / 2;
  if (left + chip > to) left = to - chip;
  if (left < from) left = from;
  left = Math.round(left);
  // The menu opens centred under the chip; slid beside a long name it would cross the window's edge.
  const centre = left + chip / 2;
  const menuShift =
    Math.min(0, width - menuMargin - (centre + menuWidth / 2)) +
    Math.max(0, menuMargin - (centre - menuWidth / 2));
  return { room, left, menuShift };
}
