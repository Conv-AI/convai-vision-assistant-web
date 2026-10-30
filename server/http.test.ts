// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FetchLike } from './handler';
import { createAppServer, fileInRoot } from './http';

const KEY = 'test-key-1234';
const PAGE = '<!doctype html><title>Vision Assistant</title>';
const SCRIPT = 'console.log("app");';

// A built app in a folder of its own, with a secret beside it as .env.local sits beside dist/.
let folder: string;
let root: string;

function listen(server: Server): Promise<string> {
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      done(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((done) =>
    server.close(() => {
      done();
    }),
  );
}

beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), 'va-server-'));
  root = join(folder, 'dist');
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), PAGE);
  writeFileSync(join(root, 'gallery.html'), '<!doctype html><title>Gallery</title>');
  writeFileSync(join(root, 'assets', 'index-AbC123.js'), SCRIPT);
  writeFileSync(join(root, 'assets', 'inter-latin-AbC123.woff2'), 'font');
  writeFileSync(join(root, 'favicon.svg'), '<svg/>');
  writeFileSync(join(folder, '.env.local'), `CONVAI_API_KEY=${KEY}`);
});

afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('the app server', () => {
  let server: Server;
  let base: string;
  const fetchFn = vi.fn<FetchLike>(() =>
    Promise.resolve(new Response(JSON.stringify({ apiAuthToken: 'tok-1' }))),
  );

  beforeAll(async () => {
    server = createAppServer({ root, env: {}, fetchFn });
    base = await listen(server);
  });

  afterAll(() => close(server));

  it('answers / with the page, asked again each time', async () => {
    const response = await fetch(`${base}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    await expect(response.text()).resolves.toBe(PAGE);
  });

  it('answers a path without an extension with the page', async () => {
    const response = await fetch(`${base}/settings`);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(PAGE);
  });

  it('serves another page of the build as itself', async () => {
    const response = await fetch(`${base}/gallery.html`);

    await expect(response.text()).resolves.toContain('Gallery');
  });

  it('serves a hashed asset with its type, its length and a cache that keeps it', async () => {
    const response = await fetch(`${base}/assets/index-AbC123.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8');
    expect(response.headers.get('Content-Length')).toBe(String(SCRIPT.length));
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    await expect(response.text()).resolves.toBe(SCRIPT);
  });

  it.each([
    ['/assets/inter-latin-AbC123.woff2', 'font/woff2'],
    ['/favicon.svg', 'image/svg+xml'],
  ])('serves %s as %s', async (path, type) => {
    const response = await fetch(`${base}${path}`);

    expect(response.headers.get('Content-Type')).toBe(type);
  });

  it('answers HEAD with the headers and no body', async () => {
    const response = await fetch(`${base}/assets/index-AbC123.js`, { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe(String(SCRIPT.length));
    await expect(response.text()).resolves.toBe('');
  });

  it('answers a missing asset with a 404, never the page', async () => {
    const response = await fetch(`${base}/assets/index-Old999.js`);

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.not.toContain('<!doctype');
  });

  it.each([
    '/../.env.local',
    '/%2e%2e/.env.local',
    '/assets/..%2f..%2f.env.local',
    '/..%5c.env.local',
  ])('never serves a file outside the build for %s', async (path) => {
    // fetch() folds a plain "/../" itself, so the path is sent as written.
    const response = await rawGet(base, path);

    expect(response.status).toBe(404);
    expect(response.body).not.toContain(KEY);
  });

  it("answers /api/token without a key with the safe error for a server's owner", async () => {
    const response = await fetch(`${base}/api/token`);

    expect(response.status).toBe(500);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      error:
        "CONVAI_API_KEY is not set. Set it in the server's environment and restart the server.",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('answers an /api path that is no route with a JSON 404, never the page', async () => {
    const response = await fetch(`${base}/api/tokens`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'There is no route /api/tokens.' });
  });

  it('refuses to write anywhere but /api', async () => {
    const response = await fetch(`${base}/`, { method: 'POST' });

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
  });
});

describe('the app server with a key', () => {
  it('mints a token through the handler', async () => {
    const fetchFn = vi.fn<FetchLike>(() =>
      Promise.resolve(new Response(JSON.stringify({ apiAuthToken: 'tok-1' }))),
    );
    const server = createAppServer({ root, env: { CONVAI_API_KEY: KEY }, fetchFn });
    const base = await listen(server);
    try {
      const response = await fetch(`${base}/api/token`);

      await expect(response.json()).resolves.toEqual({
        token: 'tok-1',
        endUserId: 'vision-assistant-web-dev',
      });
    } finally {
      await close(server);
    }
  });
});

describe('fileInRoot', () => {
  it('names a file inside the root', () => {
    expect(fileInRoot('/srv/dist', '/assets/a.js')).toBe(resolve('/srv/dist', 'assets', 'a.js'));
  });

  it.each(['/..', '/../dist-other/a.js', '/%2e%2e/x', '/a%00.js', '/a\\b.js', '/%E0%A4%A'])(
    'names nothing for %s',
    (path) => {
      expect(fileInRoot('/srv/dist', path)).toBeUndefined();
    },
  );
});

/** A GET whose path reaches the server exactly as written. */
async function rawGet(base: string, path: string): Promise<{ status: number; body: string }> {
  const url = new URL(base);
  return new Promise((done, fail) => {
    const req = request({ host: url.hostname, port: url.port, path, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => {
        done({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', fail);
    req.end();
  });
}
