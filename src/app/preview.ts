import type { TranscriptPlace } from './layout';

/** The preview stands 28 in from the stage's sides and 120 above its bottom, over the capsule. */
export const previewInset = 28;
export const previewBottom = 120;

export function bandHeight(textScale: number): number {
  return textScale >= 1.3 ? 48 : textScale >= 1.15 ? 44 : 40;
}

export function islandTop(place: TranscriptPlace): number {
  return place === 'float' ? 12 : 16;
}

export interface PreviewPlace {
  top: number;
  /** The line is centred on the band: IslandTop + (band − 24) ÷ 2. */
  lineTop: number;
  left: number;
  /** 28, and the floating panel's room beside it. */
  right: number;
  bottom: number;
}

export function previewPlace(
  place: TranscriptPlace,
  textScale: number,
  floatRight: number,
): PreviewPlace {
  const band = bandHeight(textScale);
  const top = islandTop(place);
  return {
    top: top + band + 8,
    lineTop: top + (band - 24) / 2,
    left: previewInset,
    right: previewInset + floatRight,
    bottom: previewBottom,
  };
}

export interface PreviewLine {
  whole: string;
  short: string;
}

export function previewLine(name: string): PreviewLine {
  return { whole: `Live preview · ${name} sees this while you share`, short: 'Live preview' };
}

export function pausedLine(name: string): PreviewLine {
  return { whole: `Paused · ${name} can’t see this`, short: 'Paused' };
}

export function imageLine(fileName: string, paused = false): PreviewLine {
  return paused
    ? { whole: `Paused · Image · ${fileName}`, short: 'Paused' }
    : { whole: `Image · ${fileName}`, short: 'Image' };
}

export const toastAround = 72;
export const toastNameSlot = 240;
export const islandMaxWidth = 460;

export function widestToast(nowSharingWords: number, islandRoom: number): number {
  return Math.min(islandMaxWidth, islandRoom - 32, toastAround + nowSharingWords + toastNameSlot);
}

/** Where the picture stands inside the preview's place: fitted, never cropped. */
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function fitFrame(
  place: { width: number; height: number },
  picture: { width: number; height: number } | null,
): Frame {
  if (!picture || picture.width <= 0 || picture.height <= 0) {
    return { x: 0, y: 0, width: place.width, height: place.height };
  }
  const scale = Math.min(place.width / picture.width, place.height / picture.height);

  const width = Math.round(picture.width * scale);
  const height = Math.round(picture.height * scale);
  return { x: Math.round((place.width - width) / 2), y: 0, width, height };
}

export function lineLeft(frameLeft: number, frameWidth: number, words: number): number {
  if (words <= frameWidth) return frameLeft;
  return Math.max(previewInset, frameLeft + (frameWidth - words) / 2);
}

export interface LineInput {
  /** Where the whole line would start, from the stage's left. */
  left: number;
  /** The width the Island is centred in: the stage, less a floating panel's room. */
  islandRoom: number;
  /** The whole line's width at the text size. */
  whole: number;
  /** "Now sharing · " in a toast's words at the text size. */
  nowSharingWords: number;

  bannerShows: boolean;
}

export function lineForm({ left, islandRoom, whole, nowSharingWords, bannerShows }: LineInput): {
  short: boolean;
} {
  const centre = islandRoom / 2;
  const reach = centre - widestToast(nowSharingWords, islandRoom) / 2;
  const short = bannerShows || left + whole + 12 > reach || whole > islandRoom - 2 * previewInset;
  return { short };
}
