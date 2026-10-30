/** The language part of a code: "en" of "en-US". */
function baseOf(code: string): string {
  return code.split('-')[0]?.toLowerCase() ?? '';
}

function nameIn(locale: string, base: string): string | null {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' }).of(base);
    return name && name !== base ? name : null;
  } catch {
    return null;
  }
}

/** The language's English display name; null when unknown. */
export function ownName(code: string): string | null {
  const base = baseOf(code);
  const name = nameIn('en', base);
  if (!name) return null;
  return name.slice(0, 1).toLocaleUpperCase('en') + name.slice(1);
}

/** A language as the stage lists it: its English display name and language code. */
export interface SpokenLanguage {
  lang: string;
  name: string;
}

/** The languages to list, in English, the device's first. Unknown codes are left out. */
export function spokenLanguages(
  codes: readonly string[],
  deviceLanguage: string,
): SpokenLanguage[] {
  const device = baseOf(deviceLanguage);
  const bases = [...new Set(codes.map(baseOf).filter((base) => base !== ''))];
  const ordered = [
    ...bases.filter((base) => base === device),
    ...bases.filter((base) => base !== device),
  ];
  return ordered.flatMap((lang) => {
    const name = ownName(lang);
    return name ? [{ lang, name }] : [];
  });
}

/** What a search finds a language by: its own name and its English one ("Deutsch", "German"). */
export function languageWords(code: string): string[] {
  const base = baseOf(code);
  return [nameIn(base, base), nameIn('en', base)].filter((word): word is string => word !== null);
}
