import type { DisplayKind } from './media';

export class ShareCard {
  static readonly times = 2;
  static readonly storageKey = 'va.share-card-shown';

  private shown: number;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;

  constructor(storage: Pick<Storage, 'getItem' | 'setItem'> | null) {
    this.storage = storage;
    this.shown = 0;
    try {
      const stored = Number(storage?.getItem(ShareCard.storageKey) ?? 0);
      this.shown = Number.isInteger(stored) && stored > 0 ? Math.min(stored, ShareCard.times) : 0;
    } catch {
      // Storage can be off; the card then counts for this page.
    }
  }

  /** Whether the card comes before the browser's picker is asked next. */
  get isDue(): boolean {
    return this.shown < ShareCard.times;
  }

  /**
   * Counts one showing, whichever button closes it. It counts for this page also where the device
   * cannot keep it, so the card never comes more than twice in one visit.
   */
  countShown(): void {
    if (!this.isDue) return;
    this.shown++;
    try {
      this.storage?.setItem(ShareCard.storageKey, String(this.shown));
    } catch {
      // Kept for this page only.
    }
  }
}

/** The page's own storage, or none where the browser gives the page none. */
export function pageStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const shareCardCopy = {
  title: 'Share a tab, window or screen',
  steps: ['Choose what to share', 'Confirm in your browser'],
  continue: 'Continue',
  cancel: 'Cancel',
} as const;

/**
 * The line under the title, as two sentences each on its own line: why, then the row's own sentence
 * (one card, one line per kind). On their own lines the card keeps one height whatever the kind.
 */
export function shareCardLines(name: string, kind: DisplayKind): [string, string] {
  const who = name.trim();
  const why = who === '' ? 'Only what you share is seen.' : `${who} sees only what you share.`;
  switch (kind) {
    case 'screen':
      return [why, 'Choose Entire screen.'];
    case 'window':
      return [why, 'Choose Window.'];
    case 'tab':
      return [why, `A tab gives ${who === '' ? 'the' : `${who} the`} sharpest view.`];
  }
}
