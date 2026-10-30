import { describe, expect, it } from 'vitest';
import type { TipId, TipTargetId } from './copy';
import { TipCoach, type TipView } from './coach';
import { TipsStore } from './stored';

/** A storage of the page's own, shared by the sessions of one device. */
function memory(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const allTargets: TipTargetId[] = ['lens', 'type', 'transcript', 'more'];
const allWorded: TipId[] = ['talk', 'stop', 'type', 'transcript', 'quick'];

/** The window with nothing in the way: Ready, something shared, the transcript closed. */
function view(change: Partial<TipView> = {}): TipView {
  return {
    blocked: false,
    capsule: 'ready',
    answering: false,
    stageAction: false,
    captions: false,
    captionShown: false,
    microphoneOff: false,
    microphoneWaiting: false,
    transcriptOpen: false,
    quickOpen: false,
    targets: new Set(allTargets),
    worded: new Set(allWorded),
    ...change,
  };
}

/** A device and its clock: `session()` opens one visit of the page. */
function device() {
  const storage = memory();
  let time = 1_000_000;
  const clock = {
    now: () => time,
    pass: (ms: number) => {
      time += ms;
    },
  };
  const session = () => {
    const coach = new TipCoach(new TipsStore(storage), clock.now);
    coach.start();
    return coach;
  };
  return { storage, clock, session };
}

/** The coach after `ms` more: time alone moves it on at its next look at the window. */
function after(coach: TipCoach, clock: { pass: (ms: number) => void }, ms: number, at = view()) {
  clock.pass(ms);
  coach.update(at);
}

/** One answer spoken from start to end, `ms` long. */
function answer(
  coach: TipCoach,
  clock: { pass: (ms: number) => void },
  ms = 4000,
  speaking = view({ capsule: 'speaking', answering: true }),
  rest = view(),
) {
  coach.update(speaking);
  coach.signal('speech-started');
  after(coach, clock, ms, speaking);
  coach.signal('answer-ended');
  coach.update(rest);
}

describe('TipCoach', () => {
  describe('U1, Hold T to talk', () => {
    it('shows the first time the Lens is Ready, pointing at the Lens', () => {
      const { session } = device();
      const coach = session();
      coach.update(view());
      expect(coach.shown).toMatchObject({ id: 'talk', target: 'lens' });
    });

    it('waits while the stage shows its own action, and comes once it is gone (10-10 A4)', () => {
      const { session } = device();
      const coach = session();
      coach.update(view({ stageAction: true }));
      expect(coach.shown).toBeNull();
      coach.update(view());
      expect(coach.shown?.id).toBe('talk');
    });

    it('waits while the microphone is muted or off, and while the Lens is not Ready', () => {
      for (const change of [
        { microphoneOff: true },
        { capsule: 'muted' as const },
        { capsule: 'connecting' as const },
        // Hands free before the microphone is given: "Kira is listening" would not be true yet.
        { microphoneWaiting: true },
      ]) {
        const coach = device().session();
        coach.update(view(change));
        expect(coach.shown?.id, JSON.stringify(change)).not.toBe('talk');
      }
    });

    it('leaves after 6 s, and comes back once, in a later session', () => {
      const { clock, session } = device();
      const first = session();
      first.update(view());
      after(first, clock, 5999);
      expect(first.shown?.id).toBe('talk');
      after(first, clock, 1);
      expect(first.shown).toBeNull();
      // Not again in the same session, even after the 30 s between bubbles.
      after(first, clock, 60_000);
      expect(first.shown?.id).not.toBe('talk');

      const second = session();
      second.update(view());
      expect(second.shown?.id).toBe('talk');
      after(second, clock, 6000);

      const third = session();
      third.update(view());
      expect(third.shown?.id).not.toBe('talk');
    });

    it('is learned by talking while it shows, and goes at once', () => {
      const { clock, session } = device();
      const coach = session();
      coach.update(view());
      expect(coach.shown?.id).toBe('talk');
      // Holding T: the capsule is Held, which the window counts as in the way.
      coach.update(view({ capsule: 'held', blocked: true }));
      expect(coach.shown).toBeNull();
      coach.signal('talked');
      const next = session();
      after(next, clock, 1000);
      expect(next.shown?.id).not.toBe('talk');
    });

    it('never shows when the person talked before its moment (learned for good)', () => {
      const { session } = device();
      const coach = session();
      coach.signal('talked');
      coach.update(view());
      expect(coach.shown?.id).not.toBe('talk');
      const later = session();
      later.update(view());
      expect(later.shown?.id).not.toBe('talk');
    });

    it('is skipped for this session only when the person types first, and shows next time', () => {
      const { session } = device();
      const coach = session();
      coach.update(view({ stageAction: true }));
      coach.signal('typed');
      coach.update(view());
      expect(coach.shown).toBeNull();
      const next = session();
      next.update(view());
      expect(next.shown?.id).toBe('talk');
    });

    it('waits where the person set its key to none: there is nothing to press', () => {
      const { session } = device();
      const coach = session();
      coach.update(view({ worded: new Set<TipId>(['stop']) }));
      expect(coach.shown).toBeNull();
    });
  });

  describe('U2, Esc to stop', () => {
    function pastU1() {
      const made = device();
      const coach = made.session();
      coach.signal('talked');
      return { ...made, coach };
    }
    const speaking = view({ capsule: 'speaking', answering: true });

    it('shows on the first answer, 1.5 s after its speech starts', () => {
      const { clock, coach } = pastU1();
      coach.update(speaking);
      coach.signal('speech-started');
      after(coach, clock, 1499, speaking);
      expect(coach.shown).toBeNull();
      expect(coach.nextCheck()).toBe(1);
      after(coach, clock, 1, speaking);
      expect(coach.shown).toMatchObject({ id: 'stop', target: 'lens' });
    });

    it('comes right after U1 was learned: only an unlearned bubble holds the next back', () => {
      const { clock, session } = device();
      const coach = session();
      coach.update(view());
      expect(coach.shown?.id).toBe('talk');
      after(coach, clock, 2000, view({ capsule: 'held', blocked: true }));
      coach.signal('talked');
      coach.update(speaking);
      coach.signal('speech-started');
      after(coach, clock, 1500, speaking);
      expect(coach.shown?.id).toBe('stop');
    });

    it('waits while stage captions show', () => {
      const { clock, coach } = pastU1();
      const captioned = view({ capsule: 'speaking', answering: true, captions: true });
      coach.update(captioned);
      coach.signal('speech-started');
      after(coach, clock, 3000, captioned);
      expect(coach.shown).toBeNull();
    });

    it('is learned by stopping an answer: Esc, a click, or talking over it', () => {
      const { clock, coach, session } = pastU1();
      coach.update(speaking);
      coach.signal('speech-started');
      after(coach, clock, 1500, speaking);
      expect(coach.shown?.id).toBe('stop');
      coach.signal('stopped');
      expect(coach.shown).toBeNull();
      const next = session();
      next.update(speaking);
      next.signal('speech-started');
      after(next, clock, 2000, speaking);
      expect(next.shown?.id).not.toBe('stop');
    });

    it('is learned after 3 answers, over sessions', () => {
      const { clock, coach, session, storage } = pastU1();
      const captioned = view({ capsule: 'speaking', answering: true, captions: true });
      answer(coach, clock, 4000, captioned);
      answer(coach, clock, 4000, captioned);
      // Tip 5 would take the second session's first answer: it is learned before that session.
      new TipsStore(storage).learn('quick');
      const next = session();
      answer(next, clock, 4000, captioned);
      expect(next.shown).toBeNull();
      next.update(speaking);
      next.signal('speech-started');
      after(next, clock, 2000, speaking);
      expect(next.shown?.id).not.toBe('stop');
    });

    it('never counts a greeting: only an answer starts its wait', () => {
      const { clock, coach } = pastU1();
      coach.update(speaking);
      after(coach, clock, 3000, speaking);
      expect(coach.shown).toBeNull();
    });
  });

  describe('Convai UI tips 3–5', () => {
    function learnedFirstTwo() {
      const made = device();
      const store = new TipsStore(made.storage);
      store.learn('talk');
      store.learn('stop');
      const coach = made.session();
      return { ...made, coach };
    }

    it('3 shows after the second spoken turn, pointing at the Type tool', () => {
      const { clock, coach } = learnedFirstTwo();
      coach.signal('talked');
      after(coach, clock, 1000);
      expect(coach.shown).toBeNull();
      coach.signal('talked');
      after(coach, clock, 1000);
      expect(coach.shown).toMatchObject({ id: 'type', target: 'type' });
    });

    it('3 shows at once when the microphone is muted or off', () => {
      const { coach } = learnedFirstTwo();
      coach.update(view({ capsule: 'muted', microphoneOff: true }));
      expect(coach.shown?.id).toBe('type');
    });

    it('3 waits while the Type tool is not on screen (the condensed capsule)', () => {
      const { coach } = learnedFirstTwo();
      coach.update(view({ microphoneOff: true, targets: new Set<TipTargetId>(['lens', 'more']) }));
      expect(coach.shown?.id).not.toBe('type');
    });

    it('3 is learned by one typed question', () => {
      const { coach } = learnedFirstTwo();
      coach.signal('typed');
      coach.update(view({ microphoneOff: true }));
      expect(coach.shown).toBeNull();
    });

    it('4 shows after the third answer while the transcript is closed, and not in Continuum', () => {
      const { clock, coach } = learnedFirstTwo();
      coach.signal('typed');
      answer(coach, clock);
      answer(coach, clock);
      expect(coach.shown).toBeNull();
      answer(coach, clock);
      expect(coach.shown).toMatchObject({ id: 'transcript', target: 'transcript' });

      const open = learnedFirstTwo();
      open.coach.signal('typed');
      const opened = view({ transcriptOpen: true });
      const speakingOpen = view({ capsule: 'speaking', answering: true, transcriptOpen: true });
      for (let i = 0; i < 3; i++) answer(open.coach, open.clock, 4000, speakingOpen, opened);
      expect(open.coach.shown).toBeNull();
      // Continuum has no panel: its Transcript tool is not on screen.
      open.coach.update(view({ targets: new Set<TipTargetId>(['lens', 'type', 'more']) }));
      expect(open.coach.shown).toBeNull();
    });

    it('4 is learned by opening the transcript once', () => {
      const { clock, coach } = learnedFirstTwo();
      coach.signal('typed');
      // A column that was open from the start teaches nothing: the person opened nothing.
      coach.update(view({ transcriptOpen: true }));
      coach.update(view());
      for (let i = 0; i < 3; i++) answer(coach, clock);
      expect(coach.shown?.id).toBe('transcript');

      const opened = learnedFirstTwo();
      opened.coach.signal('typed');
      opened.coach.update(view());
      opened.coach.update(view({ transcriptOpen: true }));
      opened.coach.update(view());
      for (let i = 0; i < 3; i++) answer(opened.coach, opened.clock);
      expect(opened.coach.shown).toBeNull();
    });

    it('5 shows in the second session after its first answer, pointing at More', () => {
      const { clock, coach, session } = learnedFirstTwo();
      coach.signal('typed');
      answer(coach, clock);
      expect(coach.shown).toBeNull();
      const second = session();
      second.update(view());
      expect(second.shown).toBeNull();
      answer(second, clock);
      expect(second.shown).toMatchObject({ id: 'quick', target: 'more' });
    });

    it('5 is learned by opening Quick controls once, and goes at once', () => {
      const { clock, coach, session } = learnedFirstTwo();
      coach.signal('typed');
      const second = session();
      answer(second, clock);
      expect(second.shown?.id).toBe('quick');
      second.update(view({ quickOpen: true, blocked: true }));
      expect(second.shown).toBeNull();
      after(second, clock, 60_000);
      const third = session();
      answer(third, clock);
      expect(third.shown).toBeNull();
    });

    it('wait while a caption stands on the stage: it stays a few seconds after an answer', () => {
      const { coach } = learnedFirstTwo();
      coach.update(view({ microphoneOff: true, captionShown: true }));
      expect(coach.shown).toBeNull();
      coach.update(view({ microphoneOff: true }));
      expect(coach.shown?.id).toBe('type');
    });

    it('wait while an answer is under way', () => {
      const { coach } = learnedFirstTwo();
      coach.update(view({ microphoneOff: true, capsule: 'thinking', answering: true }));
      expect(coach.shown).toBeNull();
    });
  });

  describe('one at a time', () => {
    it('holds the next bubble 30 s after one left unlearned', () => {
      const { clock, session } = device();
      const coach = session();
      coach.signal('stopped');
      coach.update(view());
      expect(coach.shown?.id).toBe('talk');
      after(coach, clock, 6000, view({ microphoneOff: true }));
      expect(coach.shown).toBeNull();
      after(coach, clock, 29_999, view({ microphoneOff: true }));
      expect(coach.shown).toBeNull();
      after(coach, clock, 1, view({ microphoneOff: true }));
      expect(coach.shown?.id).toBe('type');
    });

    it('never replaces a showing bubble with a newer one', () => {
      const { clock, session } = device();
      const coach = session();
      coach.signal('stopped');
      coach.update(view());
      expect(coach.shown?.id).toBe('talk');

      coach.update(view({ capsule: 'muted' }));

      expect(coach.shown).toBeNull();
      after(coach, clock, 30_000, view({ capsule: 'muted', microphoneOff: true }));
      expect(coach.shown?.id).toBe('type');
    });

    it('nothing shows while something is in the way, and a showing bubble goes', () => {
      const { session } = device();
      const coach = session();
      coach.update(view({ blocked: true }));
      expect(coach.shown).toBeNull();
      coach.update(view());
      expect(coach.shown?.id).toBe('talk');
      coach.update(view({ blocked: true }));
      expect(coach.shown).toBeNull();
    });

    it('nothing shows before the session started, and it looks at once when it starts', () => {
      const { storage, clock } = device();
      const coach = new TipCoach(new TipsStore(storage), clock.now);
      coach.update(view());
      expect(coach.shown).toBeNull();
      // The window was seen while connecting; nothing else changes when the character is reached.
      coach.start();
      expect(coach.shown?.id).toBe('talk');
    });

    it('a dismissed bubble goes unlearned and holds the next one back', () => {
      const { clock, session } = device();
      const coach = session();
      coach.update(view());
      coach.dismiss();
      expect(coach.shown).toBeNull();
      after(coach, clock, 1000, view({ microphoneOff: true }));
      expect(coach.shown).toBeNull();
      const next = session();
      next.update(view());
      expect(next.shown?.id).toBe('talk');
    });

    it('says when time alone changes what shows', () => {
      const { clock, session } = device();
      const coach = session();
      expect(coach.nextCheck()).toBeNull();
      coach.update(view());
      expect(coach.nextCheck()).toBe(6000);
      after(coach, clock, 6000);
      expect(coach.nextCheck()).toBe(30_000);
    });
  });

  describe('Show tips again', () => {
    it('makes every tip new, from the first, at once', () => {
      const { clock, session } = device();
      const coach = session();
      coach.signal('talked');
      coach.signal('stopped');
      coach.update(view());
      expect(coach.shown).toBeNull();
      coach.replay();
      expect(coach.shown?.id).toBe('talk');
      after(coach, clock, 6000);
      coach.replay();
      expect(coach.shown?.id).toBe('talk');
    });
  });
});
