import { levelRank, type Notification, type NotificationAction } from './notification';

export const minimumSeconds = 1.2;
/** The same key within this long is dropped. */
export const duplicateSeconds = 10;

export const queueSize = 5;

export const heldStatusSeconds = 10;

/** Why a notification is on the dot, which decides whether it comes back by itself. */
type DotReason =
  /** Something higher took its place: it comes back when that ends. */
  | 'outranked'
  /** A Problem made room for lower items: it comes back once they have played. */
  | 'aside'
  /** The user put it away, or it went there by itself: it stays until resolved or expanded. */
  | 'kept';

interface Entry {
  n: Notification;
  seq: number;
  /** When a hold first kept this Status back, while one still does. */
  heldAt?: number;
}

/** What passes a hold may show while the hold stands. */
export type HoldTest = (n: Notification) => boolean;

export class NotificationQueue {
  private entry: Entry | null = null;
  private shownAt = 0;
  private runStart = 0;
  private elapsedBefore = 0;
  private closing = false;
  private paused = false;
  private seq = 0;
  private readonly queue: Entry[] = [];
  private readonly dots: { entry: Entry; reason: DotReason }[] = [];
  private readonly posted = new Map<string, number>();
  private readonly holds = new Set<HoldTest>();
  private readonly listeners = new Set<() => void>();
  private signature = '';
  private changes = 0;

  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  /**
   * Counts the changes to what the Island shows: a view reads it as its snapshot, so a change made
   * while it was between two subscriptions is still seen.
   */
  get version(): number {
    return this.changes;
  }

  /** What the Island shows now, or null. */
  get current(): Notification | null {
    return this.entry?.n ?? null;
  }

  /** What waits, in the order it will show. */
  get waiting(): Notification[] {
    return this.queue.map((e) => e.n);
  }

  /** What is on the dot, oldest first. */
  get dotted(): Notification[] {
    return this.dots.map((d) => d.entry.n);
  }

  /** The newest notification on the dot, or null. */
  get dotTop(): Notification | null {
    return this.dots.at(-1)?.entry.n ?? null;
  }

  contains(key: string): boolean {
    return (
      this.entry?.n.key === key ||
      this.queue.some((e) => e.n.key === key) ||
      this.dots.some((d) => d.entry.n.key === key)
    );
  }

  /** Calls `listener` whenever what the Island shows changes; returns how to stop. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get isPaused(): boolean {
    return this.paused;
  }

  set isPaused(value: boolean) {
    this.pause(value);
  }

  /** Stops (true) or restarts (false) a toast's time. */
  pause(value: boolean): void {
    if (value === this.paused) return;
    const now = this.now();
    if (value) this.elapsedBefore += now - this.runStart;
    else this.runStart = now;
    this.paused = value;
  }

  post(n: Notification): void {
    this.change(() => {
      const now = this.now();
      // A Problem or Request with the same key updates the one there, in place.
      if ((n.level === 'problem' || n.level === 'request') && this.replace(n)) return;

      const waiting = this.queue.find((e) => e.n.key === n.key);
      if (waiting) {
        waiting.n = n;
        return;
      }
      const last = this.posted.get(n.key);
      if (last !== undefined && now - last < duplicateSeconds) return;
      this.posted.set(n.key, now);

      if (n.level === 'undo' && !this.passes(n)) return;

      const entry = { n, seq: this.seq++ };
      if (this.passes(n) && (!this.entry || outranks(n, this.entry.n))) {
        if (this.entry) this.displace(this.entry);
        this.show(entry);
      } else {
        this.enqueue(entry);
      }
    });
  }

  /**
   * Moves time on: ends what has shown its time, lets lower items play past a Problem, and drops a
   * Status a hold has kept back for too long.
   */
  tick(): void {
    this.change(() => {
      this.dropHeld();
      const current = this.entry;
      if (!current) {
        this.advance();
        return;
      }
      const now = this.now();
      const shown = now - this.shownAt;
      const elapsed = this.elapsedBefore + (this.paused ? 0 : now - this.runStart);
      const n = current.n;
      if (this.closing) {
        if (shown >= minimumSeconds) this.end();
      } else if (elapsed >= n.seconds) {
        this.end();
      } else if (n.level === 'problem' && n.dotAfter !== undefined && elapsed >= n.dotAfter) {
        this.dots.push({ entry: current, reason: 'kept' });
        this.end();
      } else if (
        n.level === 'problem' &&
        shown >= minimumSeconds &&
        this.queue.some((e) => this.passes(e.n))
      ) {
        this.dots.push({ entry: current, reason: 'aside' });
        this.end();
      }
    });
  }

  close(key: string, now = false): void {
    this.change(() => {
      if (this.entry?.n.key === key) {
        if (now || this.now() - this.shownAt >= minimumSeconds) this.end();
        else this.closing = true;
        return;
      }
      remove(this.queue, (e) => e.n.key === key);
      remove(this.dots, (d) => d.entry.n.key === key);
    });
  }

  /** Runs an action of what shows; unless it keeps the notification, that ends it at once. */
  invoke(action: NotificationAction | undefined): void {
    if (!action) return;
    action.run();
    if (action.closes === false) return;
    const current = this.entry;
    if (current && (current.n.primary === action || current.n.secondary === action)) {
      this.change(() => {
        this.end();
      });
    }
  }

  /** Ctrl or ⌘ Z: runs the Undo that shows. False when none does, so the key passes on to the app. */
  invokeUndo(): boolean {
    const current = this.entry?.n;
    if (current?.level !== 'undo') return false;
    this.invoke(current.primary);
    return true;
  }

  /** Esc or the close: a Problem or Request becomes the dot; a toast just ends. */
  putAway(): void {
    this.change(() => {
      const current = this.entry;
      if (!current) return;
      if (current.n.level === 'problem' || current.n.level === 'request') {
        this.dots.push({ entry: current, reason: 'kept' });
      }
      this.end();
    });
  }

  /** A click on the dot: its newest notification shows again, unless a hold keeps it. */
  expand(): void {
    this.change(() => {
      const top = this.dots.at(-1);
      if (!top || !this.passes(top.entry.n)) return;
      this.dots.pop();
      if (this.entry) this.displace(this.entry);
      this.show(top.entry);
    });
  }

  hold(passes: HoldTest): () => void {
    this.change(() => {
      this.holds.add(passes);
      this.applyHolds();
    });
    let lifted = false;
    return () => {
      if (lifted) return;
      lifted = true;
      this.change(() => {
        this.holds.delete(passes);
        const best = this.queue.find((e) => this.passes(e.n));
        if (this.entry && best && outranks(best.n, this.entry.n)) {
          remove(this.queue, (e) => e === best);
          this.displace(this.entry);
          this.show(best);
        }
        this.advance();
      });
    };
  }

  private dropHeld() {
    const now = this.now();
    for (const entry of this.queue) {
      if (entry.n.level !== 'status' || this.passes(entry.n)) entry.heldAt = undefined;
      else entry.heldAt ??= now;
    }
    remove(this.queue, (e) => e.heldAt !== undefined && now - e.heldAt >= heldStatusSeconds - 1e-9);
  }

  private passes(n: Notification): boolean {
    for (const test of this.holds) if (!test(n)) return false;
    return true;
  }

  private applyHolds() {
    remove(this.queue, (e) => e.n.level === 'undo' && !this.passes(e.n));
    const current = this.entry;
    if (current && !this.passes(current.n)) {
      this.entry = null;
      if (current.n.level !== 'undo') this.enqueue(current);
    }
  }

  private replace(n: Notification): boolean {
    if (this.entry?.n.key === n.key) {
      this.entry.n = n;
      return true;
    }
    const entry =
      this.queue.find((e) => e.n.key === n.key) ??
      this.dots.find((d) => d.entry.n.key === n.key)?.entry;
    if (!entry) return false;
    entry.n = n;
    return true;
  }

  /** What shows gives way to something higher: a Status waits again, an Undo is dropped. */
  private displace(entry: Entry) {
    this.entry = null;
    if (entry.n.level === 'status') this.enqueue(entry);
    else if (entry.n.level !== 'undo') this.dots.push({ entry, reason: 'outranked' });
  }

  private enqueue(entry: Entry) {
    const at = this.queue.findIndex((e) => before(entry, e));
    if (at < 0) this.queue.push(entry);
    else this.queue.splice(at, 0, entry);
    while (this.queue.length > queueSize) {
      const oldest =
        this.queue.filter((e) => e.n.level === 'status').sort((a, b) => a.seq - b.seq)[0] ??
        this.queue.filter((e) => e.n.level === 'undo').sort((a, b) => a.seq - b.seq)[0];
      // Problems and Requests are never dropped for room.
      if (!oldest) break;
      remove(this.queue, (e) => e === oldest);
    }
  }

  private show(entry: Entry) {
    const now = this.now();
    this.entry = entry;
    this.shownAt = now;
    this.runStart = now;
    this.elapsedBefore = 0;
    this.closing = false;
  }

  private end() {
    this.entry = null;
    this.closing = false;
    this.advance();
  }

  /** Shows the next thing: what was outranked or waits, by level then arrival; a Problem that stepped aside, last. */
  private advance() {
    if (this.entry) return;
    const returning = this.dots.filter((d) => d.reason === 'outranked' && this.passes(d.entry.n));
    const candidates = [
      ...this.queue.filter((e) => this.passes(e.n)),
      ...returning.map((d) => d.entry),
    ].sort((a, b) => (before(a, b) ? -1 : 1));
    let next = candidates[0];
    next ??= this.dots.find((d) => d.reason === 'aside' && this.passes(d.entry.n))?.entry;
    if (!next) return;
    const chosen = next;
    remove(this.queue, (e) => e === chosen);
    remove(this.dots, (d) => d.entry === chosen);
    this.show(chosen);
  }

  /** Runs `work` and tells the listeners if what the Island shows changed. */
  private change(work: () => void) {
    work();
    const n = this.entry?.n;
    const next = [n?.key, n?.title, n?.detail, n?.body, this.dots.length, this.dotTop?.key].join(
      '|',
    );
    if (next === this.signature) return;
    this.signature = next;
    this.changes++;
    for (const listener of this.listeners) listener();
  }
}

function outranks(n: Notification, shown: Notification): boolean {
  // Of two Problems the newer shows; otherwise only a higher level morphs over what shows.
  return (
    levelRank[n.level] < levelRank[shown.level] ||
    (n.level === 'problem' && shown.level === 'problem')
  );
}

/** Level, then arrival. */
function before(a: Entry, b: Entry): boolean {
  const rank = levelRank[a.n.level] - levelRank[b.n.level];
  return rank < 0 || (rank === 0 && a.seq < b.seq);
}

function remove<T>(list: T[], match: (item: T) => boolean) {
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i];
    if (item !== undefined && match(item)) list.splice(i, 1);
  }
}
