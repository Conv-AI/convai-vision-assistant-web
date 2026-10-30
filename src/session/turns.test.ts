import { describe, expect, it } from 'vitest';
import {
  ask,
  fail,
  isEcho,
  lastTurn,
  reply,
  restarted,
  retry,
  settle,
  stop,
  type TranscriptItem,
  type Turn,
  withPicture,
} from './turns';

const at = 1_000;

function asked(question = 'What is this?'): TranscriptItem[] {
  return ask([], 1, question, 'typed', at);
}

function only(items: readonly TranscriptItem[]): Turn {
  const turn = lastTurn(items);
  if (!turn) throw new Error('no turn');
  return turn;
}

describe('the transcript', () => {
  it('starts a turn that waits for its reply', () => {
    expect(asked()).toEqual([
      {
        kind: 'turn',
        id: 1,
        question: 'What is this?',
        input: 'typed',
        at,
        reply: '',
        replyId: null,
        status: 'waiting',
      },
    ]);
  });

  it('joins speech heard in parts into the spoken turn still waiting', () => {
    const parts = ask(ask([], 1, 'Hello.', 'voice', at), 2, 'What is your name?', 'voice', at + 1);
    expect(parts).toHaveLength(1);
    expect(only(parts)).toMatchObject({ id: 1, question: 'Hello. What is your name?', at });
    // Not a typed question, and not once words came back.
    expect(ask(asked('Typed'), 2, 'Spoken', 'voice', at)).toHaveLength(2);
    expect(ask(parts, 3, 'More?', 'typed', at)).toHaveLength(2);
    const answered = reply(parts, 4, 'r1', 'I am Kira.', true, at);
    expect(ask(answered, 5, 'And you?', 'voice', at)).toHaveLength(2);
  });

  it('grows the waiting turn with its reply, then finishes it', () => {
    let items = reply(asked(), 2, 'r1', '', true, at);
    items = reply(items, 3, 'r1', 'The capital', true, at);
    expect(only(items)).toMatchObject({ reply: 'The capital', replyId: 'r1', status: 'streaming' });

    items = reply(items, 4, 'r1', 'The capital of France is Paris.', false, at);
    expect(items).toHaveLength(1);
    expect(only(items)).toMatchObject({
      reply: 'The capital of France is Paris.',
      status: 'done',
    });
  });

  it('lets a reply that ended without words leave the question waiting for the real one', () => {
    // As 2.0.1 does with video on (recorded 23 October 2026): an empty run starts and ends, then the
    // answer streams under a new id.
    let items = reply(asked(), 2, 'started-1', '', true, at);
    items = reply(items, 3, 'started-1', '', false, at);
    expect(only(items)).toMatchObject({ status: 'waiting', reply: '' });

    items = reply(items, 4, 'started-2', '', true, at);
    items = reply(items, 5, 'started-2', 'I see a blue screen', true, at);
    items = reply(items, 6, 'started-2', 'I see a blue screen with GIRAFFE on it.', false, at);
    expect(items).toHaveLength(1);
    expect(only(items)).toMatchObject({
      question: 'What is this?',
      reply: 'I see a blue screen with GIRAFFE on it.',
      replyId: 'started-2',
      status: 'done',
    });
  });

  it('gives a reply to the turn that holds its id, not to a newer one', () => {
    let items = reply(asked('First'), 2, 'r1', 'One', true, at);
    items = ask(items, 3, 'Second', 'typed', at);
    items = reply(items, 4, 'r1', 'One more', false, at);

    expect(items.map((item) => item.kind === 'turn' && item.reply)).toEqual(['One more', '']);
  });

  it('starts a turn of its own for a reply nobody asked for', () => {
    const items = reply([], 7, 'g1', 'Hi, I am Kira.', false, at);

    expect(only(items)).toMatchObject({ id: 7, question: '', reply: 'Hi, I am Kira.' });
  });

  it('waits for words before starting a turn for an unasked reply', () => {
    expect(reply([], 7, 'g1', '', true, at)).toEqual([]);
  });

  it('freezes a stopped reply, even when more text arrives', () => {
    let items = reply(asked(), 2, 'r1', 'Arthur had tended', true, at);
    items = stop(items);
    items = reply(items, 3, 'r1', 'Arthur had tended the lantern for forty years.', false, at);

    expect(only(items)).toMatchObject({ reply: 'Arthur had tended', status: 'stopped' });
  });

  it('stops a turn that is still waiting, with no text', () => {
    expect(only(stop(asked()))).toMatchObject({ reply: '', status: 'stopped' });
  });

  it('leaves a finished turn alone when asked to stop', () => {
    const items = reply(asked(), 2, 'r1', 'Done.', false, at);

    expect(only(stop(items)).status).toBe('done');
  });

  it('marks a waiting question as failed, and asks it again in its place', () => {
    const failed = fail(asked());
    expect(only(failed).status).toBe('failed');

    const again = retry(failed, 1);
    expect(again).toHaveLength(1);
    expect(only(again)).toMatchObject({ status: 'waiting', reply: '', replyId: null });
  });

  it('keeps a failed question’s picture when it is asked again', () => {
    const seen = withPicture(ask([], 1, 'What is this?', 'typed', at, 'Camera'), 1, 'blob:still');
    const again = retry(fail(seen), 1);
    expect(only(again)).toMatchObject({
      status: 'waiting',
      seen: 'Camera',
      picture: 'blob:still',
      at,
    });
  });

  it('never fails or retries a turn that was answered', () => {
    const answered = reply(asked(), 2, 'r1', 'Done.', false, at);

    expect(only(fail(answered)).status).toBe('done');
    expect(only(retry(answered, 1)).status).toBe('done');
  });

  it('settles a waiting turn the service chose not to answer', () => {
    expect(only(settle(asked()))).toMatchObject({ status: 'done', reply: '' });
  });

  it('marks a restart once, and never before the first turn', () => {
    expect(restarted([], 9)).toEqual([]);
    const once = restarted(asked(), 9);
    expect(once.at(-1)).toEqual({ kind: 'divider', id: 9, label: 'Restarted' });
    expect(restarted(once, 10)).toEqual(once);
  });

  it('knows the service echoing a typed question back', () => {
    expect(isEcho(asked('What is this?'), ' What is this? ')).toBe(true);
    expect(isEcho(asked('What is this?'), 'Something else')).toBe(false);
    expect(isEcho(ask([], 1, 'Spoken', 'voice', at), 'Spoken')).toBe(false);
    expect(isEcho([], 'What is this?')).toBe(false);
  });
});

describe('a turn’s picture', () => {
  it('goes to the turn that holds its id, and a turn keeps its first one', () => {
    const items = ask(asked('What is this?'), 2, 'And this?', 'typed', at);
    const pictured = withPicture(items, 1, 'still:1');
    expect(pictured[0]).toMatchObject({ id: 1, picture: 'still:1' });
    expect(pictured[1]).not.toHaveProperty('picture');
    expect(withPicture(pictured, 1, 'still:2')[0]).toMatchObject({ picture: 'still:1' });
    expect(withPicture(items, 9, 'still:3')).toEqual(items);
  });
});
