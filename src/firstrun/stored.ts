import type { WindowMode } from '../compact/compact';
import type { TalkMode } from '../kit/capsule/capsuleCopy';
import { defaultTalkKey, isShortcutKey, type TalkKey } from './talkKey';

type PageStorage = Pick<Storage, 'getItem' | 'setItem'> | null;

export class FirstRunStore {
  static readonly doneKey = 'va.first-run-done';
  static readonly talkModeKey = 'va.talk-mode';
  static readonly talkKeyKey = 'va.talk-key';
  static readonly windowModeKey = 'va.window-mode';

  private readonly storage: PageStorage;
  private readonly listeners = new Set<() => void>();
  private done: boolean;
  private mode: TalkMode | null;
  private key: TalkKey;
  private window: WindowMode | null;

  constructor(storage: PageStorage) {
    this.storage = storage;
    this.done = this.read(FirstRunStore.doneKey) === '1';
    const mode = this.read(FirstRunStore.talkModeKey);
    this.mode = mode === 'push-to-talk' || mode === 'hands-free' ? mode : null;
    const key = this.read(FirstRunStore.talkKeyKey);
    // An empty value is kept: Settings › Shortcuts gave the talk key to another shortcut.
    this.key = key !== null && (key === '' || isShortcutKey(key)) ? key : defaultTalkKey;
    const window = this.read(FirstRunStore.windowModeKey);
    this.window = window === 'full' || window === 'compact' ? window : null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** True once a first run ended with Start on this device. */
  get isDone(): boolean {
    return this.done;
  }

  /** How the person chose to talk, or null before they chose. */
  get talkMode(): TalkMode | null {
    return this.mode;
  }

  /** The talk key as it types; empty when Settings left Talk without a key. */
  get talkKey(): TalkKey {
    return this.key;
  }

  /**
   * The mode chosen on "Where should Kira stay?", or null before it was chosen. It seeds the step
   * again; the window opens in it only from Start's press (a later visit opens in the full window).
   */
  get windowMode(): WindowMode | null {
    return this.window;
  }

  markDone(): void {
    this.done = true;
    this.write(FirstRunStore.doneKey, '1');
    this.changed();
  }

  setTalkMode(mode: TalkMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.write(FirstRunStore.talkModeKey, mode);
    this.changed();
  }

  setWindowMode(mode: WindowMode): void {
    if (mode === this.window) return;
    this.window = mode;
    this.write(FirstRunStore.windowModeKey, mode);
    this.changed();
  }

  /** Sets the talk key: a letter, a digit or "/", or empty for none. Anything else is ignored. */
  setTalkKey(key: TalkKey): void {
    if (key !== '' && !isShortcutKey(key)) return;
    if (key === this.key) return;
    this.key = key;
    this.write(FirstRunStore.talkKeyKey, key);
    this.changed();
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private read(name: string): string | null {
    try {
      return this.storage?.getItem(name) ?? null;
    } catch {
      return null;
    }
  }

  private write(name: string, value: string): void {
    try {
      this.storage?.setItem(name, value);
    } catch {
      // Kept for this page only.
    }
  }
}
