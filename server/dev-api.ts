import { loadEnv, type Plugin } from 'vite';
import {
  DEV_KEY_SETUP,
  handleApiRequest,
  sendAnswer,
  type FetchLike,
  type ServerEnv,
} from './handler.ts';

/** Serves the `/api` routes from the dev server. `vite preview` does not include them. */
export function devApi(): Plugin {
  return {
    name: 'convai-dev-api',
    apply: 'serve',
    configureServer(server) {
      // An empty prefix reads variables without VITE_; they stay in this process.
      const env: ServerEnv = loadEnv(server.config.mode, process.cwd(), '');
      const fetchFn: FetchLike = (input, init) => fetch(input, init);

      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        handleApiRequest(req.method, path, env, fetchFn, DEV_KEY_SETUP).then(
          (answer) => {
            if (answer) sendAnswer(res, answer);
            else next();
          },
          (error: unknown) => {
            next(error);
          },
        );
      });
    },
  };
}
