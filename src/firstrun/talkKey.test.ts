import { describe, expect, it } from 'vitest';
import { isTalkKey, recordTalkKey, talkKeyLabel } from './talkKey';

const press = (key: string, chord = false) => ({ key, chord });

describe('recordTalkKey', () => {
  it('takes a letter or a digit, in lower case', () => {
    expect(recordTalkKey(press('G'), 't')).toEqual({ kind: 'take', key: 'g' });
    expect(recordTalkKey(press('7'), 't')).toEqual({ kind: 'take', key: '7' });
    expect(recordTalkKey(press('ş'), 't')).toEqual({ kind: 'take', key: 'ş' });
  });

  it('keeps the old key on Esc', () => {
    expect(recordTalkKey(press('Escape'), 'g')).toEqual({ kind: 'cancel' });
  });

  it('refuses a key the window already uses, naming it and the key kept', () => {
    expect(recordTalkKey(press('m'), 'g')).toEqual({
      kind: 'refuse',
      shown: 'M',
      line: 'M is already Mute. Press another key, or Esc to keep G.',
    });
    expect(recordTalkKey(press('R'), 't')).toMatchObject({
      line: 'R is already Transcript. Press another key, or Esc to keep T.',
    });
    expect(recordTalkKey(press('q'), 't')).toMatchObject({
      line: 'Q is already Quick controls. Press another key, or Esc to keep T.',
    });
  });

  it('refuses a press with Ctrl, ⌘ or Alt', () => {
    expect(recordTalkKey(press('k', true), 't')).toEqual({
      kind: 'refuse',
      shown: 'K',
      line: 'Pick a key without Ctrl or Alt.',
    });
    expect(recordTalkKey(press('k', true), 't', true)).toMatchObject({
      line: 'Pick a key without ⌘, ⌥ or Ctrl.',
    });
  });

  it('refuses keys that are not a letter or a number', () => {
    for (const key of [' ', '/', 'Enter', 'Tab', 'F5', 'ArrowUp'])
      expect(recordTalkKey(press(key), 't')).toMatchObject({
        kind: 'refuse',
        line: 'Pick a letter or a number.',
      });
  });

  it('takes the key it already has', () => {
    expect(recordTalkKey(press('t'), 't')).toEqual({ kind: 'take', key: 't' });
  });
});

describe('talk keys', () => {
  it('are one letter or one digit', () => {
    expect(['t', 'ü', '0'].every(isTalkKey)).toBe(true);
    expect(['', 'tt', '/', ' ', 'F1'].some(isTalkKey)).toBe(false);
  });

  it('show as their capital', () => {
    expect(talkKeyLabel('t')).toBe('T');
    expect(talkKeyLabel('ı')).toBe('I');
  });
});
