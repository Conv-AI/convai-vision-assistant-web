import type { Page } from '@playwright/test';

/** One text a live region was given: what a screen reader would be handed to say. */
export interface Said {
  /** Milliseconds since the page loaded. */
  at: number;
  /** `status`, `alert` or `log`, or `live=polite` for a bare aria-live region. */
  role: string;
  text: string;
}

declare global {
  interface Window {
    /** Every text a live region was given since the page loaded, oldest first. */
    vaSaid?: Said[];
  }
}

/**
 * Records every text a live region (role status, alert or log, or aria-live) is given, from before
 * the app loads, so a test can ask what a screen reader would have said for one change. A region
 * that comes into the page already holding words says nothing (screen readers read a region's
 * changes, not its arrival), and one that empties says nothing. Call it before `openApp`; read with
 * `said(page)`, which also empties the record.
 */
export async function recordSpeech(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const record: Said[] = [];
    window.vaSaid = record;
    const last = new WeakMap<Element, string>();
    const look = () => {
      for (const region of document.querySelectorAll(
        '[role=status],[role=alert],[role=log],[aria-live]',
      )) {
        const text = region.textContent.trim();
        const before = last.get(region);
        last.set(region, text);
        if (before === undefined || before === text || text === '') continue;
        record.push({
          at: Math.round(performance.now()),
          role: region.getAttribute('role') ?? `live=${region.getAttribute('aria-live') ?? ''}`,
          text,
        });
      }
    };
    new MutationObserver(look).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
}

/** What live regions were given since the last call (or since the page loaded), then forgets it. */
export async function said(page: Page): Promise<Said[]> {
  return page.evaluate(() => (window.vaSaid ?? []).splice(0));
}

/** The texts alone, for a readable expectation. */
export async function saidTexts(page: Page): Promise<string[]> {
  return (await said(page)).map((each) => each.text);
}
