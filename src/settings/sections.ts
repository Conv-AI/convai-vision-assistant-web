import type { SelectOption } from '../kit/controls/Select';
import type { SegmentedOption } from '../kit/controls/Segmented';
import type { TalkMode } from '../kit/capsule/capsuleCopy';
import type { SystemSwitch } from '../kit/preferences';
import { maxTextScale, minTextScale } from '../kit/preferences';
import type { TranscriptStyle } from '../app/layout';
import { cardLine } from '../compact/copy';
import { percent, settingsCopy as copy, shortcutCopy } from './copy';
import type { MicrophoneTestState } from './microphoneTest';
import { defaultKeys, keyCap, type ChangeableId, type WindowKeys } from './shortcuts';
import type { Settings } from './stored';

export type SectionId =
  'talking' | 'audio' | 'access' | 'shortcuts' | 'window' | 'vision' | 'privacy' | 'about';

export type PageId = 'howto' | 'licenses';

interface RowBase {
  /** Stable within its section: what "Show in …" points out. */
  id: string;
  label: string;
  description?: string;
  /** The description says something went wrong: it is drawn as a warning. */
  warning?: boolean;
  /** Extra words the search finds the row by. */
  keywords?: string;
  /** The label in the heavier weight: a card at the head of a section (About). */
  strong?: boolean;
  /** What went wrong with the row's last action, under its line, as a warning. */
  problem?: string;
  /** Text to select and copy by hand, in a block under the row (a copy that failed). */
  detail?: string;
}

export type Row =
  | (RowBase & { kind: 'switch'; on: boolean; set: (on: boolean) => void })
  | (RowBase & {
      kind: 'segmented';
      options: readonly SegmentedOption<string>[];
      value: string;
      set: (value: string) => void;
    })
  | (RowBase & {
      kind: 'select';
      options: readonly SelectOption[];
      value: string;
      set: (value: string) => void;
    })
  | (RowBase & {
      kind: 'slider';
      min: number;
      max: number;
      step: number;
      value: number;
      set: (value: number) => void;
      format: (value: number) => string;
      /** The two ends picture the scale: a small A and a large one (Text size). */
      growingEnds?: boolean;
      /** A line under the row at the caption's size, showing the value being chosen. */
      sample?: string;
    })
  | (RowBase & {
      kind: 'button';
      action: string;
      danger?: boolean;
      /** Why the button cannot act now, said under the row; undefined when it can. */
      reason?: string;
      /** Something under way: the button shows it and takes no press. */
      busy?: boolean;

      primary?: boolean;
      run: () => void;
    })
  | (RowBase & { kind: 'keys'; keys: readonly string[]; hold: boolean })
  | (RowBase & {
      kind: 'cards';
      options: readonly { value: TranscriptStyle; label: string; line: string }[];
      value: TranscriptStyle;
      set: (value: TranscriptStyle) => void;
    })
  /**
   * A row that only says something: a section's empty state (no microphone), or a fact with its
   * value at the end (Compact on the web: "Supported").
   */
  | (RowBase & { kind: 'note'; value?: string })
  | (RowBase & {
      kind: 'shortcut';
      /** The shortcut a press changes; null for one that cannot be changed. */
      changes: ChangeableId | null;
      /** The caps now ("Shift", "T"); empty when it has no key. */
      caps: readonly string[];
      /** A key that is held, not pressed: "Hold" before the caps. */
      hold: boolean;
      /** Its key is not its default: "Changed" and Reset show. */
      changed: boolean;
      /** Locked: the lock after the caps. */
      locked: boolean;
    })
  /** A row that opens something: a section, a pushed page, a key's recording (chevron). */
  | (RowBase & {
      kind: 'link';
      open: () => void;
      /** Key caps before the chevron (the talk key in Talking). */
      keys?: readonly string[];
      /** A value before the chevron (a license's name). */
      value?: string;
    })
  | (RowBase & { kind: 'info'; icon: string })
  | (RowBase & { kind: 'step'; number: number; keys: readonly string[] });

/** The card above Talking's groups: who is listening, with Change. */
export interface CharacterCard {
  name: string;
  line: string;
  portrait: string | null;
  change: () => void;
}

export interface Group {
  /** Empty for a group with no label. */
  label: string;
  rows: Row[];
  /** One action for the group, on its label line ("Reset all shortcuts"). */
  action?: { label: string; run: () => void };
  /** A quiet line under the group. */
  note?: string;
}

export interface Section {
  id: SectionId;
  title: string;
  /** The 16 px drawing in the sidebar . */
  icon: string;
  /** A label in the sidebar above this section ("Vision Assistant"). */
  labelBefore?: string;
  /** A gap in the sidebar above this section. */
  gapBefore?: boolean;
  /** The line above the groups. */
  intro?: string;
  card?: CharacterCard;
  groups: Group[];
}

/** A pushed page: its title (with the back arrow) and its groups. */
export interface Page {
  id: PageId;
  title: string;
  groups: Group[];
}

/** Part - Settings' 16 px drawings: the sidebar's. */
export const sectionIcons: Record<SectionId, string> = {
  talking: 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z',
  audio: 'M2 6h3l4-3v10l-4-3H2z M11.5 5.5a3.5 3.5 0 010 5',
  access:
    'M8 1.5a1.3 1.3 0 110 2.6 1.3 1.3 0 010-2.6z M2.5 5.5L8 6.5l5.5-1 M8 6.5v3.5 M5.5 14.5L8 10l2.5 4.5',
  shortcuts: 'M1.5 4h13v8.5h-13z M4 7h1M7 7h1M10 7h2M4.5 10h7',
  window: 'M1.5 3h13v10h-13z M1.5 6h13 M10 6v7',
  vision: 'M1.5 5V1.5H5 M11 1.5h3.5V5 M14.5 11v3.5H11 M5 14.5H1.5V11',
  privacy: 'M8 1.5l5 2v4c0 3.2-2.2 5.6-5 7-2.8-1.4-5-3.8-5-7v-4z',
  about: 'M8 1.5a6.5 6.5 0 110 13 6.5 6.5 0 010-13z M8 7v4.5 M8 4.6v.1',
};

/** Privacy's tiles . */
const infoIcons = {
  microphone: 'M5.5 4a2.5 2.5 0 015 0v3.5a2.5 2.5 0 01-5 0z M3 7.5a5 5 0 0010 0M8 12.5v2',
  keyboard: sectionIcons.shortcuts,
  vision: sectionIcons.vision,
  gear: 'M8 5.8a2.2 2.2 0 100 4.4 2.2 2.2 0 000-4.4z M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2',
  picture: 'M1.5 3.5h13v9h-13z M1.5 10.5l3.5-3 3 2.5 2.5-2 4 3.5',
} as const;

/** What the sections are built from: the values now and what changes them. */
export interface SettingsContext {
  name: string;
  /** Null until a character is known: Talking then has no card. */
  character: { line: string; portrait: string | null } | null;
  talkMode: TalkMode;
  /** The talk key as its cap shows it ("T"); empty when it has none. */
  talkKey: string;
  settings: Settings;
  set: (change: Partial<Settings>) => void;
  setTalkMode: (mode: TalkMode) => void;
  openPicker: () => void;
  /** True while an answer is under way, when the conversation cannot be cleared. */
  answering: boolean;
  askClear: () => void;
  /** The microphones offered; null until the browser listed them, empty when it has none. */
  microphones: readonly SelectOption[] | null;
  microphone: string;
  setMicrophone: (value: string) => void;
  /** The last microphone chosen could not be used: the row says so under its label. */
  microphoneFailed: boolean;
  /** The browser names its microphones (it does only once the microphone is allowed). */
  microphonesNamed: boolean;
  test: MicrophoneTestState;
  startTest: () => void;
  /** True on Apple's systems: chords show ⌘ and ⌥. */
  apple: boolean;

  keys: WindowKeys;

  changeTalkKey: () => void;
  /** Asks before every key goes back to its default. */
  askResetAll: () => void;

  openSection: (section: SectionId) => void;
  openPage: (page: PageId) => void;
  /** The cameras offered; null until the browser listed them, empty when it has none. */
  cameras: readonly SelectOption[] | null;
  camera: string;
  setCamera: (value: string) => void;
  /** The browser names its cameras (it does only once a camera is allowed). */
  camerasNamed: boolean;
  /** The app's version ("0.0.0"). */
  version: string;
  /** The row whose copy button just copied, or whose copy failed. */
  copied: { row: string; ok: boolean } | null;
  copyVersion: () => void;
  /** What Copy details copies: the version, the browser and the character's ID. */
  supportDetails: string;
  copyDetails: () => void;
  showWelcome: () => void;

  showTips: () => void;
  /** Show tips again was pressed while Settings is open: the tips start once it closes. */
  tipsAgain: boolean;

  tryTips: () => void;

  compactSupported: boolean;
}

const switchOptions = (): SegmentedOption<SystemSwitch>[] => [
  { value: 'system', label: copy.system },
  { value: 'on', label: copy.on },
  { value: 'off', label: copy.off },
];

function talking(context: SettingsContext): Section {
  const { name, settings, set } = context;
  const howYouTalk: Row[] = [
    {
      id: 'mode',
      kind: 'segmented',
      label: copy.mode,
      keywords: 'push talk hands free voice',
      options: [
        { value: 'hands-free', label: copy.handsFree },
        { value: 'push-to-talk', label: copy.pushToTalk },
      ],
      value: context.talkMode,
      set: (value) => {
        context.setTalkMode(value === 'hands-free' ? 'hands-free' : 'push-to-talk');
      },
    },
  ];

  if (context.talkMode === 'push-to-talk') {
    howYouTalk.push({
      id: 'talk-key',
      kind: 'link',
      label: copy.talkKey,
      description: copy.talkKeyLine,
      keywords: 'shortcut keyboard',
      ...(context.talkKey === '' ? { value: copy.notSet } : { keys: [context.talkKey] }),
      open: context.changeTalkKey,
    });
  }
  return {
    id: 'talking',
    title: copy.talking,
    icon: sectionIcons.talking,
    ...(context.character
      ? {
          card: {
            name,
            line: context.character.line,
            portrait: context.character.portrait,
            change: context.openPicker,
          },
        }
      : {}),
    groups: [
      { label: copy.howYouTalk, rows: howYouTalk },
      {
        label: copy.words(name),
        rows: [
          {
            id: 'captions',
            kind: 'switch',
            label: copy.captions,
            description: copy.captionsLine,
            keywords: 'subtitles',
            on: settings.captions,
            set: (on) => {
              set({ captions: on });
            },
          },
          {
            id: 'transcript-style',
            kind: 'cards',
            label: copy.transcriptStyle,
            description: copy.transcriptStyleLine,
            keywords: 'moments continuum conversation chat bubbles',
            options: (['moments', 'continuum', 'conversation'] as const).map((value) => ({
              value,
              label: copy.styles[value].label,
              line: copy.styles[value].line(name),
            })),
            value: settings.transcriptStyle,
            set: (value) => {
              set({ transcriptStyle: value });
            },
          },
          {
            id: 'clear',
            kind: 'button',
            label: copy.clear,
            keywords: 'transcript history delete',
            action: copy.clearButton,
            danger: true,
            ...(context.answering ? { reason: copy.clearLater(name) } : {}),
            run: context.askClear,
          },
        ],
      },
      {
        label: copy.tips,
        rows: [
          {
            id: 'tips',
            kind: 'button',
            label: copy.showTips,
            description: context.tipsAgain ? copy.showTipsDone : copy.showTipsLine,
            keywords: 'hints help coach first session learn',
            action: copy.showAgain,
            run: context.showTips,
          },
        ],
      },
    ],
  };
}

function audio(context: SettingsContext): Section {
  const { name, settings, set, microphones, test } = context;
  const microphone: Row[] =
    microphones !== null && microphones.length === 0
      ? [
          {
            id: 'no-microphone',
            kind: 'note',
            label: copy.noMicrophone,
            description: copy.noMicrophoneLine(name),
          },
        ]
      : [
          {
            id: 'input-device',
            kind: 'select',
            label: copy.inputDevice,
            ...(context.microphoneFailed
              ? { description: copy.microphoneFailed, warning: true }
              : context.microphonesNamed
                ? {}
                : { description: copy.microphonesUnnamed }),
            keywords: 'mic microphone input',
            // Before the browser lists them, the one microphone there always is.
            options: microphones ?? [{ value: '', label: copy.defaultMicrophone }],
            value: context.microphone,
            set: context.setMicrophone,
          },
          {
            id: 'test',
            kind: 'button',
            label: copy.test,
            description: test.phase === 'failed' ? copy.testFailed : copy.testLine,
            keywords: 'mic record',
            action:
              test.phase === 'recording'
                ? copy.recording(test.left)
                : test.phase === 'playing'
                  ? copy.playing
                  : copy.testButton,
            busy: test.phase === 'recording' || test.phase === 'playing',
            run: context.startTest,
          },
        ];
  return {
    id: 'audio',
    title: copy.audio,
    icon: sectionIcons.audio,
    groups: [
      { label: copy.microphone, rows: microphone },
      {
        label: copy.speaker,
        rows: [
          {
            id: 'volume',
            kind: 'slider',
            label: copy.volume(name),
            keywords: 'loud quiet sound voice',
            min: 0,
            max: 1,
            step: 0.05,
            value: settings.volume,
            set: (volume) => {
              set({ volume });
            },
            format: percent,
          },
        ],
      },
    ],
  };
}

function accessibility(context: SettingsContext): Section {
  const { name, settings, set } = context;
  return {
    id: 'access',
    title: copy.accessibility,
    icon: sectionIcons.access,
    groups: [
      {
        label: copy.reading,
        rows: [
          {
            id: 'text-size',
            kind: 'slider',
            label: copy.textSize,
            description: copy.textSizeLine,
            keywords: 'font bigger larger smaller zoom',
            min: minTextScale,
            max: maxTextScale,
            step: 0.05,
            value: settings.textScale,
            set: (textScale) => {
              set({ textScale });
            },
            format: percent,
            growingEnds: true,
            sample: copy.textSample,
          },
          {
            id: 'caption-backing',
            kind: 'switch',
            label: copy.captionBacking,
            description: copy.captionBackingLine,
            keywords: 'camera subtitles',
            on: settings.captionBacking,
            set: (on) => {
              set({ captionBacking: on });
            },
          },
          {
            id: 'contrast',
            kind: 'segmented',
            label: copy.contrast,
            description: copy.contrastLine,
            keywords: 'high contrast',
            options: switchOptions(),
            value: settings.highContrast,
            set: (value) => {
              set({ highContrast: value as SystemSwitch });
            },
          },
        ],
      },
      {
        label: copy.motion,
        rows: [
          {
            id: 'reduce-motion',
            kind: 'segmented',
            label: copy.reduceMotion,
            description: copy.reduceMotionLine,
            keywords: 'animation',
            options: switchOptions(),
            value: settings.reduceMotion,
            set: (value) => {
              set({ reduceMotion: value as SystemSwitch });
            },
          },
        ],
      },
      {
        label: copy.screenReader,
        rows: [
          {
            id: 'read-answers',
            kind: 'switch',
            label: copy.readAnswers(name),
            description: copy.readAnswersLine(name),
            keywords: 'voiceover narrator nvda jaws',
            on: settings.readAnswers,
            set: (on) => {
              set({ readAnswers: on });
            },
          },
        ],
      },
    ],
  };
}

/** The chords that cannot be changed, as their caps show them here. */
function chordCaps(apple: boolean) {
  const control = apple ? '⌘' : 'Ctrl';
  return {
    settings: [control, ','],
    characters: [control, 'K'],
    pauseVision: [apple ? '⌥' : 'Alt', 'V'],
  };
}

const changeableIds = Object.keys(defaultKeys) as ChangeableId[];

function shortcuts(context: SettingsContext): Section {
  const { keys, name } = context;
  const chords = chordCaps(context.apple);
  const changeable = (id: ChangeableId, label: string, hold = false): Row => ({
    id: `shortcut-${id}`,
    kind: 'shortcut',
    label,
    keywords: 'key keyboard shortcut',
    changes: id,
    caps: keys[id] === '' ? [] : [keyCap(keys[id])],
    hold,
    changed: keys[id] !== defaultKeys[id],
    locked: false,
  });
  const fixed = (id: string, label: string, caps: readonly string[]): Row => ({
    id: `shortcut-${id}`,
    kind: 'shortcut',
    label,
    description: shortcutCopy.cantBeChanged,
    keywords: 'key keyboard shortcut',
    changes: null,
    caps,
    hold: false,
    changed: false,
    locked: true,
  });
  const anyChanged = changeableIds.some((id) => keys[id] !== defaultKeys[id]);
  return {
    id: 'shortcuts',
    title: shortcutCopy.title,
    icon: sectionIcons.shortcuts,
    intro: shortcutCopy.intro,
    groups: [
      {
        label: shortcutCopy.talking,
        rows: [
          changeable('talk', shortcutCopy.talk, true),
          changeable('type', shortcutCopy.type),
          fixed('stop', shortcutCopy.stop(name), ['Esc']),
          changeable('mute', shortcutCopy.mute),
          {
            id: 'shortcut-hands-free',
            kind: 'shortcut',
            label: shortcutCopy.handsFree,
            description: shortcutCopy.handsFreeLine,
            keywords: 'key keyboard shortcut push talk',
            changes: null,
            caps: keys.talk === '' ? [] : ['Shift', keyCap(keys.talk)],
            hold: false,
            changed: false,
            locked: false,
          },
        ],
      },
      {
        label: shortcutCopy.panels,
        rows: [
          changeable('transcript', shortcutCopy.transcript),
          changeable('quick', shortcutCopy.quick),
          fixed('settings', shortcutCopy.settings, chords.settings),
        ],
      },
      {
        label: shortcutCopy.fromApp,
        rows: [
          fixed('characters', shortcutCopy.characters, chords.characters),
          fixed('pause-vision', shortcutCopy.pauseVision, chords.pauseVision),
        ],
        // On the last group, as the kit's web Shortcuts draws it (no "In any app" group here).
        ...(anyChanged
          ? { action: { label: shortcutCopy.resetAll, run: context.askResetAll } }
          : {}),
      },
    ],
  };
}

function windowSection(context: SettingsContext): Section {
  const supported = context.compactSupported;
  return {
    id: 'window',
    title: copy.window,
    icon: sectionIcons.window,
    labelBefore: copy.visionAssistant,
    groups: [
      {
        label: '',
        rows: [
          {
            id: 'compact',
            kind: 'note',
            label: copy.compactOnWeb,
            description: supported ? copy.compactSupportedLine : cardLine(context.name),
            value: supported ? copy.supported : copy.notInBrowser,
            keywords: 'compact floating picture in picture pip small capsule mode',
          },
        ],
      },
    ],
  };
}

function vision(context: SettingsContext): Section {
  const { name, settings, set, cameras } = context;
  const camera: Row =
    cameras !== null && cameras.length === 0
      ? {
          id: 'no-camera',
          kind: 'note',
          label: copy.noCamera,
          description: copy.noCameraLine,
          keywords: 'camera webcam',
        }
      : {
          id: 'camera',
          kind: 'select',
          label: copy.camera,
          ...(context.camerasNamed ? {} : { description: copy.camerasUnnamed }),
          keywords: 'camera webcam video',
          // Before the browser lists them, the one camera a share would open.
          options: cameras ?? [{ value: '', label: copy.defaultCamera }],
          value: context.camera,
          set: context.setCamera,
        };
  return {
    id: 'vision',
    title: copy.vision,
    icon: sectionIcons.vision,
    intro: copy.visionIntro(name),
    groups: [
      {
        label: copy.sources,
        rows: [
          camera,
          {
            id: 'mirror',
            kind: 'switch',
            label: copy.mirror,
            description: copy.mirrorLine(name),
            keywords: 'camera flip preview',
            on: settings.mirrorCamera,
            set: (on) => {
              set({ mirrorCamera: on });
            },
          },
        ],
      },
    ],
  };
}

function privacy(context: SettingsContext): Section {
  const { name } = context;
  const info = (id: string, icon: string, label: string, description: string): Row => ({
    id,
    kind: 'info',
    icon,
    label,
    description,
  });
  return {
    id: 'privacy',
    title: copy.privacy,
    icon: sectionIcons.privacy,
    gapBefore: true,
    intro: copy.privacyIntro(name),
    groups: [
      {
        label: copy.sentToConvai,
        rows: [
          info('say', infoIcons.microphone, copy.whatYouSay, copy.whatYouSayLine(name)),
          info('type', infoIcons.keyboard, copy.whatYouType, copy.whatYouTypeLine(name)),
          info('video', infoIcons.vision, copy.liveVideo, copy.liveVideoLine),
        ],
      },
      {
        label: copy.staysHere,
        rows: [info('kept', infoIcons.gear, copy.yourSettings, copy.yourSettingsLine)],
      },
      {
        label: copy.neverKept,
        rows: [info('recordings', infoIcons.picture, copy.recordings, copy.recordingsLine)],
      },
      {
        label: copy.yourChoices,
        rows: [
          {
            // Words only: a page cannot open the browser's own settings.
            id: 'access',
            kind: 'note',
            label: copy.access,
            description: copy.accessLine,
            keywords: 'camera microphone screen permission allow blocked',
          },
        ],
      },
    ],
  };
}

function about(context: SettingsContext): Section {
  const copiedOn = (row: string) => context.copied?.row === row && context.copied.ok;
  const failedOn = (row: string) => context.copied?.row === row && !context.copied.ok;
  return {
    id: 'about',
    title: copy.about,
    icon: sectionIcons.about,
    groups: [
      {
        label: '',
        rows: [
          {
            id: 'version',
            kind: 'button',
            label: copy.appName,
            strong: true,
            description: copy.versionLine(context.version),
            ...(failedOn('version') ? { problem: copy.copyFailed } : {}),
            keywords: 'version build',
            action: copiedOn('version') ? copy.copied : copy.copyVersion,
            run: context.copyVersion,
          },
        ],
      },
      {
        label: copy.help,
        rows: [
          {
            id: 'howto',
            kind: 'link',
            label: copy.howToUse,
            keywords: 'help guide',
            open: () => {
              context.openPage('howto');
            },
          },
          {
            id: 'keyboard',
            kind: 'link',
            label: copy.keyboardShortcuts,
            keywords: 'keys',
            open: () => {
              context.openSection('shortcuts');
            },
          },
        ],
      },
      {
        label: copy.legal,
        rows: [
          {
            id: 'licenses',
            kind: 'link',
            label: copy.licenses,
            keywords: 'license legal open source',
            open: () => {
              context.openPage('licenses');
            },
          },
        ],
      },
      {
        label: '',
        rows: [
          {
            id: 'welcome',
            kind: 'button',
            label: copy.showWelcome,
            description: copy.showWelcomeLine,
            keywords: 'first run onboarding intro',
            action: copy.show,
            run: context.showWelcome,
          },
          {
            id: 'support',
            kind: 'button',
            label: copy.supportDetails,
            description: copy.supportDetailsLine,
            ...(failedOn('support')
              ? { problem: copy.copyDetailsFailed, detail: context.supportDetails }
              : {}),
            keywords: 'help debug browser',
            action: copiedOn('support') ? copy.copied : copy.copyDetails,
            run: context.copyDetails,
          },
        ],
      },
    ],
  };
}

/** The sections in the sidebar's order. */
export function settingsSections(context: SettingsContext): Section[] {
  return [
    talking(context),
    audio(context),
    accessibility(context),
    shortcuts(context),
    windowSection(context),
    vision(context),
    privacy(context),
    about(context),
  ];
}

export function howToUsePage(context: SettingsContext): Page {
  const { name, keys } = context;
  const chords = chordCaps(context.apple);
  const caps = (...ids: ChangeableId[]) =>
    ids.filter((id) => keys[id] !== '').map((id) => keyCap(keys[id]));
  const step = (
    number: number,
    label: string,
    description: string,
    stepKeys: readonly string[],
  ): Row => ({
    id: `step-${String(number)}`,
    kind: 'step',
    number,
    label,
    description,
    keys: stepKeys,
  });
  const talk = caps('talk');
  return {
    id: 'howto',
    title: copy.howToUse,
    groups: [
      {
        label: '',
        rows: [
          step(1, copy.justTalk, copy.justTalkLine(name, talk[0] ?? ''), talk),
          step(2, copy.stop(name), copy.stopLine(name), ['Esc']),
          step(3, copy.muteOrType, copy.muteOrTypeLine, caps('mute', 'type')),
          step(4, shortcutCopy.pauseVision, copy.pauseLine(name), chords.pauseVision),
          step(5, shortcutCopy.characters, copy.charactersLine, chords.characters),
        ],
      },
      {
        label: '',
        rows: [
          {
            id: 'try-tips',
            kind: 'button',
            label: copy.tryTips(name),
            description: copy.tryTipsLine,
            action: copy.tryIt,
            primary: true,
            run: context.tryTips,
          },
        ],
      },
    ],
  };
}
