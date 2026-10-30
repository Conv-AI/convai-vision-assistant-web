import { describe, expect, it } from 'vitest';
import { FirstRunStore } from '../firstrun/stored';
import {
  defaultKeys,
  recordShortcut,
  ShortcutMap,
  writtenChord,
  type RecordedPress,
} from './shortcuts';

function memory(values: Record<string, string> = {}) {
  const map = new Map(Object.entries(values));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

function made(values: Record<string, string> = {}) {
  const storage = memory(values);
  const firstRun = new FirstRunStore(storage);
  const shortcuts = new ShortcutMap(storage, firstRun);
  return { storage, firstRun, shortcuts };
}

describe('ShortcutMap', () => {
  it('starts with the kit’s keys: T to talk, / to type, M to mute, R for the transcript, Q for Quick controls', () => {
    const { shortcuts } = made();
    expect(shortcuts.keys).toEqual({
      talk: 't',
      type: '/',
      mute: 'm',
      transcript: 'r',
      quick: 'q',
    });
    expect(shortcuts.anyChanged).toBe(false);
  });

  it('gives a free key at once and keeps it on the device, the Talk key in the first run’s store', () => {
    const { shortcuts, storage } = made();
    expect(shortcuts.bind('mute', 'k')).toEqual({ kind: 'saved' });
    expect(shortcuts.bind('talk', 'g')).toEqual({ kind: 'saved' });
    expect(shortcuts.keys).toEqual({
      talk: 'g',
      type: '/',
      mute: 'k',
      transcript: 'r',
      quick: 'q',
    });
    expect(shortcuts.isChanged('mute')).toBe(true);
    expect(shortcuts.isChanged('type')).toBe(false);
    expect(storage.map.get('va.talk-key')).toBe('g');
    // Only what differs from the defaults is kept.
    expect(JSON.parse(storage.map.get('va.shortcuts') ?? '')).toEqual({ mute: 'k' });
    // A new page reads the same keys.
    expect(made(Object.fromEntries(storage.map)).shortcuts.keys).toEqual(shortcuts.keys);
  });

  it('never takes a key silently: another shortcut’s key is a conflict, and nothing changes', () => {
    const { shortcuts } = made();
    const before = shortcuts.keys;
    expect(shortcuts.bind('talk', 'm')).toEqual({ kind: 'conflict', other: 'mute' });
    expect(shortcuts.keys).toBe(before);
    // The same key again is no change at all.
    expect(shortcuts.bind('talk', 't')).toEqual({ kind: 'saved' });
    expect(shortcuts.keys).toBe(before);
  });

  it('moves a key over once the person agrees, leaving the other without one', () => {
    const { shortcuts, storage } = made();
    shortcuts.move('talk', 'm');
    expect(shortcuts.keys).toEqual({ talk: 'm', type: '/', mute: '', transcript: 'r', quick: 'q' });
    expect(shortcuts.isChanged('mute')).toBe(true);
    // Talk's old key is free: Type may have it with no question.
    expect(shortcuts.bind('type', 't')).toEqual({ kind: 'saved' });
    // A reload keeps a key left empty.
    expect(made(Object.fromEntries(storage.map)).shortcuts.keys).toEqual({
      talk: 'm',
      type: 't',
      mute: '',
      transcript: 'r',
      quick: 'q',
    });
  });

  it('leaves Talk without a key when another takes it, kept as such in the first run’s store', () => {
    const { shortcuts, firstRun, storage } = made();
    shortcuts.move('mute', 't');
    expect(shortcuts.keys.talk).toBe('');
    expect(firstRun.talkKey).toBe('');
    expect(storage.map.get('va.talk-key')).toBe('');
    expect(made(Object.fromEntries(storage.map)).shortcuts.keys).toEqual({
      talk: '',
      type: '/',
      mute: 't',
      transcript: 'r',
      quick: 'q',
    });
  });

  it('resets a key when its default is free, and asks when another has it now', () => {
    const { shortcuts } = made();
    shortcuts.move('talk', 'm');
    shortcuts.bind('type', 't');
    // Mute's M is Talk's now.
    expect(shortcuts.reset('mute')).toEqual({ kind: 'conflict', other: 'talk' });
    expect(shortcuts.keys.mute).toBe('');
    // Talk's T is Type's now.
    expect(shortcuts.reset('talk')).toEqual({ kind: 'conflict', other: 'type' });
    expect(shortcuts.reset('type')).toEqual({ kind: 'saved' });
    expect(shortcuts.keys.type).toBe('/');
    expect(shortcuts.reset('talk')).toEqual({ kind: 'saved' });
    expect(shortcuts.keys).toEqual({ talk: 't', type: '/', mute: '', transcript: 'r', quick: 'q' });
  });

  it('resets every key at once', () => {
    const { shortcuts, storage } = made();
    shortcuts.move('talk', 'm');
    shortcuts.bind('transcript', '5');
    expect(shortcuts.anyChanged).toBe(true);
    shortcuts.resetAll();
    expect(shortcuts.keys).toEqual(defaultKeys);
    expect(shortcuts.anyChanged).toBe(false);
    expect(storage.map.get('va.talk-key')).toBe('t');
    expect(JSON.parse(storage.map.get('va.shortcuts') ?? '')).toEqual({});
  });

  it('tells its listeners once per change, and follows the first run’s talk key', () => {
    const { shortcuts, firstRun } = made();
    let told = 0;
    shortcuts.subscribe(() => {
      told++;
    });
    shortcuts.bind('talk', 'g');
    expect(told).toBe(1);
    firstRun.setTalkKey('h');
    expect(told).toBe(2);
    expect(shortcuts.keys.talk).toBe('h');
  });

  it('never lets two shortcuts share a key, whatever was stored', () => {
    const { shortcuts } = made({
      'va.talk-key': 'm',
      'va.shortcuts': JSON.stringify({ type: 'm', transcript: 'x', mute: 'banana' }),
    });
    // Talk's key comes first; Type's stored M is left without one, Mute keeps its default: taken.
    expect(shortcuts.keys).toEqual({ talk: 'm', type: '', mute: '', transcript: 'x', quick: 'q' });
    expect(made({ 'va.shortcuts': '{not json' }).shortcuts.keys).toEqual(defaultKeys);
  });

  it('keeps the Quick controls key on the device, as the others', () => {
    const first = made();
    expect(first.shortcuts.bind('quick', 'k')).toEqual({ kind: 'saved' });
    const again = made({ 'va.shortcuts': first.storage.map.get('va.shortcuts') ?? '' });
    expect(again.shortcuts.keys.quick).toBe('k');
    expect(made({ 'va.shortcuts': JSON.stringify({ quick: '' }) }).shortcuts.keys.quick).toBe('');
  });

  it('refuses a key that is no shortcut key', () => {
    const { shortcuts } = made();
    expect(() => shortcuts.bind('talk', 'F5')).toThrow();
    expect(() => {
      shortcuts.move('talk', '');
    }).toThrow();
  });
});

describe('recordShortcut', () => {
  const press = (key: string, extra: Partial<RecordedPress> = {}): RecordedPress => ({
    key,
    code: '',
    shift: false,
    control: false,
    alt: false,
    ...extra,
  });

  it('takes a lone letter, digit or /, as it types', () => {
    expect(recordShortcut(press('G'), false)).toEqual({ kind: 'key', key: 'g' });
    expect(recordShortcut(press('7'), false)).toEqual({ kind: 'key', key: '7' });
    expect(recordShortcut(press('/'), false)).toEqual({ kind: 'key', key: '/' });
    // "/" needs Shift on several layouts: it still counts.
    expect(recordShortcut(press('/', { shift: true, code: 'Digit7' }), false)).toEqual({
      kind: 'key',
      key: '/',
    });
    expect(recordShortcut(press('ö'), false)).toEqual({ kind: 'key', key: 'ö' });
  });

  it('cancels on Esc and waits on a modifier alone', () => {
    expect(recordShortcut(press('Escape'), false)).toEqual({ kind: 'cancel' });
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph'])
      expect(recordShortcut(press(key), false)).toEqual({ kind: 'wait' });
  });

  it('refuses in place what the browser or the page keeps, saying why (S4c)', () => {
    const line = (given: RecordedPress, apple = false) => {
      const result = recordShortcut(given, apple);
      return result.kind === 'refuse' ? result.line : result.kind;
    };
    expect(line(press('w', { code: 'KeyW', control: true }))).toBe(
      'Ctrl+W belongs to the browser. Choose another key.',
    );
    expect(line(press('w', { code: 'KeyW', control: true }), true)).toBe(
      '⌘W belongs to the browser. Choose another key.',
    );
    expect(line(press(',', { code: 'Comma', control: true }))).toBe(
      'Ctrl+, is Settings and can’t be changed. Choose another key.',
    );
    expect(line(press('k', { code: 'KeyK', control: true }))).toBe(
      'Ctrl+K is Characters and can’t be changed. Choose another key.',
    );
    expect(line(press('√', { code: 'KeyV', alt: true }), true)).toBe(
      '⌥V is Pause vision and can’t be changed. Choose another key.',
    );
    expect(line(press('F5'))).toBe('F5 belongs to the browser. Choose another key.');
    // A chord the browser is not known to keep is no single key, not the browser's.
    expect(line(press('m', { code: 'KeyM', control: true }))).toBe(
      'Shortcuts here are one key. Press a letter, a number or / on its own.',
    );
    expect(line(press('µ', { code: 'KeyM', alt: true }))).toBe(
      'Shortcuts here are one key. Press a letter, a number or / on its own.',
    );
    expect(line(press('f', { code: 'KeyF', control: true }))).toBe(
      'Ctrl+F belongs to the browser. Choose another key.',
    );
    expect(line(press('Tab'))).toBe('Tab moves between controls. Choose another key.');
    expect(line(press('Enter'))).toBe('Enter presses buttons. Choose another key.');
    expect(line(press(' ', { code: 'Space' }))).toBe('Space presses buttons. Choose another key.');
    expect(line(press('ArrowUp'))).toBe('Arrows move between controls. Choose another key.');
    expect(line(press('T', { code: 'KeyT', shift: true }))).toBe(
      'Shift+T isn’t a shortcut here. Press a key on its own.',
    );
    expect(line(press(';', { code: 'Semicolon' }))).toBe('Choose a letter, a number or /.');
    expect(line(press('Backspace'))).toBe('Choose a letter, a number or /.');
  });

  it('writes a chord as a sentence does, by the key’s place', () => {
    expect(writtenChord(press('@', { code: 'KeyQ', control: true, alt: true }), false)).toBe(
      'Ctrl+Alt+Q',
    );
    // Apple's order: Option, Shift, Command.
    expect(writtenChord(press('Q', { code: 'KeyQ', control: true, shift: true }), true)).toBe(
      '⇧⌘Q',
    );
    expect(
      writtenChord(press('Q', { code: 'KeyQ', control: true, alt: true, shift: true }), true),
    ).toBe('⌥⇧⌘Q');
  });
});
