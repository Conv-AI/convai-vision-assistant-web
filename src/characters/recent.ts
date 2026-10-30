export class RecentCharacters {
  static readonly storageKey = 'va.recent-characters';

  static readonly kept = 4;

  private ids: string[];
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;

  constructor(storage: Pick<Storage, 'getItem' | 'setItem'> | null) {
    this.storage = storage;
    this.ids = [];
    try {
      const stored: unknown = JSON.parse(storage?.getItem(RecentCharacters.storageKey) ?? '[]');
      if (Array.isArray(stored)) {
        this.ids = [
          ...new Set(stored.filter((id): id is string => typeof id === 'string' && id !== '')),
        ].slice(0, RecentCharacters.kept);
      }
    } catch {
      // Storage can be off or hold something else; the list then starts empty.
    }
  }

  /** Newest first. */
  get list(): readonly string[] {
    return this.ids;
  }

  /** Puts the character first. Kept for this page also where the device cannot keep it. */
  remember(id: string): void {
    if (this.ids[0] === id) return;
    this.ids = [id, ...this.ids.filter((other) => other !== id)].slice(0, RecentCharacters.kept);
    try {
      this.storage?.setItem(RecentCharacters.storageKey, JSON.stringify(this.ids));
    } catch {
      // Kept for this page only.
    }
  }
}
