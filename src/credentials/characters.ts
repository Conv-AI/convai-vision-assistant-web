import { CredentialsError, defaultFetch, getJson, isRecord, type FetchLike } from './api';
import { imageUrl } from './imageUrl';

/** A character the app offers. */
export interface Character {
  id: string;
  /** The character's name, or null when the app server could not look it up. */
  name: string | null;
  /** The languages it speaks as BCP 47 codes ("en-US"); empty when the server could not say. */
  languages: readonly string[];
  /** The character's picture (an https address), or null when it has none. */
  portrait: string | null;
  /** Full character artwork and its separate background, when available. */
  portraitFull?: string;
  background?: string;
}

function isCharacter(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id !== '' &&
    (value.name === null || typeof value.name === 'string') &&
    (value.languages === undefined ||
      (Array.isArray(value.languages) &&
        value.languages.every((code: unknown) => typeof code === 'string'))) &&
    (value.portrait === undefined ||
      value.portrait === null ||
      (typeof value.portrait === 'string' && value.portrait.startsWith('https://')))
  );
}

/**
 * The characters the app offers, from the app's server, `GET /api/characters`. An empty list means
 * the account has no characters. A server that sends no languages or picture gives none of them.
 */
export async function getCharacters(
  fetchFn: FetchLike = defaultFetch,
  signal?: AbortSignal,
): Promise<Character[]> {
  const body = await getJson('/api/characters', fetchFn, signal);
  const characters = isRecord(body) ? body.characters : undefined;
  if (!Array.isArray(characters) || !characters.every(isCharacter)) {
    throw new CredentialsError('The app server answered without a list of characters.');
  }
  return (characters as Record<string, unknown>[]).map((value) => {
    const portraitFull = imageUrl(value.portraitFull);
    const background = imageUrl(value.background);
    return {
      id: value.id as string,
      name: value.name as string | null,
      languages: (value.languages as string[] | undefined) ?? [],
      portrait: (value.portrait as string | null | undefined) ?? null,
      ...(portraitFull ? { portraitFull } : {}),
      ...(background ? { background } : {}),
    };
  });
}
