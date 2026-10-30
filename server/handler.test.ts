// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  CONVAI_CONNECT_URL,
  DEFAULT_END_USER_ID,
  DEV_KEY_SETUP,
  ApiError,
  endUserId,
  handleApiRequest,
  readLanguages,
  readPortrait,
  readArtwork,
  SERVER_KEY_SETUP,
  toResponse,
  mintToken,
  type FetchLike,
  type ServerEnv,
} from './handler';

const KEY = 'test-key-1234';

function answer(status: number, body: unknown): FetchLike {
  return vi.fn<FetchLike>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

describe('mintToken', () => {
  it("posts the key in Convai's header with a JSON body and returns the minted token", async () => {
    const fetchFn = answer(200, { apiAuthToken: 'tok-1' });

    await expect(mintToken(KEY, fetchFn, DEV_KEY_SETUP)).resolves.toEqual({ token: 'tok-1' });
    // Convai refuses a mint without a JSON content type (400, "415 Unsupported Media Type").
    expect(fetchFn).toHaveBeenCalledWith(CONVAI_CONNECT_URL, {
      method: 'POST',
      headers: { 'CONVAI-API-KEY': KEY, 'Content-Type': 'application/json' },
      body: '{}',
    });
  });

  it("reads Convai's zoneless expiration time as UTC", async () => {
    const fetchFn = answer(200, {
      apiAuthToken: 'tok-1',
      expirationTime: '2026-10-22T21:29:42.674289',
    });

    await expect(mintToken(KEY, fetchFn, DEV_KEY_SETUP)).resolves.toEqual({
      token: 'tok-1',
      expiresAt: Date.UTC(2026, 9, 22, 21, 29, 42, 674),
    });
  });

  it('keeps an expiration time that names its zone', async () => {
    const fetchFn = answer(200, {
      apiAuthToken: 'tok-1',
      expirationTime: '2026-10-22T23:00:00+02:00',
    });

    await expect(mintToken(KEY, fetchFn, DEV_KEY_SETUP)).resolves.toEqual({
      token: 'tok-1',
      expiresAt: Date.UTC(2026, 9, 22, 21, 0, 0),
    });
  });

  it('leaves out an expiration time it cannot read', async () => {
    const fetchFn = answer(200, { apiAuthToken: 'tok-1', expirationTime: 'soon' });

    await expect(mintToken(KEY, fetchFn, DEV_KEY_SETUP)).resolves.toEqual({ token: 'tok-1' });
  });

  it('refuses without a key and calls nobody', async () => {
    const fetchFn = answer(200, { apiAuthToken: 'tok-1' });

    await expect(mintToken('', fetchFn, DEV_KEY_SETUP)).rejects.toEqual(
      new ApiError(500, 'CONVAI_API_KEY is not set. Add it to .env.local and restart pnpm dev.'),
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("names Convai's status and passes on neither its body nor the key", async () => {
    const error = await mintToken(
      KEY,
      answer(401, { message: 'secret detail' }),
      DEV_KEY_SETUP,
    ).catch((e: unknown) => e);

    expect(error).toEqual(
      new ApiError(
        502,
        'Convai refused the token request (HTTP 401). Check CONVAI_API_KEY in .env.local.',
      ),
    );
    expect(String(error)).not.toContain(KEY);
    expect(String(error)).not.toContain('secret detail');
  });

  it('refuses an answer without a token', async () => {
    await expect(
      mintToken(KEY, answer(200, { token: 'wrong-field' }), DEV_KEY_SETUP),
    ).rejects.toThrow('Convai answered the token request without a token.');
  });

  it('reports Convai as unreachable', async () => {
    await expect(
      mintToken(KEY, () => Promise.reject(new TypeError('fetch failed')), DEV_KEY_SETUP),
    ).rejects.toThrow('Could not reach Convai to get a token.');
  });
});

describe('endUserId', () => {
  it('uses CONVAI_END_USER_ID when it is set', () => {
    expect(endUserId({ CONVAI_END_USER_ID: ' example-user ' })).toBe('example-user');
  });

  it.each([undefined, '', '  '])('falls back to the one fixed id for %j', (raw) => {
    expect(endUserId({ CONVAI_END_USER_ID: raw })).toBe(DEFAULT_END_USER_ID);
  });
});

describe('readLanguages', () => {
  it.each([
    [
      ['en-US', 'es', 'tr-TR'],
      ['en-US', 'es', 'tr-TR'],
    ],
    [['en-US', 'en-US'], ['en-US']],
    [['en-US', 3, '', 'not a code', '<b>'], ['en-US']],
    ['en-US', []],
    [undefined, []],
  ])('reads %j as %j', (raw, codes) => {
    expect(readLanguages(raw)).toEqual(codes);
  });
});

describe('readPortrait', () => {
  const square = 'https://storage.googleapis.com/a/x_avatar_image_square?img_last_modified=1';
  const full = 'https://storage.googleapis.com/a/x_avatar_image.png?img_last_modified=1';

  it('takes the square MetaHuman image first, as the SDK does', () => {
    expect(readPortrait({ METAHUMAN: { avatar_image_square: square, avatar_image: full } })).toBe(
      square,
    );
  });

  it('takes the full image when there is no square one', () => {
    expect(readPortrait({ METAHUMAN: { avatar_image_square: '', avatar_image: full } })).toBe(full);
  });

  it.each([
    ['no details', null],
    ['no MetaHuman', { modelPlaceholder: 'https://models.readyplayer.me/x.png' }],
    ['an address that is not https', { METAHUMAN: { avatar_image: 'http://x/y.png' } }],
    ['a script address', { METAHUMAN: { avatar_image_square: 'javascript:alert(1)' } }],
    ['no text', { METAHUMAN: { avatar_image_square: 7 } }],
  ])('gives none for %s', (_case, details) => {
    expect(readPortrait(details)).toBeNull();
  });
});

describe('readArtwork', () => {
  it('keeps the independent full artwork and background without forwarding other metadata', () => {
    expect(
      readArtwork({
        METAHUMAN: {
          avatar_image: 'https://images.test/full.png',
          bg_image: 'https://images.test/bg.png',
          experience_id: 'private',
        },
      }),
    ).toEqual({
      portraitFull: 'https://images.test/full.png',
      background: 'https://images.test/bg.png',
    });
  });
  it.each([
    null,
    {},
    { METAHUMAN: 'invalid' },
    { METAHUMAN: { avatar_image: 'NULL', bg_image: 'http://images.test/bg.png' } },
  ])('omits unavailable artwork', (details) => {
    expect(readArtwork(details)).toEqual({});
  });
});

describe('handleApiRequest', () => {
  const env = { CONVAI_API_KEY: KEY };
  const handle = (method: string, path: string, serverEnv: ServerEnv, fetchFn: FetchLike) =>
    handleApiRequest(method, path, serverEnv, fetchFn, DEV_KEY_SETUP);

  it("tells a hosted server's owner to set the key in the server's environment", async () => {
    const fetchFn = answer(401, {});

    await expect(
      handleApiRequest('GET', '/api/token', {}, fetchFn, SERVER_KEY_SETUP),
    ).resolves.toEqual({
      status: 500,
      body: {
        error:
          "CONVAI_API_KEY is not set. Set it in the server's environment and restart the server.",
      },
    });
    await expect(
      handleApiRequest('GET', '/api/token', env, fetchFn, SERVER_KEY_SETUP),
    ).resolves.toEqual({
      status: 502,
      body: {
        error:
          "Convai refused the token request (HTTP 401). Check CONVAI_API_KEY in the server's environment.",
      },
    });
  });

  it('answers /api/token with a minted token and the end user', async () => {
    await expect(
      handle('GET', '/api/token', env, answer(200, { apiAuthToken: 'tok-1' })),
    ).resolves.toEqual({ status: 200, body: { token: 'tok-1', endUserId: DEFAULT_END_USER_ID } });
  });

  it('does not call Convai when no API key is configured', async () => {
    const fetchFn = answer(200, {});

    await expect(handle('GET', '/api/characters', {}, fetchFn)).resolves.toEqual({
      status: 500,
      body: { error: 'CONVAI_API_KEY is not set. Add it to .env.local and restart pnpm dev.' },
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('turns a missing key into a 500 with a message and no key', async () => {
    await expect(handle('GET', '/api/token', {}, answer(200, {}))).resolves.toEqual({
      status: 500,
      body: { error: 'CONVAI_API_KEY is not set. Add it to .env.local and restart pnpm dev.' },
    });
  });

  it('refuses methods other than GET', async () => {
    await expect(handle('POST', '/api/token', env, answer(200, {}))).resolves.toEqual({
      status: 405,
      body: { error: 'Use GET for /api/token.' },
    });
  });

  it('leaves every other path to the next handler', async () => {
    await expect(handle('GET', '/api/tokens', env, answer(200, {}))).resolves.toBe(undefined);
  });

  it('treats an unreadable answer as one without a token', async () => {
    const fetchFn: FetchLike = () =>
      Promise.resolve({ ok: true, json: () => Promise.reject(new Error(KEY)) } as Response);

    await expect(handle('GET', '/api/token', env, fetchFn)).resolves.toEqual({
      status: 502,
      body: { error: 'Convai answered the token request without a token.' },
    });
  });
});

describe('toResponse', () => {
  it('answers JSON that no cache keeps', async () => {
    const response = toResponse({ status: 502, body: { error: 'No.' } });

    expect(response.status).toBe(502);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ error: 'No.' });
  });
});

describe('hosted account character discovery', () => {
  const handle = (method: string, path: string, env: ServerEnv, fetchFn: FetchLike) =>
    handleApiRequest(method, path, env, fetchFn, DEV_KEY_SETUP);
  it('uses only the API key and exposes only picker metadata', async () => {
    const fetchFn = answer(200, {
      characters: [
        {
          character_id: 'owned',
          character_name: 'My character',
          language_codes: ['en-US'],
          backstory: 'private prompt',
          user_id: 'private account',
          model_details: {
            METAHUMAN: {
              avatar_image_square: 'https://images.test/square.png',
              avatar_image: 'https://images.test/full.png',
              bg_image: 'https://images.test/bg.png',
            },
          },
        },
      ],
    });
    const result = await handle('GET', '/api/characters', { CONVAI_API_KEY: KEY }, fetchFn);
    expect(result).toEqual({
      status: 200,
      body: {
        characters: [
          {
            id: 'owned',
            name: 'My character',
            languages: ['en-US'],
            portrait: 'https://images.test/square.png',
            portraitFull: 'https://images.test/full.png',
            background: 'https://images.test/bg.png',
          },
        ],
      },
    });
    expect(fetchFn).toHaveBeenCalledWith('https://api.convai.com/character/list', {
      method: 'POST',
      headers: { 'CONVAI-API-KEY': KEY },
    });
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('reports access errors instead of pretending the account has no characters', async () => {
    const result = await handle(
      'GET',
      '/api/characters',
      { CONVAI_API_KEY: KEY },
      answer(401, { secret: KEY }),
    );
    expect(result?.status).toBe(502);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
  it('allows an empty account and rejects malformed responses', async () => {
    await expect(
      handle('GET', '/api/characters', { CONVAI_API_KEY: KEY }, answer(200, { characters: [] })),
    ).resolves.toEqual({ status: 200, body: { characters: [] } });
    expect(
      (await handle('GET', '/api/characters', { CONVAI_API_KEY: KEY }, answer(200, {})))?.status,
    ).toBe(502);
  });
});
