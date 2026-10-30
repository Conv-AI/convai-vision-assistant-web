import type { Character } from '../credentials/characters';
import { CredentialsError } from '../credentials/api';

export const loadGiveUpMs = 10_000;

export interface CharacterListState {
  characters: readonly Character[] | null;
  /** A load is running. */
  loading: boolean;
  /** The last load failed or timed out: the picker offers Try again. */
  failed: boolean;
}

export class CharacterList {
  private current: CharacterListState = { characters: null, loading: false, failed: false };
  private readonly listeners = new Set<() => void>();
  private running: Promise<Character[]> | null = null;
  private initial: Promise<Character[]> | undefined;
  private giveUp: ReturnType<typeof setTimeout> | undefined;
  private cancel: (() => void) | undefined;
  private readonly fetchCharacters: (signal: AbortSignal) => Promise<Character[]>;

  constructor(fetchCharacters: (signal: AbortSignal) => Promise<Character[]>) {
    this.fetchCharacters = fetchCharacters;
  }

  get state(): CharacterListState {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Welcome and the first session share one discovery result, including a failure. */
  loadInitial(): Promise<Character[]> {
    this.initial ??= this.load();
    return this.initial;
  }

  /**
   * Loads the list; a call while one runs shares it. Rejects as the fetch did, and the state says
   * `failed` with the last list kept.
   */
  load(): Promise<Character[]> {
    if (this.running) return this.running;
    this.set({ loading: true, failed: false });
    clearTimeout(this.giveUp);
    const controller = new AbortController();
    const deadline = new Promise<never>((_resolve, reject) => {
      this.cancel = () => {
        reject(new CredentialsError('Character loading was cancelled.'));
        controller.abort();
      };
      this.giveUp = setTimeout(() => {
        reject(
          new CredentialsError(
            'Loading characters took too long. Check your connection and try again.',
          ),
        );
        controller.abort();
      }, loadGiveUpMs);
    });
    let work: Promise<Character[]>;
    try {
      work = this.fetchCharacters(controller.signal);
    } catch (error) {
      work = Promise.reject(
        error instanceof Error ? error : new Error('Could not load characters.'),
      );
    }
    // Settling the race prevents a late answer from replacing a successful retry.
    const running = Promise.race([work, deadline]).then(
      (characters) => {
        this.finish();
        this.set({ characters, loading: false, failed: false });
        return characters;
      },
      (error: unknown) => {
        this.finish();
        this.set({ loading: false, failed: true });
        throw error;
      },
    );
    this.running = running;
    return running;
  }

  /** Cancels any pending load and releases its timeout. */
  dispose(): void {
    this.cancel?.();
  }

  private finish(): void {
    this.running = null;
    this.cancel = undefined;
    clearTimeout(this.giveUp);
  }

  private set(change: Partial<CharacterListState>): void {
    this.current = { ...this.current, ...change };
    for (const listener of [...this.listeners]) listener();
  }
}
