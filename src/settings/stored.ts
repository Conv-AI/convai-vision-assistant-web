import {
  aiColors,
  clampTextScale,
  defaultPreferences,
  type KitPreferences,
} from '../kit/preferences';
import type { TranscriptStyle } from '../app/layout';

type PageStorage = Pick<Storage, 'getItem' | 'setItem'> | null;

/** What Settings keeps beside the kit's preferences: the app's own values. */
export interface AppSettings {
  captions: boolean;

  transcriptStyle: TranscriptStyle;

  captionBacking: boolean;

  readAnswers: boolean;

  volume: number;

  microphone: string | null;

  camera: string | null;

  mirrorCamera: boolean;
}

export type Settings = KitPreferences & AppSettings;

export const defaultSettings: Settings = {
  ...defaultPreferences,
  captions: true,
  transcriptStyle: 'moments',
  captionBacking: false,
  readAnswers: false,
  volume: 1,
  microphone: null,
  camera: null,
  mirrorCamera: true,
};

/** The keys a value is stored under on this device. */
export const settingsKeys = {
  preferences: 'va.preferences',
  /** Kept apart, as the panel's style picker wrote it before Settings. */
  transcriptStyle: 'va.transcript-style',
} as const;

/** The volume as stored and drawn: 0 to 1 in steps of 0.05. */
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return defaultSettings.volume;
  return Math.min(1, Math.max(0, Math.round(value * 20) / 20));
}

function readStyle(value: string | null): TranscriptStyle {
  return value === 'conversation' || value === 'continuum' ? value : 'moments';
}

function systemSwitch(value: unknown, fallback: KitPreferences['highContrast']) {
  return value === 'system' || value === 'on' || value === 'off' ? value : fallback;
}

/** Reads what was stored, keeping every value that is still a valid one and the default for the rest. */
function readSettings(raw: string | null, style: string | null): Settings {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object') stored = parsed as Record<string, unknown>;
  } catch {
    // A value that cannot be read is no value: the defaults stand.
  }
  const flag = (name: keyof AppSettings, fallback: boolean) =>
    typeof stored[name] === 'boolean' ? stored[name] : fallback;
  const color = stored.aiColor;
  return {
    textScale:
      typeof stored.textScale === 'number'
        ? clampTextScale(stored.textScale)
        : defaultSettings.textScale,
    aiColor: aiColors.find((option) => option === color) ?? defaultSettings.aiColor,
    highContrast: systemSwitch(stored.highContrast, defaultSettings.highContrast),
    reduceMotion: systemSwitch(stored.reduceMotion, defaultSettings.reduceMotion),
    captions: flag('captions', defaultSettings.captions),
    transcriptStyle: readStyle(style),
    captionBacking: flag('captionBacking', defaultSettings.captionBacking),
    readAnswers: flag('readAnswers', defaultSettings.readAnswers),
    volume: typeof stored.volume === 'number' ? clampVolume(stored.volume) : defaultSettings.volume,
    microphone: typeof stored.microphone === 'string' ? stored.microphone : null,
    camera: typeof stored.camera === 'string' ? stored.camera : null,
    mirrorCamera: flag('mirrorCamera', defaultSettings.mirrorCamera),
  };
}

/**
 * Everything Settings changes, as one store: each change applies at once (there is no Save) and is
 * kept on this device. Storage can be off: the values then last for the page.
 */
export class SettingsStore {
  private readonly storage: PageStorage;
  private current: Settings;
  private readonly listeners = new Set<() => void>();

  constructor(storage: PageStorage) {
    this.storage = storage;
    this.current = readSettings(
      this.read(settingsKeys.preferences),
      this.read(settingsKeys.transcriptStyle),
    );
  }

  /** The values now; a new object after every change, so React can compare it. */
  get state(): Settings {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Changes some values; ones out of range are brought into it. */
  set(change: Partial<Settings>): void {
    const next: Settings = { ...this.current, ...change };
    next.textScale = clampTextScale(next.textScale);
    next.volume = clampVolume(next.volume);
    if (
      Object.keys(next).every(
        (key) => next[key as keyof Settings] === this.current[key as keyof Settings],
      )
    )
      return;
    const styleChanged = next.transcriptStyle !== this.current.transcriptStyle;
    this.current = next;
    const { transcriptStyle, ...rest } = next;
    this.write(settingsKeys.preferences, JSON.stringify(rest));
    if (styleChanged) this.write(settingsKeys.transcriptStyle, transcriptStyle);
    for (const listener of [...this.listeners]) listener();
  }

  private read(name: string): string | null {
    try {
      return this.storage?.getItem(name) ?? null;
    } catch {
      return null;
    }
  }

  private write(name: string, value: string): void {
    try {
      this.storage?.setItem(name, value);
    } catch {
      // Kept for this page only.
    }
  }
}
