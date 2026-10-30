import { defaultKeys, type WindowKeys } from '../settings/shortcuts';

export interface KeyInput {
  type: 'down' | 'up';
  key: string;

  code: string;
  repeat: boolean;
  /** Ctrl, Alt or ⌘ is held: the press belongs to the browser or the system. */
  chord: boolean;
  /** Alt (⌥) is held. */
  alt: boolean;
  /** Ctrl or ⌘ is held; with Alt it is AltGr on Windows, which types letters. */
  control: boolean;
  /** Shift is held: with the talk key it turns Hands free on or off. */
  shift: boolean;
  /** The focus is in a text field, which keeps its letters. */
  inTextField: boolean;
}

/** What is open, from the top layer down, as far as Esc is concerned. */
export interface KeyContext {
  /** A menu (the transcript style picker, the source menu). */
  menu: boolean;

  dialog: boolean;
  /** The dialog is the character picker, which Ctrl K closes again. */
  picker: boolean;
  /** Settings is open (kit Esc layer 4, under a dialog over it), which Ctrl , closes again. */
  settings: boolean;

  crop: boolean;

  quick: boolean;

  ask: boolean;
  composer: boolean;
  /** The transcript floats or covers the stage as a sheet (a pinned column is not a layer). */
  looseTranscript: boolean;

  islandToast: boolean;
  /** A reply is being thought or spoken. */
  answering: boolean;
  /**
   * A shortcut's row in Settings waits for a key: no key does anything else, Esc only ends the
   * wait (kit: nothing runs while a row records).
   */
  recording: boolean;
}

export type KeyAction =
  | 'talk-press'
  | 'talk-release'
  /** Shift with the talk key: Hands free on or off. */
  | 'hands-free'
  | 'mute'
  | 'transcript'
  | 'type'
  | 'quick'
  /** Alt V: pause vision, or resume it. */
  | 'pause-vision'
  /** Ctrl K (⌘ K): open the character picker, or close it. */
  | 'characters'
  /** Ctrl , (⌘ ,): open Settings, or close it. */
  | 'settings'
  | 'close-menu'
  /** Esc is the dialog's safe action. */
  | 'close-dialog'
  /** Esc closes Quick controls' options page, else the panel. */
  | 'close-quick'
  /** Esc gives up the crop: Cancel. */
  | 'cancel-crop'
  | 'close-ask'
  | 'close-composer'
  | 'close-transcript'
  /** Esc is the Island's: it dismisses its toast itself. */
  | 'island'
  | 'stop';

/** The letter or digit a key's place stands for ("KeyT" → "t", "Digit5" → "5", "Slash" → "/"). */
function placeOf(code: string): string {
  if (code === 'Slash') return '/';
  return /^(?:Key|Digit)(.)$/.exec(code)?.[1]?.toLocaleLowerCase() ?? '';
}

/**
 * What a key does now, or null when it is not the window's. `keys` are the shortcuts' keys as they
 * type, as Settings › Shortcuts has them; an empty one has no key.
 */
export function routeKey(
  input: KeyInput,
  context: KeyContext,
  keys: WindowKeys = defaultKeys,
): KeyAction | null {
  if (input.key === 'Escape') {
    if (input.type !== 'down') return null;
    if (context.menu) return 'close-menu';
    if (context.dialog) return 'close-dialog';
    if (context.quick) return 'close-quick';
    if (context.ask) return 'close-ask';
    if (context.composer) return 'close-composer';
    if (context.looseTranscript) return 'close-transcript';
    // The crop is the stage's own layer: what stands over it (the ask, the Type field, a floating
    // transcript) closes first.
    if (context.crop) return 'cancel-crop';
    if (context.islandToast) return 'island';
    if (context.answering) return 'stop';
    return null;
  }
  if (context.recording) return null;

  if (input.control && !input.alt && input.code === 'KeyK') {
    if (input.type !== 'down' || input.repeat) return null;
    return !context.dialog || context.picker ? 'characters' : null;
  }
  // Ctrl , (⌘ ,) opens Settings, as desktop apps do, from anywhere; a dialog over it holds it back.
  if (input.control && !input.alt && input.code === 'Comma') {
    if (input.type !== 'down' || input.repeat) return null;
    return !context.dialog || (context.settings && !context.picker) ? 'settings' : null;
  }
  // Alt V is the way to stop being seen, so it works while the person types too; it is no letter.
  // Only the share card, which is modal, holds it back.
  if (input.alt && !input.control && input.code === 'KeyV') {
    return input.type === 'down' && !input.repeat && !context.dialog ? 'pause-vision' : null;
  }
  const letter = input.key.length === 1 ? input.key.toLocaleLowerCase() : '';
  const talk = keys.talk;
  // Shift with a digit types a symbol: the talk key is also found by its place then.
  const isTalk = talk !== '' && (letter === talk || (input.shift && placeOf(input.code) === talk));
  // The talk key's release always counts, wherever the focus went while it was held.
  if (isTalk && input.type === 'up') return 'talk-release';
  // While the Type field is open its letters are the message, wherever the focus went.
  if (input.chord || input.inTextField || context.composer || context.dialog) return null;
  if (input.type !== 'down') return null;
  if (input.repeat) return null;
  if (isTalk) return input.shift ? 'hands-free' : 'talk-press';
  if (letter === '') return null;
  // No blanket rule against Shift: "/" needs it on several layouts.
  if (letter === keys.mute) return 'mute';
  if (letter === keys.transcript) return 'transcript';
  if (letter === keys.type) return 'type';
  if (letter === keys.quick) return 'quick';
  return null;
}

/** The key that pauses vision as the person reads it: "⌥ V" on Apple's systems, "Alt V" elsewhere. */
export function pauseKeyLabel(apple: boolean): string {
  return apple ? '⌥ V' : 'Alt V';
}

/** The picker's key as the person reads it: "⌘ K" on Apple's systems, "Ctrl K" elsewhere. */
export function charactersKeyLabel(apple: boolean): string {
  return apple ? '⌘ K' : 'Ctrl K';
}

/** Settings' key as the person reads it: "⌘ ," on Apple's systems, "Ctrl ," elsewhere. */
export function settingsKeyLabel(apple: boolean): string {
  return apple ? '⌘ ,' : 'Ctrl ,';
}

/** The pause key in ARIA's words. */
export const pauseKeyShortcuts = 'Alt+V';

export function isApple(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

export function isElement(target: EventTarget | null): target is HTMLElement {
  return target !== null && (target as Partial<Node>).nodeType === 1;
}

export function isTextField(target: EventTarget | null): boolean {
  if (!isElement(target)) return false;
  if (target.isContentEditable) return true;
  switch (target.tagName) {
    case 'TEXTAREA':
    case 'SELECT':
      return true;
    case 'INPUT':
      return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset'].includes(
        (target as HTMLInputElement).type,
      );
    default:
      return false;
  }
}
