import type { TalkMode } from '../kit/capsule/capsuleCopy';

export type TipId = 'talk' | 'stop' | 'type' | 'transcript' | 'quick';

export const tipOrder: readonly TipId[] = ['talk', 'stop', 'type', 'transcript', 'quick'];

/** What a tip points at: the capsule's Lens, its Type tool, its More, or the bar's Transcript tool. */
export type TipTargetId = 'lens' | 'type' | 'transcript' | 'more';

export const tipTargets: Record<TipId, TipTargetId> = {
  talk: 'lens',
  stop: 'lens',
  type: 'type',
  transcript: 'transcript',
  quick: 'more',
};

export interface TipWords {
  title?: string;
  /** The key as its cap shows it; absent for a title of words alone. */
  keyCap?: string;
  /** The key spelled for a screen reader ("Escape", "slash"). */
  keyLabel?: string;
  titleAfter?: string;
  line: string;
}

/** The person's own keys, as their caps show them; empty for a shortcut set to none. */
export interface TipKeys {
  talk: string;
  type: string;
  transcript: string;
  quick: string;
}

/** How a screen reader says a key cap that is not a letter. */
function spelled(key: string): string {
  return key === '/' ? 'slash' : key;
}

export function tipWords(id: TipId, name: string, mode: TalkMode, keys: TipKeys): TipWords | null {
  switch (id) {
    case 'talk':
      if (mode === 'hands-free') return { title: 'Just talk', line: `${name} is listening.` };
      // With no talk key the Lens is held instead, as the capsule's own hint says.
      if (keys.talk === '') return { title: 'Click and hold to talk', line: 'Let go to send.' };
      return {
        title: 'Hold',
        keyCap: keys.talk,
        keyLabel: spelled(keys.talk),
        titleAfter: 'to talk',
        line: 'Let go to send.',
      };
    case 'stop':
      return {
        keyCap: 'Esc',
        keyLabel: 'Escape',
        titleAfter: 'to stop',
        line: `${name} stops and listens again.`,
      };
    case 'type':
      if (keys.type === '') return null;
      return {
        title: 'Press',
        keyCap: keys.type,
        keyLabel: spelled(keys.type),
        titleAfter: 'to type',
        line: `Your message goes to ${name}.`,
      };
    case 'transcript':
      if (keys.transcript === '') return null;
      return {
        title: 'Press',
        keyCap: keys.transcript,
        keyLabel: spelled(keys.transcript),
        titleAfter: 'for the transcript',
        line: `Everything you and ${name} said.`,
      };
    case 'quick':
      if (keys.quick === '') return null;
      return {
        title: 'Press',
        keyCap: keys.quick,
        keyLabel: spelled(keys.quick),
        titleAfter: 'for quick controls',
        line: 'Captions, mute and more.',
      };
  }
}

/** The title as one sentence, for a screen reader: "Hold T to talk". */
export function spokenTitle(words: TipWords): string {
  return [words.title, words.keyLabel ?? words.keyCap, words.titleAfter].filter(Boolean).join(' ');
}
