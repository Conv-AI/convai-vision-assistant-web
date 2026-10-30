import { describe, expect, it } from 'vitest';
import {
  charactersKeyLabel,
  isTextField,
  routeKey,
  settingsKeyLabel,
  type KeyContext,
  type KeyInput,
} from './keys';
import { defaultKeys } from '../settings/shortcuts';

const none: KeyContext = {
  menu: false,
  dialog: false,
  picker: false,
  settings: false,
  crop: false,
  quick: false,
  ask: false,
  composer: false,
  looseTranscript: false,
  islandToast: false,
  answering: false,
  recording: false,
};

function down(key: string, extra: Partial<KeyInput> = {}): KeyInput {
  return {
    type: 'down',
    key,
    code: '',
    repeat: false,
    chord: false,
    alt: false,
    control: false,
    shift: false,
    inTextField: false,
    ...extra,
  };
}

describe('routeKey', () => {
  const altV = (extra: Partial<KeyInput> = {}) =>
    down('v', { code: 'KeyV', alt: true, chord: true, ...extra });

  it('pauses vision on Alt V, by the key’s place, so ⌥ V on a Mac (which types √) counts', () => {
    expect(routeKey(altV(), none)).toBe('pause-vision');
    expect(routeKey(altV({ key: '√' }), none)).toBe('pause-vision');
    // V alone is no key of the window's.
    expect(routeKey(down('v', { code: 'KeyV' }), none)).toBeNull();
    // AltGr (Ctrl Alt on Windows) types letters; Ctrl Alt V and ⌘ ⌥ V belong to others.
    expect(routeKey(altV({ control: true }), none)).toBeNull();
    // Once per press.
    expect(routeKey(altV({ repeat: true }), none)).toBeNull();
    expect(routeKey({ ...altV(), type: 'up' }, none)).toBeNull();
  });

  it('pauses vision while the person types, under a menu or a crop, but not under the share card', () => {
    expect(routeKey(altV({ inTextField: true }), { ...none, composer: true })).toBe('pause-vision');
    expect(routeKey(altV(), { ...none, menu: true })).toBe('pause-vision');
    expect(routeKey(altV(), { ...none, crop: true })).toBe('pause-vision');
    expect(routeKey(altV(), { ...none, dialog: true })).toBeNull();
  });

  it('keeps the letters talking and typing while an area is chosen, the capsule staying', () => {
    const crop = { ...none, crop: true };
    expect(routeKey(down('t'), crop)).toBe('talk-press');
    expect(routeKey(down('/'), crop)).toBe('type');
    expect(routeKey(down('Escape'), crop)).toBe('cancel-crop');
    // Return is the crop's own: it shares where the focus is in it.
    expect(routeKey(down('Enter'), crop)).toBeNull();
  });

  it.each([
    ['t', 'talk-press'],
    ['T', 'talk-press'],
    ['m', 'mute'],
    ['r', 'transcript'],
    ['/', 'type'],
  ] as const)('maps %s to %s', (key, action) => {
    expect(routeKey(down(key), none)).toBe(action);
  });

  it('sends on the talk key’s release', () => {
    expect(routeKey({ ...down('t'), type: 'up' }, none)).toBe('talk-release');
  });

  it('releases even when the focus moved into a text field or a chord came up', () => {
    expect(routeKey({ ...down('t', { inTextField: true, chord: true }), type: 'up' }, none)).toBe(
      'talk-release',
    );
  });

  it('talks with the key the person chose, and leaves T a letter then (F3k)', () => {
    expect(routeKey(down('g'), none, { ...defaultKeys, talk: 'g' })).toBe('talk-press');
    expect(routeKey(down('G'), none, { ...defaultKeys, talk: 'g' })).toBe('talk-press');
    expect(routeKey({ ...down('g'), type: 'up' }, none, { ...defaultKeys, talk: 'g' })).toBe(
      'talk-release',
    );
    expect(routeKey(down('t'), none, { ...defaultKeys, talk: 'g' })).toBeNull();
    expect(routeKey({ ...down('t'), type: 'up' }, none, { ...defaultKeys, talk: 'g' })).toBeNull();
    expect(routeKey(down('m'), none, { ...defaultKeys, talk: 'g' })).toBe('mute');
  });

  it('follows every key Settings › Shortcuts gave, and leaves the old ones letters (S4)', () => {
    const keys = { talk: 'm', type: 'q', mute: '', transcript: '7', quick: 'k' };
    expect(routeKey(down('m'), none, keys)).toBe('talk-press');
    expect(routeKey({ ...down('m'), type: 'up' }, none, keys)).toBe('talk-release');
    expect(routeKey(down('q'), none, keys)).toBe('type');
    expect(routeKey(down('7'), none, keys)).toBe('transcript');
    for (const old of ['t', '/', 'r']) expect(routeKey(down(old), none, keys)).toBeNull();
  });

  it('does nothing for a shortcut left without a key', () => {
    const keys = { talk: '', type: '', mute: '', transcript: '', quick: '' };
    for (const key of ['t', '/', 'm', 'r', 'Shift', 'Enter']) {
      expect(routeKey(down(key), none, keys)).toBeNull();
      expect(routeKey({ ...down(key), type: 'up' }, none, keys)).toBeNull();
    }
    expect(routeKey(down('T', { shift: true, code: 'KeyT' }), none, keys)).toBeNull();
  });

  it('turns Hands free on or off with Shift and the talk key, once per press (S4)', () => {
    const shiftT = (extra: Partial<KeyInput> = {}) =>
      down('T', { shift: true, code: 'KeyT', ...extra });
    expect(routeKey(shiftT(), none)).toBe('hands-free');
    expect(routeKey(shiftT({ repeat: true }), none)).toBeNull();
    expect(routeKey(shiftT({ inTextField: true }), none)).toBeNull();
    expect(routeKey(shiftT(), { ...none, dialog: true })).toBeNull();
    // It follows the talk key: Shift with a digit types a symbol, so the key's place counts.
    const five = { ...defaultKeys, talk: '5' };
    expect(routeKey(down('%', { shift: true, code: 'Digit5' }), none, five)).toBe('hands-free');
    expect(routeKey(down('5', { code: 'Digit5' }), none, five)).toBe('talk-press');
    expect(routeKey(shiftT(), none, five)).toBeNull();
    // Shift is no blanket refusal: "/" needs it on several layouts, and M with Shift still mutes.
    expect(routeKey(down('/', { shift: true, code: 'Digit7' }), none)).toBe('type');
    expect(routeKey(down('M', { shift: true, code: 'KeyM' }), none)).toBe('mute');
  });

  it('hears nothing but Esc while a shortcut’s row waits for a key', () => {
    const waiting = { ...none, dialog: true, settings: true, recording: true };
    expect(routeKey(down('Escape'), waiting)).toBe('close-dialog');
    expect(routeKey(down(',', { code: 'Comma', control: true, chord: true }), waiting)).toBeNull();
    expect(routeKey(down('k', { code: 'KeyK', control: true, chord: true }), waiting)).toBeNull();
    expect(
      routeKey(down('v', { code: 'KeyV', alt: true, chord: true }), { ...none, recording: true }),
    ).toBeNull();
    expect(routeKey({ ...down('t'), type: 'up' }, { ...none, recording: true })).toBeNull();
  });

  it('leaves letters to a text field', () => {
    for (const key of ['t', 'm', 'r', '/'])
      expect(routeKey(down(key, { inTextField: true }), none)).toBeNull();
  });

  it('leaves letters to the Type field while it is open, even without its focus', () => {
    for (const key of ['t', 'm', 'r', '/'])
      expect(routeKey(down(key), { ...none, composer: true })).toBeNull();
  });

  it('holds the window’s letters while a dialog is open, but lets go of the talk key', () => {
    for (const key of ['t', 'm', 'r', '/'])
      expect(routeKey(down(key), { ...none, dialog: true })).toBeNull();
    expect(routeKey({ ...down('t'), type: 'up' }, { ...none, dialog: true })).toBe('talk-release');
  });

  it('leaves chords to the browser and ignores held-key repeats', () => {
    expect(routeKey(down('r', { chord: true }), none)).toBeNull();
    expect(routeKey(down('t', { repeat: true }), none)).toBeNull();
  });

  describe('Ctrl , (⌘ ,) for Settings', () => {
    const ctrlComma = (extra: Partial<KeyInput> = {}) =>
      down(',', { code: 'Comma', control: true, chord: true, ...extra });

    it('opens Settings by the key’s place, from a text field too', () => {
      expect(routeKey(ctrlComma(), none)).toBe('settings');
      expect(routeKey(ctrlComma({ key: 'ö' }), none)).toBe('settings');
      expect(routeKey(ctrlComma({ inTextField: true }), { ...none, composer: true })).toBe(
        'settings',
      );
    });

    it('closes Settings again, and waits while a dialog stands over the window or Settings', () => {
      expect(routeKey(ctrlComma(), { ...none, dialog: true, settings: true })).toBe('settings');
      expect(routeKey(ctrlComma(), { ...none, dialog: true })).toBeNull();
      expect(
        routeKey(ctrlComma(), { ...none, dialog: true, settings: true, picker: true }),
      ).toBeNull();
    });

    it('takes one press, never with Alt, and never the comma alone', () => {
      expect(routeKey(ctrlComma({ repeat: true }), none)).toBeNull();
      expect(routeKey({ ...ctrlComma(), type: 'up' }, none)).toBeNull();
      expect(routeKey(ctrlComma({ alt: true }), none)).toBeNull();
      expect(routeKey(down(',', { code: 'Comma' }), none)).toBeNull();
    });

    it('holds the window’s letters and Ctrl K back while Settings is open', () => {
      const open = { ...none, dialog: true, settings: true };
      expect(routeKey(down('t'), open)).toBeNull();
      expect(routeKey(down('m'), open)).toBeNull();
      expect(routeKey(down('k', { code: 'KeyK', control: true, chord: true }), open)).toBeNull();
      expect(routeKey({ ...down('t'), type: 'up' }, open)).toBe('talk-release');
      expect(routeKey(down('Escape'), open)).toBe('close-dialog');
    });

    it('is read as ⌘ , on Apple’s systems and Ctrl , elsewhere', () => {
      expect(settingsKeyLabel(true)).toBe('⌘ ,');
      expect(settingsKeyLabel(false)).toBe('Ctrl ,');
    });
  });

  describe('Ctrl K (⌘ K) for the characters (C1)', () => {
    const ctrlK = (extra: Partial<KeyInput> = {}) =>
      down('k', { code: 'KeyK', control: true, chord: true, ...extra });

    it('opens the picker by the key’s place, from a text field too', () => {
      expect(routeKey(ctrlK(), none)).toBe('characters');
      expect(routeKey(ctrlK({ key: 'л' }), none)).toBe('characters');
      expect(routeKey(ctrlK({ inTextField: true }), { ...none, composer: true })).toBe(
        'characters',
      );
    });

    it('closes the picker again, and waits while the share card asks', () => {
      expect(routeKey(ctrlK(), { ...none, dialog: true, picker: true })).toBe('characters');
      expect(routeKey(ctrlK(), { ...none, dialog: true })).toBeNull();
    });

    it('counts once per press, and never with Alt (AltGr) or for K alone', () => {
      expect(routeKey(ctrlK({ repeat: true }), none)).toBeNull();
      expect(routeKey({ ...ctrlK(), type: 'up' }, none)).toBeNull();
      expect(routeKey(ctrlK({ alt: true }), none)).toBeNull();
      expect(routeKey(down('k', { code: 'KeyK' }), none)).toBeNull();
    });

    it('holds the window’s letters back while the picker is open', () => {
      expect(routeKey(down('t'), { ...none, dialog: true, picker: true })).toBeNull();
    });

    it('is read as ⌘ K on Apple’s systems and Ctrl K elsewhere', () => {
      expect(charactersKeyLabel(true)).toBe('⌘ K');
      expect(charactersKeyLabel(false)).toBe('Ctrl K');
    });
  });

  it('ignores keys that are not the window’s', () => {
    expect(routeKey(down('x'), none)).toBeNull();
    expect(routeKey(down('Enter'), none)).toBeNull();
    expect(routeKey({ ...down('m'), type: 'up' }, none)).toBeNull();
  });

  describe('Q for Quick controls', () => {
    it('opens and closes it, as Settings › Shortcuts has the key', () => {
      expect(routeKey(down('q'), none)).toBe('quick');
      expect(routeKey(down('Q', { shift: true }), none)).toBe('quick');
      expect(routeKey(down('q'), { ...none, quick: true })).toBe('quick');
      expect(routeKey(down('q'), none, { ...defaultKeys, quick: 'k' })).toBeNull();
      expect(routeKey(down('k'), none, { ...defaultKeys, quick: 'k' })).toBe('quick');
      expect(routeKey(down('q'), none, { ...defaultKeys, quick: '' })).toBeNull();
    });

    it('is a letter: not while typing, under a dialog, as a chord, repeated or let go', () => {
      expect(routeKey(down('q', { inTextField: true }), none)).toBeNull();
      expect(routeKey(down('q'), { ...none, composer: true })).toBeNull();
      expect(routeKey(down('q'), { ...none, dialog: true })).toBeNull();
      expect(routeKey(down('q', { chord: true, control: true, code: 'KeyQ' }), none)).toBeNull();
      expect(routeKey(down('q', { repeat: true }), none)).toBeNull();
      expect(routeKey({ ...down('q'), type: 'up' }, none)).toBeNull();
    });

    it('leaves the other letters working while the panel is open: it interrupts nothing', () => {
      expect(routeKey(down('m'), { ...none, quick: true })).toBe('mute');
      expect(routeKey(down('t'), { ...none, quick: true })).toBe('talk-press');
    });
  });

  describe('Esc closes one layer per press, top first', () => {
    const all: KeyContext = {
      menu: true,
      dialog: true,
      picker: true,
      settings: true,
      crop: true,
      quick: true,
      ask: true,
      composer: true,
      looseTranscript: true,
      islandToast: true,
      answering: true,
      recording: true,
    };
    const order = [
      ['menu', 'close-menu'],
      ['dialog', 'close-dialog'],
      ['quick', 'close-quick'],
      ['ask', 'close-ask'],
      ['composer', 'close-composer'],
      ['looseTranscript', 'close-transcript'],
      ['crop', 'cancel-crop'],
      ['islandToast', 'island'],
      ['answering', 'stop'],
    ] as const;

    it.each(order.map(([layer, action], i) => [layer, action, i] as const))(
      'reaches %s once the layers above it are closed',
      (_layer, action, i) => {
        const context = { ...all };
        for (const [above] of order.slice(0, i)) context[above] = false;
        expect(routeKey(down('Escape'), context)).toBe(action);
      },
    );

    it('does nothing with nothing open', () => {
      expect(routeKey(down('Escape'), none)).toBeNull();
    });

    it('works from inside a text field, and only on the press', () => {
      expect(routeKey(down('Escape', { inTextField: true }), { ...none, composer: true })).toBe(
        'close-composer',
      );
      expect(routeKey({ ...down('Escape'), type: 'up' }, { ...none, answering: true })).toBeNull();
    });
  });
});

describe('isTextField', () => {
  it('knows fields from buttons', () => {
    const text = document.createElement('input');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const editable = document.createElement('div');
    editable.contentEditable = 'true';

    expect(isTextField(text)).toBe(true);
    expect(isTextField(document.createElement('textarea'))).toBe(true);
    expect(isTextField(checkbox)).toBe(false);
    expect(isTextField(document.createElement('button'))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });

  it('knows a field of another window, whose elements are not this window’s instances', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const other = frame.contentDocument;
    if (!other) throw new Error('no frame document');
    const field = other.createElement('textarea');
    expect(field instanceof HTMLElement).toBe(false);
    expect(isTextField(field)).toBe(true);
    expect(isTextField(other.createElement('input'))).toBe(true);
    expect(isTextField(other.createElement('button'))).toBe(false);
    frame.remove();
  });
});
