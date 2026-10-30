import { sourceIcons } from '../app/sources';
import type { TalkMode } from '../kit/capsule/capsuleCopy';
import type { IconName } from '../kit/icons';
import { percent } from '../settings/copy';
import type { WindowMode } from '../compact/compact';
import { kindWords, type SourceKind } from '../vision/vision';
import { quickCopy as copy } from './copy';

export type QuickTileId =
  | 'hands-free'
  | 'captions'
  | 'transcript'
  | 'type'
  | 'mute'
  | 'text-size'
  | 'pause-vision'
  | 'source'
  | 'window';

export interface QuickTile {
  id: QuickTileId;
  label: string;
  icon: IconName;
  /** For a toggle, whether it is on; null for an action, which never looks on. */
  on: boolean | null;
  /** The line under the label: "On", "100%", the kind shared; the reason while it cannot act. */
  value: string;
  /**
   * The key that does the same, as its cap shows it on the value line ; none when it has no key, and the line stays empty.
   */
  keyCap?: string;

  reason?: string;
  /** The reason's whole sentence where the line holds its short form: the tooltip and description. */
  detail?: string;

  options?: boolean;

  menu?: boolean;
}

export interface QuickState {
  name: string;
  talkMode: TalkMode;
  captions: boolean;
  /** The transcript shows: pinned, floating or as a sheet. */
  transcriptOpen: boolean;

  continuum: boolean;
  muted: boolean;
  /** The browser has no microphone to give (kit `MicrophoneIssue.Missing`). */
  microphoneMissing: boolean;
  textScale: number;
  /** The Type key as its cap shows it; empty for none. */
  typeKey: string;
  paused: boolean;
  /**
   * Why Pause vision cannot act now, or undefined: nothing is shared, a share is starting, or an
   * area is being chosen. `detail` is the capsule tool's whole sentence.
   */
  pauseBlocked?: { cause: 'nothing' | 'starting' | 'choosing'; detail: string };
  /** What is shared, or null while nothing is. */
  sourceKind: SourceKind | null;
  /** The Window tile stands in the app's row (see `showsWindowTile`). */
  windowTile: boolean;
  windowMode: WindowMode;
}

const toggleValue = (on: boolean) => (on ? copy.on : copy.off);

const pauseWords = {
  nothing: copy.pauseNothing,
  starting: copy.pauseStarting,
  choosing: copy.pauseChoosing,
} as const;

/** A reason, where there is one: the tile is dimmed and says it on its value line. */
const dimmedBy = (reason: string | undefined) => (reason === undefined ? {} : { reason });

export function packageTiles(state: QuickState): QuickTile[] {
  const microphone = state.microphoneMissing ? copy.noMicrophone : undefined;
  const handsFree = state.talkMode === 'hands-free';
  const tiles: QuickTile[] = [
    {
      id: 'hands-free',
      label: copy.handsFree,
      icon: 'mic',
      on: handsFree,
      value: microphone ?? toggleValue(handsFree),
      ...dimmedBy(microphone),
    },
    {
      id: 'captions',
      label: copy.captions,
      icon: 'captions',
      on: state.captions,
      value: toggleValue(state.captions),
    },
    {
      id: 'transcript',
      label: copy.transcript,
      icon: 'transcript',
      on: state.transcriptOpen,
      value: toggleValue(state.transcriptOpen),
    },
    {
      id: 'type',
      label: copy.type,
      icon: 'keyboard',
      on: null,
      value: '',
      ...(state.typeKey === '' ? {} : { keyCap: state.typeKey }),
    },
    {
      id: 'mute',
      label: copy.mute,
      icon: 'mic-off',
      on: state.muted,
      value: microphone ?? toggleValue(state.muted),
      ...dimmedBy(microphone),
    },
    {
      id: 'text-size',
      label: copy.textSize,
      icon: 'text-size',
      on: null,
      value: percent(state.textScale),
      options: true,
    },
  ];
  return tiles.filter((tile) => tile.id !== 'transcript' || !state.continuum);
}

export function appTiles(state: QuickState): QuickTile[] {
  const blocked = state.pauseBlocked;
  const pauseReason = blocked ? pauseWords[blocked.cause] : undefined;
  const tiles: QuickTile[] = [
    {
      id: 'pause-vision',
      label: copy.pauseVision,
      icon: 'view-off',
      on: state.paused,
      value: pauseReason ?? toggleValue(state.paused),
      ...dimmedBy(pauseReason),
      ...(blocked ? { detail: blocked.detail } : {}),
    },
    {
      id: 'source',
      label: copy.source,
      // The kind shared, as the chip draws it; a source icon while nothing is shared.
      icon: state.sourceKind === null ? 'source-region' : sourceIcons[state.sourceKind],
      on: null,
      value: state.sourceKind === null ? copy.nothing : kindWords[state.sourceKind],
    },
  ];
  if (state.windowTile)
    tiles.push({
      id: 'window',
      label: copy.window,
      icon: 'panel',
      on: null,
      value: state.windowMode === 'compact' ? copy.compact : copy.full,
      menu: true,
    });
  return tiles;
}

export const switchLeastWidth = 640;

export function switchGivesWay(windowWidth: number): boolean {
  return windowWidth < switchLeastWidth;
}

export function showsWindowTile(floats: boolean, windowWidth: number): boolean {
  return floats || switchGivesWay(windowWidth);
}
