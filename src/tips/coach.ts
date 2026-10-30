import type { CapsuleState } from '../kit/capsule/capsuleCopy';
import { tipOrder, tipTargets, type TipId, type TipTargetId } from './copy';
import type { TipSignal } from './signals';
import type { TipsStore } from './stored';

export const tipTiming = {
  shows: 6000,

  stopAfter: 1500,

  spacing: 30_000,
} as const;

export const answersToLearnStop = 3;
export const answersBeforeTranscript = 3;

export const spokenBeforeType = 2;

/** The window as the tips need to see it. */
export interface TipView {
  blocked: boolean;
  /** The capsule's state; null while there is none. */
  capsule: CapsuleState | null;
  /** A reply is being thought or spoken. */
  answering: boolean;

  stageAction: boolean;
  /** Stage captions are on: the capsule already says "Esc to stop", so tip 2 waits (Tip README). */
  captions: boolean;
  /** A caption stands on the stage now (it stays a few seconds after an answer). */
  captionShown: boolean;
  /** The microphone is muted, blocked, missing or busy: settled, so typing is the way (tip 3). */
  microphoneOff: boolean;

  microphoneWaiting: boolean;
  /** The transcript is open (pinned, floating or as a sheet). */
  transcriptOpen: boolean;
  /** Quick controls is open. */
  quickOpen: boolean;
  /** The targets on screen now. */
  targets: ReadonlySet<TipTargetId>;
  /** The tips that have words for this person's keys (one set to none has nothing to teach). */
  worded: ReadonlySet<TipId>;
}

export interface ShownTip {
  id: TipId;
  target: TipTargetId;
  /** When it came, in milliseconds since the epoch. */
  since: number;
}

/** Why a bubble left: the person did the thing, or it went unlearned. */
export type TipLeaving = 'learned' | 'timeout' | 'dismissed' | 'away';

export class TipCoach {
  private readonly store: TipsStore;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();
  private session = 0;
  private current: ShownTip | null = null;
  private view: TipView | null = null;
  /** Unlearned bubbles hold the next one back until then (one every 30 s). */
  private quietUntil = 0;
  private speechSince: number | null = null;
  private spokenTurns = 0;
  private answersEnded = 0;
  private versionCount = 0;

  constructor(store: TipsStore, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
  }

  /** Changes each time `shown` does, for `useSyncExternalStore`. */
  get version(): number {
    return this.versionCount;
  }

  get shown(): ShownTip | null {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The page reached the character: a session of the tips begins (once per page). */
  start(): void {
    if (this.session !== 0) return;
    this.session = this.store.startSession();
    this.refresh();
  }

  /** Show tips again: every tip as new, from the first one, at once. */
  replay(): void {
    this.store.reset();
    this.quietUntil = 0;
    if (this.current) this.leave('away');
    this.refresh();
  }

  signal(signal: TipSignal): void {
    switch (signal) {
      case 'talked':
        this.spokenTurns += 1;
        this.store.learn('talk');
        break;
      case 'typed':
        this.store.learn('type');

        if (!this.store.isLearned('talk') && this.current?.id !== 'talk')
          this.store.skip('talk', this.session);
        break;
      case 'speech-started':
        this.speechSince = this.now();
        break;
      case 'answer-ended':
        this.speechSince = null;
        this.answersEnded += 1;
        this.store.addAnswer();
        if (this.store.answers >= answersToLearnStop) this.store.learn('stop');
        break;
      case 'stopped':
        this.store.learn('stop');
        break;
    }
    this.refresh();
  }

  /** Esc with nothing else to close, or a press elsewhere: the bubble goes, unlearned. */
  dismiss(): void {
    if (!this.current) return;
    this.leave('dismissed');
    this.refresh();
  }

  update(view: TipView): void {
    const was = this.view;
    this.view = view;
    // Opening the transcript or Quick controls is the thing tips 4 and 5 teach.
    if (was && view.transcriptOpen && !was.transcriptOpen) this.store.learn('transcript');
    if (was && view.quickOpen && !was.quickOpen) this.store.learn('quick');
    this.refresh();
  }

  /** Milliseconds from now until time alone may change which tip shows; null when nothing waits. */
  nextCheck(): number | null {
    const now = this.now();
    const times: number[] = [];
    if (this.current) times.push(this.current.since + tipTiming.shows);
    else {
      if (this.quietUntil > now) times.push(this.quietUntil);
      if (this.speechSince !== null) times.push(this.speechSince + tipTiming.stopAfter);
    }
    const later = times.filter((time) => time > now);
    return later.length === 0 ? null : Math.min(...later) - now;
  }

  private refresh(): void {
    const view = this.view;
    const now = this.now();
    if (this.current && view) {
      const { id, since } = this.current;

      if (id === 'talk' && (view.capsule === 'held' || view.capsule === 'listening'))
        this.store.learn('talk');
      if (this.store.isLearned(id)) this.leave('learned');
      else if (!this.fits(id, view, now)) this.leave('away');
      else if (now >= since + tipTiming.shows) this.leave('timeout');
    }
    if (!this.current && view && this.session > 0 && now >= this.quietUntil) {
      const next = tipOrder.find(
        (id) => this.store.isDue(id, this.session) && this.fits(id, view, now),
      );
      if (next) {
        this.current = { id: next, target: tipTargets[next], since: now };
        this.store.shown(next, this.session);
        this.changed();
      }
    }
  }

  private leave(why: TipLeaving): void {
    // A bubble that went unlearned holds the next one back; one that was learned does not, so the
    // person who just talked hears about Esc on that very answer (VW).
    if (why !== 'learned') this.quietUntil = this.now() + tipTiming.spacing;
    this.current = null;
    this.changed();
  }

  /** Whether `id` has its moment in this view. */
  private fits(id: TipId, view: TipView, now: number): boolean {
    if (view.blocked || !view.targets.has(tipTargets[id]) || !view.worded.has(id)) return false;
    // A caption stays a few seconds after an answer: tips 3–5 never stand over it.
    const idle =
      (view.capsule === 'ready' || view.capsule === 'muted') &&
      !view.answering &&
      !view.captionShown;
    switch (id) {
      case 'talk':
        return (
          view.capsule === 'ready' &&
          !view.answering &&
          !view.microphoneOff &&
          !view.microphoneWaiting &&
          !view.stageAction
        );
      case 'stop':
        return (
          view.capsule === 'speaking' &&
          !view.captions &&
          this.speechSince !== null &&
          now >= this.speechSince + tipTiming.stopAfter
        );
      case 'type':
        // After the second spoken turn, or at once when the microphone is muted or off.
        return idle && (this.spokenTurns >= spokenBeforeType || view.microphoneOff);
      case 'transcript':
        return idle && !view.transcriptOpen && this.answersEnded >= answersBeforeTranscript;
      case 'quick':
        // The second session, after its first answer.
        return idle && this.session >= 2 && this.answersEnded >= 1;
    }
  }

  private changed(): void {
    this.versionCount += 1;
    for (const listener of [...this.listeners]) listener();
  }
}
