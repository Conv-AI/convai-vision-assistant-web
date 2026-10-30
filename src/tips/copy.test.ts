import { describe, expect, it } from 'vitest';
import { spokenTitle, tipOrder, tipTargets, tipWords, type TipKeys } from './copy';

const keys: TipKeys = { talk: 'T', type: '/', transcript: 'R', quick: 'Q' };

describe('tip words', () => {
  it('are the help text, with the person’s own keys', () => {
    expect(tipWords('talk', 'Kira', 'push-to-talk', keys)).toMatchObject({
      title: 'Hold',
      keyCap: 'T',
      titleAfter: 'to talk',
      line: 'Let go to send.',
    });
    expect(tipWords('stop', 'Kira', 'push-to-talk', keys)).toMatchObject({
      keyCap: 'Esc',
      keyLabel: 'Escape',
      titleAfter: 'to stop',
      line: 'Kira stops and listens again.',
    });
    expect(tipWords('type', 'Kira', 'push-to-talk', keys)).toMatchObject({
      title: 'Press',
      keyCap: '/',
      keyLabel: 'slash',
      titleAfter: 'to type',
      line: 'Your message goes to Kira.',
    });
    expect(tipWords('transcript', 'Kira', 'push-to-talk', keys)).toMatchObject({
      keyCap: 'R',
      titleAfter: 'for the transcript',
      line: 'Everything you and Kira said.',
    });
    expect(tipWords('quick', 'Kira', 'push-to-talk', { ...keys, quick: 'K' })).toMatchObject({
      keyCap: 'K',
      titleAfter: 'for quick controls',
      line: 'Captions, mute and more.',
    });
  });

  it('say "Just talk" in hands free', () => {
    expect(tipWords('talk', 'Kira', 'hands-free', keys)).toEqual({
      title: 'Just talk',
      line: 'Kira is listening.',
    });
  });

  it('have nothing to teach for a key set to none, but U1 falls back to the Lens', () => {
    const none: TipKeys = { talk: '', type: '', transcript: '', quick: '' };
    expect(tipWords('type', 'Kira', 'push-to-talk', none)).toBeNull();
    expect(tipWords('transcript', 'Kira', 'push-to-talk', none)).toBeNull();
    expect(tipWords('quick', 'Kira', 'push-to-talk', none)).toBeNull();
    expect(tipWords('talk', 'Kira', 'push-to-talk', none)).toEqual({
      title: 'Click and hold to talk',
      line: 'Let go to send.',
    });
  });

  it('are said as one sentence', () => {
    const words = tipWords('talk', 'Kira', 'push-to-talk', keys);
    expect(words && spokenTitle(words)).toBe('Hold T to talk');
    const stop = tipWords('stop', 'Kira', 'push-to-talk', keys);
    expect(stop && spokenTitle(stop)).toBe('Escape to stop');
  });

  it('come in tip sequence’s order, each at its target', () => {
    expect(tipOrder).toEqual(['talk', 'stop', 'type', 'transcript', 'quick']);
    expect(tipTargets).toEqual({
      talk: 'lens',
      stop: 'lens',
      type: 'type',
      transcript: 'transcript',
      quick: 'more',
    });
  });
});
