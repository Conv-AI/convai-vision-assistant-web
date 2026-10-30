import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import {
  SERVER_KEY_SETUP,
  handleApiRequest,
  notFound,
  sendAnswer,
  type FetchLike,
  type ServerEnv,
} from './handler.ts';

/**
 * The production server of `pnpm start` and the Docker image: the built app from `dist/` and the
 * `/api` routes through the shared handler, with nothing but Node.
 */

/** The types of the files a build holds; any other file is sent as bytes. */
export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
};

/** Vite names every file under `assets/` by a hash of its content, so a browser may keep it. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** Everything else, `index.html` first, is asked again each time so a new build shows at once. */
const REVALIDATE = 'no-cache';

export interface AppServerOptions {
  /** The folder of the built app, `dist/`. */
  root: string;
  env: ServerEnv;
  fetchFn: FetchLike;
}

/**
 * The file a request path names inside `root`, or `undefined` when it names none there: a path
 * that cannot be decoded, holds a backslash or a NUL, or climbs out of `root`.
 */
export function fileInRoot(root: string, path: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  if (decoded.includes('\\') || decoded.includes('\0')) return undefined;
  const base = resolve(root);
  const file = resolve(join(base, decoded));
  return file.startsWith(base + sep) ? file : undefined;
}

/** The size of `file` when it is a file, else `undefined`. */
async function fileSize(file: string): Promise<number | undefined> {
  try {
    const stats = await stat(file);
    return stats.isFile() ? stats.size : undefined;
  } catch {
    return undefined;
  }
}

function sendText(res: ServerResponse, status: number, text: string, headers = {}): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(text);
}

async function serveFile(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  path: string,
): Promise<void> {
  const named = fileInRoot(root, path === '/' ? '/index.html' : path);
  let file = named;
  let size = named === undefined ? undefined : await fileSize(named);
  // The app is one page: a path without an extension that names no file gets the page. A missing
  // asset gets a 404, never the page, so a stale script is not run as HTML.
  if (size === undefined && named !== undefined && extname(path) === '') {
    file = join(resolve(root), 'index.html');
    size = await fileSize(file);
  }
  if (file === undefined || size === undefined) {
    sendText(res, 404, 'Not found.');
    return;
  }

  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': size,
    'Cache-Control': path.startsWith('/assets/') ? IMMUTABLE : REVALIDATE,
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
}

async function answer(
  req: IncomingMessage,
  res: ServerResponse,
  options: AppServerOptions,
): Promise<void> {
  const path = (req.url ?? '/').split('?')[0] ?? '/';

  if (path === '/api' || path.startsWith('/api/')) {
    const reply = await handleApiRequest(
      req.method,
      path,
      options.env,
      options.fetchFn,
      SERVER_KEY_SETUP,
    );
    sendAnswer(res, reply ?? notFound(path));
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Use GET.', { Allow: 'GET, HEAD' });
    return;
  }
  await serveFile(req, res, options.root, path);
}

/** A server for the built app and its `/api` routes; the caller listens. */
export function createAppServer(options: AppServerOptions): Server {
  return createServer((req, res) => {
    answer(req, res, options).catch(() => {
      if (res.headersSent) res.destroy();
      else sendText(res, 500, 'The app server failed to answer.');
    });
  });
}
