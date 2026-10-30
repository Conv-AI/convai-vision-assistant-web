import type { SessionState } from '../session/session';
import { lastTurn, type Turn } from '../session/turns';

export type TipSignal =
  /** The person talked: a push-to-talk hold let go, or a spoken question (hands free). */
  | 'talked'
  /** A typed question the service took. */
  | 'typed'
  /** The character began to speak an answer to a question (a greeting is no answer). */
  | 'speech-started'
  /** The answer came to its end, or was stopped. */
  | 'answer-ended'
  /** The person stopped an answer: Esc, a click on the Lens, or talking or typing over it. */
  | 'stopped';

/**
 * The answers that ended before the tips could watch (they load while the character connects): every
 * asked turn that is done or stopped, but one still being spoken.
 */
export function earlierAnswers(state: SessionState): Turn[] {
  const speaking = state.talk === 'speaking' ? lastTurn(state.items) : undefined;
  return state.items.filter(
    (item): item is Turn =>
      item.kind === 'turn' &&
      item !== speaking &&
      item.question !== '' &&
      (item.status === 'done' || item.status === 'stopped'),
  );
}

export function tipSignals(before: SessionState, after: SessionState): TipSignal[] {
  const signals: TipSignal[] = [];
  const was = lastTurn(before.items);
  const turn = lastTurn(after.items);
  // A typed question gives a short `listening` blip of its own, so talking is never read from it.
  if (after.talks > before.talks) signals.push('talked');
  if (turn && turn.id !== was?.id && turn.question !== '') {
    if (turn.input === 'typed') signals.push('typed');
    // A push-to-talk turn was already counted when the key was let go; hands free has no key.
    else if (after.talkMode === 'hands-free') signals.push('talked');
  }
  const answers = turn !== undefined && turn.question !== '';
  if (answers && after.talk === 'speaking' && before.talk !== 'speaking')
    signals.push('speech-started');
  // Read from the session's count: a stopped answer whose words had all come stays `done`.
  if (after.stops > before.stops) signals.push('stopped');
  if (answers && before.talk === 'speaking' && after.talk !== 'speaking')
    signals.push('answer-ended');
  return signals;
}
