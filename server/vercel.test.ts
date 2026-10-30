// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import characters from '../api/characters';
import token from '../api/token';

describe('the Vercel functions', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("answer /api/token without a key with the safe error for a server's owner", async () => {
    vi.stubEnv('CONVAI_API_KEY', '');
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);

    const response = await token.fetch(new Request('https://example.test/api/token'));

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      error:
        "CONVAI_API_KEY is not set. Set it in the server's environment and restart the server.",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('mint a token with the key from the environment', async () => {
    vi.stubEnv('CONVAI_API_KEY', 'test-key-1234');
    vi.stubEnv('CONVAI_END_USER_ID', 'reader');
    const fetchFn = vi.fn(() => Promise.resolve(Response.json({ apiAuthToken: 'tok-1' })));
    vi.stubGlobal('fetch', fetchFn);

    const response = await token.fetch(new Request('https://example.test/api/token'));

    await expect(response.json()).resolves.toEqual({ token: 'tok-1', endUserId: 'reader' });
    expect(fetchFn).toHaveBeenCalledWith('https://api.convai.com/user/connect', {
      method: 'POST',
      headers: { 'CONVAI-API-KEY': 'test-key-1234', 'Content-Type': 'application/json' },
      body: '{}',
    });
  });

  it('list the account characters using the environment API key', async () => {
    vi.stubEnv('CONVAI_API_KEY', 'test-key-1234');
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json({ characters: [{ character_id: 'a', character_name: 'Kira' }] }),
        ),
      ),
    );

    const response = await characters.fetch(new Request('https://example.test/api/characters'));

    await expect(response.json()).resolves.toEqual({
      characters: [{ id: 'a', name: 'Kira', languages: [], portrait: null }],
    });
  });

  it('refuse other methods', async () => {
    const response = await token.fetch(
      new Request('https://example.test/api/token', { method: 'POST' }),
    );

    expect(response.status).toBe(405);
  });

  it('load a handler with no runtime import of another local file', () => {
    // Node runs the handler as `.ts` and Vercel compiles it: a relative runtime import resolves in
    // only one of them, and the functions then fail with FUNCTION_INVOCATION_FAILED.
    const source = readFileSync(new URL('./handler.ts', import.meta.url), 'utf8');
    const runtimeLocal = /^import (?!type\s)[^;]*from '\.{1,2}\//m;

    expect(runtimeLocal.test(source)).toBe(false);
  });
});
