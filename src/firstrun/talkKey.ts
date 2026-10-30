import { firstRunCopy } from './copy';

/** The key as it types, in lower case: a letter or a digit. */
export type TalkKey = string;

export const defaultTalkKey: TalkKey = 't';

const taken: Readonly<Record<string, string>> = {
  m: 'Mute',
  r: 'Transcript',
  q: 'Quick controls',
};

/** The key as its cap shows it. */
export function talkKeyLabel(key: TalkKey): string {
  return key.toLocaleUpperCase();
}

/** True for what can be a talk key on the web: one letter or one digit. */
export function isTalkKey(key: string): boolean {
  return /^[\p{L}\p{Nd}]$/u.test(key);
}

/**
 * True for a key Settings › Shortcuts can give one of the window's single-key shortcuts, the talk
 * key included: a letter, a digit or "/". The first run's own step stays with letters and digits.
 */
export function isShortcutKey(key: string): boolean {
  return key === '/' || isTalkKey(key);
}

/** A key pressed while the talk key's row records. */
export interface RecordedPress {
  key: string;
  /** Ctrl, ⌘ or Alt is held: the press belongs to the browser or the system. */
  chord: boolean;
}

export type Recording =
  /** The press is the new talk key (the same key again keeps it). */
  | { kind: 'take'; key: TalkKey }
  /** Esc: the old key stays. */
  | { kind: 'cancel' }
  /** Refused in place: the cap shows what was pressed, the line says why, recording goes on. */
  | { kind: 'refuse'; shown: string; line: string };

export function recordTalkKey(press: RecordedPress, current: TalkKey, apple = false): Recording {
  if (press.key === 'Escape') return { kind: 'cancel' };
  const shown = press.key.length === 1 ? press.key.toLocaleUpperCase() : press.key;
  if (press.chord) return { kind: 'refuse', shown, line: firstRunCopy.talkKeyChord(apple) };
  const key = press.key.toLocaleLowerCase();
  if (!isTalkKey(key)) return { kind: 'refuse', shown, line: 'Pick a letter or a number.' };
  const action = taken[key];
  if (action !== undefined)
    return {
      kind: 'refuse',
      shown,
      line: `${talkKeyLabel(key)} is already ${action}. Press another key, or Esc to keep ${talkKeyLabel(current)}.`,
    };
  return { kind: 'take', key };
}
