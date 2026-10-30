// Inter loads one script at a time (src/kit/fonts/inter.css): a page fetches a file only once a
// letter of it is shown. A character who speaks Russian would then show its first answer in the
// fallback font until the Cyrillic file arrives. So once the session is live, the files for the
// character's languages are fetched while nothing else is.

/** Languages written in Latin letters beyond Latin-1, which Inter keeps in Latin Extended. */
const latinExtended = new Set(
  'az bs cs cy eo et hr hu lt lv mt pl ro sk sl sq sr tk tr uz'.split(' '),
);

/**
 * One letter from each Inter file the languages are written with beyond Latin, so asking the page to
 * load them fetches those files; empty for languages Latin alone writes (English, Spanish, …).
 */
export function lettersFor(languages: readonly string[]): string {
  const letters = new Set<string>();
  for (const code of languages) {
    let locale: Intl.Locale;
    try {
      locale = new Intl.Locale(code).maximize();
    } catch {
      continue;
    }
    if (locale.script === 'Cyrl') letters.add('Ж');
    else if (locale.script === 'Grek') letters.add('Ω');
    else if (locale.language === 'vi') letters.add('ệ');
    else if (locale.script === 'Latn' && latinExtended.has(locale.language)) letters.add('ő');
  }
  return [...letters].join('');
}

/** Asks the page to fetch the Inter files for `letters` when it is idle; returns the cancel. */
export function prefetchLetters(letters: string): () => void {
  if (letters === '' || typeof document === 'undefined' || !('fonts' in document)) {
    return () => undefined;
  }
  const load = () => {
    document.fonts.load('400 16px Inter', letters).catch(() => undefined);
  };
  if (typeof window.requestIdleCallback === 'function') {
    const idle = window.requestIdleCallback(load, { timeout: 3000 });
    return () => {
      window.cancelIdleCallback(idle);
    };
  }
  const timer = window.setTimeout(load, 1000);
  return () => {
    window.clearTimeout(timer);
  };
}
