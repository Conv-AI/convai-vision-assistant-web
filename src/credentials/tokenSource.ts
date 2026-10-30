import { CredentialsError, defaultFetch, getJson, isRecord, type FetchLike } from './api';

/** A short-lived Convai token, passed to the SDK as `authToken`. */
export interface AuthToken {
  token: string;
  /** When the token stops working, in milliseconds since the epoch, if the server knows. */
  expiresAt?: number;
  /** Who the session speaks as, for the character's memory; the server chooses it. */
  endUserId?: string;
}

/**
 * Where the app gets its Convai token. The server mints a token using its configured API key.
 * The API key is never sent to the browser.
 */
export interface TokenSource {
  getToken(): Promise<AuthToken>;
}

/** A `TokenSource` that asks the app's server, `GET /api/token`, for a fresh token on each call. */
export function createHttpTokenSource(fetchFn: FetchLike = defaultFetch): TokenSource {
  return {
    async getToken() {
      const body = await getJson('/api/token', fetchFn);
      if (!isRecord(body) || typeof body.token !== 'string' || body.token === '') {
        throw new CredentialsError('The app server answered without a token.');
      }
      const token: AuthToken = { token: body.token };
      if (typeof body.expiresAt === 'number') token.expiresAt = body.expiresAt;
      if (typeof body.endUserId === 'string' && body.endUserId !== '')
        token.endUserId = body.endUserId;
      return token;
    },
  };
}
