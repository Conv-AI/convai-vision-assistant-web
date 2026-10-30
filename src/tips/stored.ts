import { tipOrder, type TipId } from './copy';

type PageStorage = Pick<Storage, 'getItem' | 'setItem'> | null;

/** What the device remembers of one tip. */
interface TipRecord {
  learned: boolean;
  /** How many times it has shown: once, and once more in a later session if it was not learned. */
  shows: number;
  /** The session it last showed in (it shows at most once a session). */
  shownIn: number;

  skippedIn: number;
}

interface Saved {
  sessions: number;
  answers: number;
  tips: Partial<Record<TipId, Partial<TipRecord>>>;
}

const blank = (): TipRecord => ({ learned: false, shows: 0, shownIn: 0, skippedIn: 0 });

/**
 * The tips as this device remembers them (`va.tips`, as the first run keeps `va.first-run-done`):
 * which are learned, how often each showed and in which session, how many sessions and answers there
 * have been. A session is one visit of the page that reached the character (VW). Storage can be off:
 * the tips then last for the page only.
 */
export class TipsStore {
  static readonly key = 'va.tips';

  private readonly storage: PageStorage;
  private sessionCount: number;
  private answerCount: number;
  private readonly records = new Map<TipId, TipRecord>();

  constructor(storage: PageStorage) {
    this.storage = storage;
    const saved = this.read();
    this.sessionCount = whole(saved?.sessions);
    this.answerCount = whole(saved?.answers);
    for (const id of tipOrder) {
      const record = saved?.tips[id];
      this.records.set(id, {
        learned: record?.learned === true,
        shows: whole(record?.shows),
        shownIn: whole(record?.shownIn),
        skippedIn: whole(record?.skippedIn),
      });
    }
  }

  /** The sessions so far, this one included once `startSession` ran. */
  get sessions(): number {
    return this.sessionCount;
  }

  /** The answers the character has finished on this device, over every session. */
  get answers(): number {
    return this.answerCount;
  }

  /** A new session: returns its number (1 for the first). */
  startSession(): number {
    this.sessionCount += 1;
    this.write();
    return this.sessionCount;
  }

  addAnswer(): void {
    this.answerCount += 1;
    this.write();
  }

  isLearned(id: TipId): boolean {
    return this.record(id).learned;
  }

  learn(id: TipId): void {
    if (this.record(id).learned) return;
    this.records.set(id, { ...this.record(id), learned: true });
    this.write();
  }

  /** The tip is on screen in `session`. */
  shown(id: TipId, session: number): void {
    const record = this.record(id);
    this.records.set(id, { ...record, shows: record.shows + 1, shownIn: session });
    this.write();
  }

  skip(id: TipId, session: number): void {
    this.records.set(id, { ...this.record(id), skippedIn: session });
    this.write();
  }

  /**
   * May show in `session`: not learned, not shown or skipped in it, and shown at most once before
   * (a tip that left unlearned comes back once, in a later session).
   */
  isDue(id: TipId, session: number): boolean {
    const record = this.record(id);
    return (
      !record.learned &&
      record.shows < 2 &&
      record.shownIn !== session &&
      record.skippedIn !== session
    );
  }

  /** Show tips again (Settings › Talking; How to use's Try it): every tip as new, from the first. */
  reset(): void {
    for (const id of tipOrder) this.records.set(id, blank());
    this.answerCount = 0;
    this.write();
  }

  private record(id: TipId): TipRecord {
    return this.records.get(id) ?? blank();
  }

  private read(): Saved | null {
    try {
      const text = this.storage?.getItem(TipsStore.key);
      if (!text) return null;
      const value: unknown = JSON.parse(text);
      if (typeof value !== 'object' || value === null) return null;
      const saved = value as { sessions?: unknown; answers?: unknown; tips?: unknown };
      return {
        sessions: whole(saved.sessions),
        answers: whole(saved.answers),
        tips: typeof saved.tips === 'object' && saved.tips !== null ? saved.tips : {},
      };
    } catch {
      return null;
    }
  }

  private write(): void {
    const tips: Saved['tips'] = {};
    for (const [id, record] of this.records) tips[id] = record;
    const saved: Saved = { sessions: this.sessionCount, answers: this.answerCount, tips };
    try {
      this.storage?.setItem(TipsStore.key, JSON.stringify(saved));
    } catch {
      // Kept for this page only.
    }
  }
}

/** A stored count, or 0 for anything that is not a whole number of at least 0. */
function whole(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
