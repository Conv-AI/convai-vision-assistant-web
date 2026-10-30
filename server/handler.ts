import type { ServerResponse } from 'node:http';

/** Server-only Convai API adapters. */
export const CONVAI_API_URL = 'https://api.convai.com';
export const CONVAI_CONNECT_URL = `${CONVAI_API_URL}/user/connect`;

/**
 * The end user every session speaks as when `CONVAI_END_USER_ID` is not set. One fixed id, because
 * each new id creates a long-term memory speaker on the account, and accounts have a limit.
 */
export const DEFAULT_END_USER_ID = 'vision-assistant-web-dev';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ServerEnv {
  CONVAI_API_KEY?: string;
  CONVAI_END_USER_ID?: string;
}

/** A character the app offers; `name` is null and `languages` empty when Convai could not say. */
export interface CharacterInfo {
  id: string;
  name: string | null;
  /** BCP 47 codes the character speaks, as Convai lists them ("en-US"). */
  languages: string[];
  /** The character's picture, an https address anyone may load; null when it has none. */
  portrait: string | null;
  /** Optional artwork; omitted when the account has not configured it. */
  portraitFull?: string;
  background?: string;
}

// Keep this adapter self-contained for both Node's TypeScript runtime and Vercel's compilation.
// The browser validates its optional image fields separately in credentials/imageUrl.ts.
function imageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The character's picture as Convai's own web SDK picks it (`readCharacterInfo` in 2.0.1): the square
 * MetaHuman avatar image, else the full one. `modelPlaceholder`, the SDK's last fallback, is left out:
 * it points at Ready Player Me, whose host no longer answers. Only an https address is kept.
 */
export function readPortrait(details: unknown): string | null {
  const metahuman =
    typeof details === 'object' && details !== null
      ? (details as Record<string, unknown>).METAHUMAN
      : undefined;
  if (typeof metahuman !== 'object' || metahuman === null) return null;
  const images = metahuman as Record<string, unknown>;
  for (const image of [images.avatar_image_square, images.avatar_image]) {
    const url = imageUrl(image);
    if (url) return url;
  }
  return null;
}

export function readArtwork(details: unknown): { portraitFull?: string; background?: string } {
  if (typeof details !== 'object' || details === null) return {};
  const images = (details as Record<string, unknown>).METAHUMAN;
  if (typeof images !== 'object' || images === null) return {};
  const fields = images as Record<string, unknown>;
  const portraitFull = imageUrl(fields.avatar_image);
  const background = imageUrl(fields.bg_image);
  return {
    ...(portraitFull ? { portraitFull } : {}),
    ...(background ? { background } : {}),
  };
}

const languageCode = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

/** Convai's `language_codes`, kept only when each is a language code, once each. */
export function readLanguages(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const codes = raw.filter(
    (code): code is string => typeof code === 'string' && languageCode.test(code),
  );
  return [...new Set(codes)];
}

export interface ApiAnswer {
  status: number;
  body: unknown;
}

/** An answer for the browser; `message` is shown to the user. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Where whoever runs the server sets the key, in the two messages that ask them to fix it. */
export interface KeySetup {
  /** Follows "CONVAI_API_KEY is not set." */
  add: string;
  /** Follows Convai's refusal of the key. */
  check: string;
}

export const DEV_KEY_SETUP: KeySetup = {
  add: 'Add it to .env.local and restart pnpm dev.',
  check: 'Check CONVAI_API_KEY in .env.local.',
};

export const SERVER_KEY_SETUP: KeySetup = {
  add: "Set it in the server's environment and restart the server.",
  check: "Check CONVAI_API_KEY in the server's environment.",
};

/**
 * Reads Convai's `expirationTime` as milliseconds since the epoch. Convai sends it without a zone
 * (`2026-10-22T21:29:42.674289`, one hour after the mint in UTC), so a zoneless time is UTC.
 */
export function parseExpirationTime(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const zoneless = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(raw);
  // Date.parse takes at most milliseconds, so the microseconds are cut.
  const text = zoneless ? `${zoneless[1] ?? ''}${(zoneless[2] ?? '').slice(0, 4)}Z` : raw;
  const time = Date.parse(text);
  return Number.isNaN(time) ? undefined : time;
}

/** Mints a short-lived token with Convai's `POST /user/connect`. */
export async function mintToken(
  apiKey: string | undefined,
  fetchFn: FetchLike,
  setup: KeySetup,
): Promise<{ token: string; expiresAt?: number }> {
  if (!apiKey) {
    throw new ApiError(500, `CONVAI_API_KEY is not set. ${setup.add}`);
  }

  let response: Response;
  try {
    response = await fetchFn(`${CONVAI_API_URL}/user/connect`, {
      method: 'POST',
      // Convai refuses a mint without a JSON content type.
      headers: { 'CONVAI-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch {
    throw new ApiError(502, 'Could not reach Convai to get a token. Check the connection.');
  }
  if (!response.ok) {
    // Convai's body is not passed on: it is not written for this app's users.
    throw new ApiError(
      502,
      `Convai refused the token request (HTTP ${String(response.status)}). ${setup.check}`,
    );
  }

  const body: unknown = await response.json().catch(() => undefined);
  const reply = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const token = reply.apiAuthToken;
  if (typeof token !== 'string' || token === '') {
    throw new ApiError(502, 'Convai answered the token request without a token.');
  }
  const expiresAt = parseExpirationTime(reply.expirationTime);
  return expiresAt === undefined ? { token } : { token, expiresAt };
}

/** The end user sessions speak as: `CONVAI_END_USER_ID`, or the one fixed default. */
export function endUserId(env: ServerEnv): string {
  // An empty value counts as unset, so `??` alone would not do.
  const id = env.CONVAI_END_USER_ID?.trim() ?? '';
  return id === '' ? DEFAULT_END_USER_ID : id;
}

/** Lists the account's characters using the documented hosted API. */
export async function listHostedCharacters(
  apiKey: string,
  fetchFn: FetchLike,
): Promise<CharacterInfo[]> {
  let response: Response;
  try {
    response = await fetchFn(`${CONVAI_API_URL}/character/list`, {
      method: 'POST',
      headers: { 'CONVAI-API-KEY': apiKey },
    });
  } catch {
    throw new ApiError(502, 'Could not reach Convai to load characters.');
  }
  if (!response.ok)
    throw new ApiError(
      502,
      `Convai refused the character list request (HTTP ${String(response.status)}). Check your API key.`,
    );
  const body: unknown = await response.json().catch(() => null);
  const raw =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>).characters : null;
  if (!Array.isArray(raw)) throw new ApiError(502, 'Convai answered without a character list.');
  return raw.flatMap((item: unknown): CharacterInfo[] => {
    if (typeof item !== 'object' || item === null) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.character_id !== 'string' || record.character_id.trim() === '') return [];
    return [
      {
        id: record.character_id,
        name:
          typeof record.character_name === 'string' && record.character_name.trim() !== ''
            ? record.character_name.trim()
            : null,
        languages: readLanguages(record.language_codes),
        portrait: readPortrait(record.model_details),
        ...readArtwork(record.model_details),
      },
    ];
  });
}

/** Answers one request, or returns `undefined` when the path is not an `/api` route. */
export async function handleApiRequest(
  method: string | undefined,
  path: string,
  env: ServerEnv,
  fetchFn: FetchLike,
  setup: KeySetup,
): Promise<ApiAnswer | undefined> {
  if (path !== '/api/token' && path !== '/api/characters') return undefined;
  if (method !== 'GET') return { status: 405, body: { error: `Use GET for ${path}.` } };

  const apiKey = env.CONVAI_API_KEY;

  try {
    if (!apiKey) throw new ApiError(500, `CONVAI_API_KEY is not set. ${setup.add}`);
    if (path === '/api/token') {
      const minted = await mintToken(apiKey, fetchFn, setup);
      return {
        status: 200,
        body: {
          ...minted,
          endUserId: endUserId(env),
        },
      };
    }
    return {
      status: 200,
      body: { characters: await listHostedCharacters(apiKey, fetchFn) },
    };
  } catch (error) {
    if (error instanceof ApiError) return { status: error.status, body: { error: error.message } };
    return { status: 500, body: { error: `The app server failed to answer ${path}.` } };
  }
}

/** The headers every answer carries: JSON, and never kept by a cache, since a token is in it. */
export const ANSWER_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
} as const;

/** Writes an answer to a Node response (the Vite dev server and `pnpm start`). */
export function sendAnswer(res: ServerResponse, answer: ApiAnswer): void {
  res.writeHead(answer.status, ANSWER_HEADERS);
  res.end(JSON.stringify(answer.body));
}

/** An answer as a web `Response` (the Vercel functions). */
export function toResponse(answer: ApiAnswer): Response {
  return new Response(JSON.stringify(answer.body), {
    status: answer.status,
    headers: ANSWER_HEADERS,
  });
}

/** Answers a web `Request` (the Vercel functions); a path that is no `/api` route gets a 404. */
export async function answerRequest(
  request: Request,
  env: ServerEnv,
  fetchFn: FetchLike,
  setup: KeySetup,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const answer = await handleApiRequest(request.method, path, env, fetchFn, setup);
  return toResponse(answer ?? notFound(path));
}

/** The answer for a path under `/api` that is no route. */
export function notFound(path: string): ApiAnswer {
  return { status: 404, body: { error: `There is no route ${path}.` } };
}
