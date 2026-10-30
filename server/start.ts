import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type FetchLike, type ServerEnv } from './handler.ts';
import { createAppServer } from './http.ts';

// Serve the production build and server API using runtime environment configuration.

const root = fileURLToPath(new URL('../dist/', import.meta.url));
if (!existsSync(`${root}index.html`)) {
  console.error('The built app was not found in dist/. Run pnpm build first.');
  process.exit(1);
}

const portText = process.env.PORT ?? '3000';
const port = Number(portText);
if (!/^\d+$/.test(portText) || port > 65535) {
  console.error(`PORT must be a port number from 0 to 65535; it is "${portText}".`);
  process.exit(1);
}

const env: ServerEnv = {
  CONVAI_API_KEY: process.env.CONVAI_API_KEY,
  CONVAI_END_USER_ID: process.env.CONVAI_END_USER_ID,
};
if (!env.CONVAI_API_KEY) {
  console.warn('CONVAI_API_KEY is not set: the app cannot connect. Set it and restart the server.');
}

const fetchFn: FetchLike = (input, init) => fetch(input, init);
const server = createAppServer({ root, env, fetchFn });
server.listen(port, () => {
  const address = server.address();
  const listening = typeof address === 'object' && address !== null ? address.port : port;
  console.log(`Vision Assistant is served at http://localhost:${String(listening)}/`);
});

// A container stops its server with SIGTERM; Node, as the container's first process, would
// otherwise ignore it until the runtime kills it.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
