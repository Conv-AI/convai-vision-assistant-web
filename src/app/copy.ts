import type { Overlay, SessionState } from '../session/session';
import type { Turn } from '../session/turns';

/** The app's copy that depends on state: one place, so every line has a unit test. */

const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function turnMeta(turn: Turn): string {
  const how = turn.seen ?? (turn.input === 'typed' ? 'Typed' : 'Spoken');
  return `${how} · ${time.format(turn.at)}`;
}

export function launchCopy(
  overlay: Overlay,
  name: string,
  state: Pick<SessionState, 'failure' | 'failureMessage'>,
): { kicker?: string; title?: string; body?: string; action?: string } {
  switch (overlay) {
    case 'boot':
      return {};
    case 'connecting':
      return { title: `Connecting to ${name}…` };
    case 'switching':
      return { kicker: 'Waking up', title: name };
    case 'failed':
      if (state.failureMessage)
        return {
          title: 'Couldn’t start the conversation',
          body: state.failureMessage,
          action: 'Try again',
        };
      return state.failure === 'service'
        ? {
            title: `${name} is unavailable right now`,
            body: 'Try again in a moment.',
            action: 'Try again',
          }
        : {
            title: 'Couldn’t connect',
            body: 'Check your internet connection, then try again.',
            action: 'Try again',
          };
  }
}
