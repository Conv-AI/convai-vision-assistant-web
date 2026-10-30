import { mirrorRoot, type PictureWindows, type WindowSize } from './pip';

export type WindowMode = 'full' | 'compact';

export const compactPadding = 8;
const capsuleWidth = 360;
const capsuleHeight = 64;

/** The window's size for the capsule at `textScale`, whose height follows the text size. */
export function compactWindowSize(textScale: number): WindowSize {
  return {
    width: capsuleWidth + 2 * compactPadding,
    height: Math.round(capsuleHeight * textScale) + 2 * compactPadding,
  };
}

export const compactNoticeMs = 6000;
export const compactNoticeRepeatMs = 10_000;

export interface CompactState {
  mode: WindowMode;
  /** The floating window while Compact; null in the full window. */
  window: Window | null;
  /** The browser is opening the window: a second press waits. */
  opening: boolean;

  card: boolean;

  cardSeen: boolean;

  notice: boolean;
}

export interface CompactOptions {
  /** The page's document, whose root the floating window's follows. */
  page?: Document;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export class Compact {
  private current: CompactState = {
    mode: 'full',
    window: null,
    opening: false,
    card: false,
    cardSeen: false,
    notice: false,
  };
  private readonly listeners = new Set<() => void>();
  private readonly page: Document | undefined;
  private readonly now: () => number;
  private readonly setTimer: (run: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private noticeTimer: unknown = undefined;
  private noticeShownAt = Number.NEGATIVE_INFINITY;
  private stopMirror: () => void = () => undefined;
  private readonly windows: PictureWindows;

  constructor(windows: PictureWindows, options: CompactOptions = {}) {
    this.windows = windows;
    this.page = options.page;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
    this.clearTimer =
      options.clearTimer ??
      ((timer) => {
        clearTimeout(timer as ReturnType<typeof setTimeout>);
      });
  }

  get state(): CompactState {
    return this.current;
  }

  /** True where Compact can open: the browser has floating windows. */
  get supported(): boolean {
    return this.windows.supported;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  enter(textScale = 1): void {
    if (this.current.mode === 'compact' || this.current.opening) return;
    if (!this.windows.supported) {
      this.set({ card: !this.current.card, cardSeen: true });
      return;
    }
    this.set({ opening: true, card: false });
    this.windows.open(compactWindowSize(textScale)).then(
      (opened) => {
        // The page may have left Compact's way meanwhile (it went back to the full window).
        if (!this.current.opening) {
          opened.close();
          return;
        }
        if (this.page) this.stopMirror = mirrorRoot(this.page, opened.document);
        opened.addEventListener('pagehide', () => {
          this.closed(opened);
        });
        this.set({ mode: 'compact', window: opened, opening: false });
      },
      () => {
        // Refused (no press, or the browser said no): the full window stays.
        this.set({ opening: false });
      },
    );
  }

  /** Back to the full window: the floating window closes. */
  leave(): void {
    const opened = this.current.window;
    if (this.current.opening) this.set({ opening: false });
    if (!opened) return;
    this.closed(opened);
    opened.close();
  }

  closeCard(): void {
    if (this.current.card) this.set({ card: false });
  }

  refuseImage(): boolean {
    if (this.current.mode !== 'compact') return false;
    const now = this.now();
    if (now - this.noticeShownAt < compactNoticeRepeatMs) return false;
    this.noticeShownAt = now;
    this.clearTimer(this.noticeTimer);
    this.noticeTimer = this.setTimer(() => {
      this.set({ notice: false });
    }, compactNoticeMs);
    this.set({ notice: true });
    return true;
  }

  /**
   * The toast held while the pointer is on it or the focus in it, as the kit's Island holds its
   * notices; let go, it stays its whole 6 s again.
   */
  holdNotice(held: boolean): void {
    if (!this.current.notice) return;
    this.clearTimer(this.noticeTimer);
    if (held) return;
    this.noticeTimer = this.setTimer(() => {
      this.set({ notice: false });
    }, compactNoticeMs);
  }

  /** The toast closed by its own action or by Esc. */
  closeNotice(): void {
    this.clearTimer(this.noticeTimer);
    if (this.current.notice) this.set({ notice: false });
  }

  private closed(opened: Window): void {
    if (this.current.window !== opened) return;
    this.stopMirror();
    this.stopMirror = () => undefined;
    this.clearTimer(this.noticeTimer);
    this.set({ mode: 'full', window: null, notice: false });
  }

  private set(change: Partial<CompactState>): void {
    this.current = { ...this.current, ...change };
    for (const listener of this.listeners) listener();
  }
}
