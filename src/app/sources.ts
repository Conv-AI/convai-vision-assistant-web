import type { CapsuleSource } from '../kit/capsule/Capsule';
import type { IconName } from '../kit/icons';
import { kindWords, type SourceKind, type VisionState } from '../vision/vision';
import { fitTitle } from './titleCut';

export type ChipMark = 'live' | 'starting' | 'paused' | 'failed' | 'none';

/** Each kind's glyph, in the chip and in the menu . */
export const sourceIcons: Record<SourceKind, IconName> = {
  camera: 'source-camera',
  screen: 'source-screen',
  window: 'source-window',
  tab: 'source-tab',
  region: 'source-region',
  image: 'source-image',
};

export interface ChipWords {
  mark: ChipMark;

  icon: IconName | null;

  passive: boolean;

  quiet: boolean;
  /** The kind, in 600: "Camera", "Browser tab", "Nothing shared". */
  kind: string;
  /** The source's name, or a problem's cause, in text.secondary; may be empty. */
  name: string;
  /** Everything the chip says, for its tooltip while it is cut. */
  full: string;
  /** The state a screen reader hears after the words: ", live". */
  state: string;
}

export function chipWords(vision: VisionState, failureShows: boolean): ChipWords {
  const { share, source, failure, crop } = vision;
  if (crop) {
    return {
      mark: 'none',
      icon: null,
      passive: true,
      quiet: true,
      kind: 'Choosing an area',
      name: '',
      full: 'Choosing an area',
      state: '',
    };
  }
  if (share === 'none') {
    if (failure && failureShows) {
      return {
        mark: 'failed',
        icon: 'source-camera',
        passive: false,
        quiet: false,
        kind: 'Camera',
        name: failure.cause,
        full: `Camera · ${failure.cause}`,
        state: ', failed',
      };
    }
    return {
      mark: 'none',
      icon: null,
      passive: false,
      quiet: true,
      kind: 'Nothing shared',
      name: '',
      full: 'Nothing shared',
      state: '',
    };
  }
  const kind = source?.kind ?? 'camera';
  const name = source?.name ?? '';
  const paused = vision.paused && share === 'live';
  const words = name === '' ? kindWords[kind] : `${kindWords[kind]} · ${name}`;
  return {
    mark: kind === 'image' ? 'none' : paused ? 'paused' : share,
    icon: sourceIcons[kind],
    passive: false,
    quiet: false,
    kind: kindWords[kind],

    name: share === 'starting' ? '' : name,
    full: paused ? `${words} · paused` : words,

    state: paused || kind === 'image' ? '' : share === 'live' ? ', live' : ', starting',
  };
}

/** The chip's parts around its words (app.css `.va-chip`): padding, slot, glyph and chevron. */
const chipAround = {
  padding: 12 + 12,
  slot: 8 + 8,
  glyph: 16 + 8,
  chevron: 8 + 12,
} as const;

/** What stands between the kind and the name: "Camera · Integrated Camera". */
export const chipSeparator = ' · ';

/** The chip's words in the room it has: with its kind and glyph, or the name alone, cut. */
export interface ChipFit {
  /** The kind and its glyph are shown. */
  kind: boolean;
  name: string;
}

export function chipMaxWidth(barWidth: number): number {
  return Math.max(220, barWidth - 760);
}

export function chipFit(
  words: ChipWords,
  widest: number,
  measureKind: (text: string) => number,
  measureName: (text: string) => number,
): ChipFit {
  if (words.name === '') return { kind: true, name: '' };
  const room =
    widest -
    chipAround.padding -
    (words.mark === 'none' ? 0 : chipAround.slot) -
    chipAround.chevron;
  const withKind =
    chipAround.glyph + measureKind(words.kind) + measureName(`${chipSeparator}${words.name}`);
  if (withKind <= room) return { kind: true, name: words.name };
  return { kind: false, name: fitTitle(words.name, room, measureName) };
}

export function floatingSource(words: ChipWords): CapsuleSource | null {
  if (words.quiet) return null;
  return { mark: words.mark === 'starting' ? 'none' : words.mark, words: words.full };
}
