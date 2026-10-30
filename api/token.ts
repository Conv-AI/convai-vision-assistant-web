import { SERVER_KEY_SETUP, answerRequest, type FetchLike } from '../server/handler.js';

// `GET /api/token` as a Vercel function, through the handler that `pnpm dev` and `pnpm start` share.

const fetchFn: FetchLike = (input, init) => fetch(input, init);

export default {
  fetch(request: Request): Promise<Response> {
    return answerRequest(request, process.env, fetchFn, SERVER_KEY_SETUP);
  },
};
