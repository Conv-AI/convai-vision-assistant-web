/** A request to the app's own `/api` routes failed; `message` is safe to show the user. */
export class CredentialsError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'CredentialsError';
    this.status = status;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// Wrapped rather than passed as `fetch` itself: a detached `window.fetch` throws "Illegal invocation".
export const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * GETs one of the app's `/api` routes and returns its JSON body. A non-OK answer becomes a
 * `CredentialsError` carrying the route's own `error` message when it sent one.
 */
export async function getJson(
  path: string,
  fetchFn: FetchLike,
  signal: AbortSignal = AbortSignal.timeout(10_000),
): Promise<unknown> {
  let response: Response;
  let body: unknown;
  try {
    response = await fetchFn(path, { headers: { Accept: 'application/json' }, signal });
    body = await response.json().catch((error: unknown) => {
      if (signal.aborted) throw error;
      return undefined;
    });
  } catch {
    if (signal.aborted)
      throw new CredentialsError('The app server took too long to answer. Try again.');
    throw new CredentialsError('Could not reach the app server. Check that it is running.');
  }

  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error === 'string'
        ? body.error
        : `The app server answered ${String(response.status)} for ${path}.`;
    throw new CredentialsError(message, response.status);
  }
  return body;
}
