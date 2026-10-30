import { isShortcutKey } from '../firstrun/talkKey';
import { shortcutCopy as copy } from './copy';

/** The shortcuts the person can give another key. */
export type ChangeableId = 'talk' | 'type' | 'mute' | 'transcript' | 'quick';

/** Every shortcut Settings lists. */
export type ShortcutId =
  ChangeableId | 'stop' | 'hands-free' | 'settings' | 'characters' | 'pause-vision';

/** The keys of the changeable shortcuts as they type ("t", "/"); empty for one left without a key. */
export type WindowKeys = Readonly<Record<ChangeableId, string>>;

export const defaultKeys: WindowKeys = {
  talk: 't',
  type: '/',
  mute: 'm',
  transcript: 'r',
  quick: 'q',
};

/** The changeable shortcuts in the order they are registered: of two that overlap, the first keeps the key. */
export const changeableIds: readonly ChangeableId[] = [
  'talk',
  'type',
  'mute',
  'transcript',
  'quick',
];

/** What changing a key did. */
export type BindResult =
  | { kind: 'saved' }
  /** Another shortcut has the key: nothing changed; `move` gives it over once the person agrees. */
  | { kind: 'conflict'; other: ChangeableId };

/** A key as a cap shows it: "T", "/". */
export function keyCap(key: string): string {
  return key.toLocaleUpperCase();
}

/** A key pressed while a shortcut's row records. */
export interface RecordedPress {
  key: string;
  /** The key's place ("KeyW"), named in a refusal whatever the layout types there. */
  code: string;
  shift: boolean;
  /** Ctrl, or ⌘ on Apple's systems. */
  control: boolean;
  alt: boolean;
}

export type Recorded =
  /** Esc: the old key stays. */
  | { kind: 'cancel' }
  /** A modifier on its own: recording goes on, waiting for the key. */
  | { kind: 'wait' }
  /** A key the shortcut can have, as it types. */
  | { kind: 'key'; key: string }
  | { kind: 'refuse'; line: string };

const modifierKeys = new Set([
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
  'Meta',
  'OS',
  'CapsLock',
  'Fn',
]);

/** The key's own name in a refusal: its letter or digit by place, else what it types. */
function pressedName(press: RecordedPress): string {
  const place = /^(?:Key|Digit)(.)$/.exec(press.code)?.[1];
  if (place) return place;
  if (press.key === ' ') return 'Space';
  return press.key.length === 1 ? press.key.toLocaleUpperCase() : press.key;
}

/** A chord as a sentence writes it: "Ctrl+W", "Alt+Shift+F", and on Apple's systems "⌘W", "⌥⇧F". */
export function writtenChord(press: RecordedPress, apple: boolean): string {
  const name = pressedName(press);
  // Apple's order: Option, Shift, then Command.
  if (apple)
    return `${press.alt ? '⌥' : ''}${press.shift ? '⇧' : ''}${press.control ? '⌘' : ''}${name}`;
  return [press.control ? 'Ctrl' : '', press.alt ? 'Alt' : '', press.shift ? 'Shift' : '', name]
    .filter(Boolean)
    .join('+');
}

/** Ctrl (⌘) with these is the browser's own (close, new tab, find, reload, print, save…). */
const browserLetters = new Set([
  'KeyW',
  'KeyT',
  'KeyN',
  'KeyF',
  'KeyL',
  'KeyR',
  'KeyP',
  'KeyS',
  'KeyD',
  'KeyH',
  'KeyJ',
  'KeyQ',
]);

/** The chords the window keeps for shortcuts that cannot be changed, by the shortcut's name. */
function lockedChord(press: RecordedPress): string | null {
  if (press.control && !press.alt && press.code === 'Comma') return copy.settings;
  if (press.control && !press.alt && press.code === 'KeyK') return copy.characters;
  if (press.alt && !press.control && press.code === 'KeyV') return copy.pauseVision;
  return null;
}

export function recordShortcut(press: RecordedPress, apple: boolean): Recorded {
  if (press.key === 'Escape') return { kind: 'cancel' };
  if (modifierKeys.has(press.key)) return { kind: 'wait' };
  const chord = writtenChord(press, apple);
  const refuse = (line: string): Recorded => ({ kind: 'refuse', line });
  if (press.control || press.alt) {
    const locked = lockedChord(press);
    if (locked) return refuse(copy.takenByLocked(chord, locked));
    // Only the chords the browser is known to keep are said to be its; any other is no single key.
    return refuse(
      press.control && !press.alt && browserLetters.has(press.code)
        ? copy.browserKeeps(chord)
        : copy.oneKey,
    );
  }
  if (press.key === 'Tab') return refuse(copy.movesBetween('Tab'));
  if (press.key === 'Enter' || press.key === ' ') return refuse(copy.pressesButtons(chord));
  if (press.key.startsWith('Arrow')) return refuse(copy.arrows);
  if (/^F\d{1,2}$/.test(press.key)) return refuse(copy.browserKeeps(press.key));
  const key = press.key.length === 1 ? press.key.toLocaleLowerCase() : '';
  // Shift with a letter is no key of its own here ("Hands free" is Shift with the Talk key); "/"
  // needs Shift on several layouts, and is taken.
  if (press.shift && /^\p{L}$/u.test(key)) return refuse(copy.onItsOwn(chord));
  if (!isShortcutKey(key)) return refuse(copy.letterOrNumber);
  return { kind: 'key', key };
}

/** Where the Talk key comes from: the first run's store keeps it (`va.talk-key`). */
export interface TalkKeySource {
  readonly talkKey: string;
  setTalkKey(key: string): void;
  subscribe(listener: () => void): () => void;
}

type PageStorage = Pick<Storage, 'getItem' | 'setItem'> | null;

type Saved = Partial<Record<Exclude<ChangeableId, 'talk'>, string>>;

/** Reads the stored changes, keeping only ids and keys that are still valid ones. */
function readSaved(raw: string | null): Saved {
  const saved: Saved = {};
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return saved;
    for (const id of ['type', 'mute', 'transcript', 'quick'] as const) {
      const value = (parsed as Record<string, unknown>)[id];
      if (typeof value === 'string' && (value === '' || isShortcutKey(value))) saved[id] = value;
    }
  } catch {
    // A value that cannot be read is no value: the defaults stand.
  }
  return saved;
}

/**
 * The map of the window's keys, as one store: `keys` is a new object after every change, so React
 * can compare it. The Talk key is kept by the first run's store, the others under `va.shortcuts`
 * (only the ones that differ from their defaults). Storage can be off: changes then last for the
 * page.
 */
export class ShortcutMap {
  static readonly storageKey = 'va.shortcuts';

  private readonly storage: PageStorage;
  private readonly talk: TalkKeySource;
  private readonly listeners = new Set<() => void>();
  private saved: Saved;
  private current: WindowKeys = defaultKeys;
  private committing = false;

  constructor(storage: PageStorage, talk: TalkKeySource) {
    this.storage = storage;
    this.talk = talk;
    this.saved = readSaved(this.read());
    this.recompute();
    // The first run's talk key step changes the same key.
    talk.subscribe(() => {
      if (this.committing) return;
      this.recompute();
      this.changed();
    });
  }

  /** The keys now. */
  get keys(): WindowKeys {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** True when the shortcut's key is not its default (none counts as changed). */
  isChanged(id: ChangeableId): boolean {
    return this.current[id] !== defaultKeys[id];
  }

  /** True when at least one key is not its default: "Reset all shortcuts" shows. */
  get anyChanged(): boolean {
    return changeableIds.some((id) => this.isChanged(id));
  }

  /** The shortcut that has `key` now, apart from `except`; null when none does. */
  holderOf(key: string, except: ChangeableId): ChangeableId | null {
    if (key === '') return null;
    return changeableIds.find((id) => id !== except && this.current[id] === key) ?? null;
  }

  /** Gives `id` the key. A key another shortcut has is a conflict, and nothing changes. */
  bind(id: ChangeableId, key: string): BindResult {
    if (!isShortcutKey(key)) throw new Error(`Not a shortcut key: ${key}`);
    if (this.current[id] === key) return { kind: 'saved' };
    const other = this.holderOf(key, id);
    if (other) return { kind: 'conflict', other };
    this.commit({ [id]: key });
    return { kind: 'saved' };
  }

  /** Gives `id` the key and takes it from the shortcut that had it, which is left without one. */
  move(id: ChangeableId, key: string): void {
    if (!isShortcutKey(key)) throw new Error(`Not a shortcut key: ${key}`);
    const other = this.holderOf(key, id);
    this.commit(other ? { [id]: key, [other]: '' } : { [id]: key });
  }

  reset(id: ChangeableId): BindResult {
    return this.bind(id, defaultKeys[id]);
  }

  /** Returns every shortcut to its default key. */
  resetAll(): void {
    this.commit({ ...defaultKeys });
  }

  /** One change: kept on the device, then the keys again, then the listeners. */
  private commit(change: Partial<Record<ChangeableId, string>>): void {
    const next = { ...this.current, ...change };
    this.committing = true;
    try {
      this.talk.setTalkKey(next.talk);
    } finally {
      this.committing = false;
    }
    const saved: Saved = {};
    for (const id of ['type', 'mute', 'transcript', 'quick'] as const) {
      if (next[id] !== defaultKeys[id]) saved[id] = next[id];
    }
    this.saved = saved;
    this.write(JSON.stringify(saved));
    this.recompute();
    this.changed();
  }

  /**
   * The key each shortcut has: the person's keys first (Talk's, then the others' in order), then
   * the defaults. A default another key already has is left without one, so two shortcuts never
   * share a key, whatever was stored.
   */
  private recompute(): void {
    const talk = this.talk.talkKey;
    const chosen: Partial<Record<ChangeableId, string>> = { ...this.saved };
    if (talk !== defaultKeys.talk) chosen.talk = talk;
    const keys: Record<ChangeableId, string> = {
      talk: '',
      type: '',
      mute: '',
      transcript: '',
      quick: '',
    };
    const taken = new Set<string>();
    const give = (id: ChangeableId, key: string) => {
      if (key === '' || taken.has(key)) return;
      keys[id] = key;
      taken.add(key);
    };
    for (const id of changeableIds) {
      const key = chosen[id];
      if (key !== undefined) give(id, key);
    }
    for (const id of changeableIds) {
      if (chosen[id] === undefined) give(id, defaultKeys[id]);
    }
    if (changeableIds.every((id) => keys[id] === this.current[id])) return;
    this.current = keys;
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private read(): string | null {
    try {
      return this.storage?.getItem(ShortcutMap.storageKey) ?? null;
    } catch {
      return null;
    }
  }

  private write(value: string): void {
    try {
      this.storage?.setItem(ShortcutMap.storageKey, value);
    } catch {
      // Kept for this page only.
    }
  }
}
