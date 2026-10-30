import { describe, expect, it, vi } from 'vitest';
import { CredentialsError, getJson, type FetchLike } from './api';
import { getCharacters } from './characters';
import { createHttpTokenSource } from './tokenSource';

function answer(status: number, body: unknown): FetchLike {
  return vi.fn<FetchLike>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

describe('request cancellation', () => {
  it('reports a cancelled request without forwarding a raw fetch error', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn: FetchLike = () => Promise.reject(new Error('private upstream details'));
    await expect(getJson('/api/token', fetchFn, controller.signal)).rejects.toThrow(
      'The app server took too long to answer. Try again.',
    );
  });

  it('reports cancellation while reading the body instead of a malformed token', async () => {
    const controller = new AbortController();
    const fetchFn: FetchLike = () =>
      Promise.resolve({
        ok: true,
        json: () => {
          controller.abort();
          return Promise.reject(new Error('private upstream details'));
        },
      } as Response);
    await expect(getJson('/api/token', fetchFn, controller.signal)).rejects.toThrow(
      'took too long',
    );
  });
});

describe('createHttpTokenSource', () => {
  it('asks /api/token and returns the token', async () => {
    const fetchFn = answer(200, { token: 'tok-1' });

    await expect(createHttpTokenSource(fetchFn).getToken()).resolves.toEqual({ token: 'tok-1' });
    expect(fetchFn).toHaveBeenCalledWith('/api/token', expect.anything());
  });

  it('passes on an expiry the server sends', async () => {
    const source = createHttpTokenSource(answer(200, { token: 'tok-1', expiresAt: 1_700_000 }));

    await expect(source.getToken()).resolves.toEqual({ token: 'tok-1', expiresAt: 1_700_000 });
  });

  it('passes on the end user the server chose', async () => {
    const source = createHttpTokenSource(answer(200, { token: 'tok-1', endUserId: 'dev-user' }));

    await expect(source.getToken()).resolves.toEqual({ token: 'tok-1', endUserId: 'dev-user' });
  });

  it("shows the server's own message when it refuses", async () => {
    const source = createHttpTokenSource(answer(500, { error: 'No key is configured.' }));

    await expect(source.getToken()).rejects.toEqual(
      new CredentialsError('No key is configured.', 500),
    );
  });

  it('names the status when a refusal has no message', async () => {
    const source = createHttpTokenSource(answer(404, 'not json'));

    await expect(source.getToken()).rejects.toThrow('The app server answered 404 for /api/token.');
  });

  it('rejects an answer without a token', async () => {
    const source = createHttpTokenSource(answer(200, { token: '' }));

    await expect(source.getToken()).rejects.toThrow('The app server answered without a token.');
  });

  it('reports an unreachable server', async () => {
    const source = createHttpTokenSource(() => Promise.reject(new TypeError('Failed to fetch')));

    await expect(source.getToken()).rejects.toThrow('Could not reach the app server.');
  });
});

describe('getCharacters', () => {
  it('keeps valid optional artwork and ignores malformed assets without losing a character', async () => {
    const characters = [
      {
        id: 'a',
        name: 'Kira',
        portraitFull: 'https://images.test/full.png',
        background: 'https://images.test/bg.png',
      },
      { id: 'b', name: 'Elena', portraitFull: 'http://images.test/full.png', background: 42 },
    ];
    await expect(getCharacters(answer(200, { characters }))).resolves.toEqual([
      { ...characters[0], languages: [], portrait: null },
      { id: 'b', name: 'Elena', languages: [], portrait: null },
    ]);
  });
  it('asks /api/characters and returns each character with its name and languages', async () => {
    const characters = [
      { id: 'a', name: 'Kira', languages: ['en-US', 'tr-TR'], portrait: 'https://cdn.example/k' },
      { id: 'b', name: null, languages: [], portrait: null },
    ];
    const fetchFn = answer(200, { characters });

    await expect(getCharacters(fetchFn)).resolves.toEqual(characters);
    expect(fetchFn).toHaveBeenCalledWith('/api/characters', expect.anything());
  });

  it('gives no languages when the server sends none', async () => {
    await expect(
      getCharacters(answer(200, { characters: [{ id: 'a', name: 'Kira' }] })),
    ).resolves.toEqual([{ id: 'a', name: 'Kira', languages: [], portrait: null }]);
  });

  it('returns an empty list as it is', async () => {
    await expect(getCharacters(answer(200, { characters: [] }))).resolves.toEqual([]);
  });

  it.each([
    ['no list', {}],
    ['an id that is not text', { characters: [{ id: 2, name: 'Kira' }] }],
    ['an empty id', { characters: [{ id: '', name: 'Kira' }] }],
    ['a name that is not text', { characters: [{ id: 'a', name: 3 }] }],
    ['languages that are not a list', { characters: [{ id: 'a', name: 'Kira', languages: 'en' }] }],
    ['a language that is not text', { characters: [{ id: 'a', name: 'Kira', languages: [1] }] }],
    [
      'a portrait that is not https',
      { characters: [{ id: 'a', name: 'K', portrait: 'http://x' }] },
    ],
  ])('rejects %s', async (_case, body) => {
    await expect(getCharacters(answer(200, body))).rejects.toThrow(
      'The app server answered without a list of characters.',
    );
  });

  it("shows the server's own message when it refuses", async () => {
    await expect(getCharacters(answer(500, { error: 'No characters.' }))).rejects.toThrow(
      'No characters.',
    );
  });
});
