import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialsError } from '../credentials/api';
import type { Character } from '../credentials/characters';
import type { Notification } from '../kit/island/notification';
import { noticeKeys } from './notices';
import {
  capsuleState,
  failureOf,
  Session,
  stageOverlay,
  type Network,
  type SessionOptions,
} from './session';
import { FakeTransport, flush } from './test/fakeTransport';
import { timing } from './timing';
import { TransportError } from './transport';
import { lastTurn } from './turns';

const kira: Character = { id: 'char-1', name: 'Kira', languages: ['en-US'], portrait: null };

class FakeNetwork implements Network {
  isOnline = true;
  private readonly listeners = new Set<(online: boolean) => void>();
  online(): boolean {
    return this.isOnline;
  }
  subscribe(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  set(online: boolean): void {
    this.isOnline = online;
    for (const listener of [...this.listeners]) listener(online);
  }
}

class Notices {
  readonly posted: Notification[] = [];
  readonly closed: string[] = [];
  post(n: Notification): void {
    this.posted.push(n);
  }
  close(key: string): void {
    this.closed.push(key);
  }
  keys(): string[] {
    return this.posted.map((n) => n.key);
  }
}

function setup(overrides: Partial<SessionOptions> = {}, characters: Character[] = [kira]) {
  const transport = new FakeTransport();
  const notices = new Notices();
  const network = new FakeNetwork();
  let minted = 0;
  const tokens = {
    getToken: vi.fn(() => {
      minted++;
      return Promise.resolve({ token: `tok-${String(minted)}`, endUserId: 'dev-user' });
    }),
  };
  const session = new Session({
    transport,
    tokens,
    characters: () => Promise.resolve(characters),
    notices,
    network,
    now: () => 42,
    ...overrides,
  });
  return { session, transport, notices, network, tokens };
}

/** A session that has connected once and is live. */
async function live(overrides: Partial<SessionOptions> = {}) {
  const parts = setup(overrides);
  void parts.session.start();
  await flush();
  await parts.transport.accept();
  return parts;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('starting', () => {
  it('keeps safe API setup errors for the screen and clears them on retry', async () => {
    const characters = vi
      .fn<SessionOptions['characters']>()
      .mockRejectedValueOnce(new CredentialsError('Check CONVAI_API_KEY in .env.local.', 502))
      .mockResolvedValue([kira]);
    const { session } = setup({ characters });
    await session.start();
    expect(session.state).toMatchObject({
      phase: 'failed',
      failureMessage: 'Check CONVAI_API_KEY in .env.local.',
    });
    session.retry();
    await flush();
    expect(session.state.phase).toBe('connecting');
    expect(session.state.failureMessage).toBeUndefined();
  });

  it('loads, connects to the first character with a fresh token, and goes live', async () => {
    const { session, transport } = setup();
    expect(stageOverlay(session.state)).toBe('boot');

    void session.start();
    await flush();
    expect(session.state.phase).toBe('connecting');
    expect(stageOverlay(session.state)).toBe('connecting');
    expect(capsuleState(session.state)).toBeNull();
    expect(transport.connects).toEqual([
      { token: 'tok-1', characterId: 'char-1', endUserId: 'dev-user' },
    ]);

    await transport.accept();
    expect(session.state).toMatchObject({ phase: 'live', everConnected: true, name: 'Kira' });
    expect(stageOverlay(session.state)).toBeNull();
    expect(capsuleState(session.state)).toBe('ready');
  });

  it('starts loading the transport before the token arrives, not after it', async () => {
    let mint: (token: { token: string }) => void = () => undefined;
    const { session, transport } = setup({
      tokens: {
        getToken: () =>
          new Promise((resolve) => {
            mint = resolve;
          }),
      },
    });
    void session.start();
    await flush();
    expect(transport.prepare).toHaveBeenCalledOnce();
    expect(transport.connects).toEqual([]);

    mint({ token: 'tok-late' });
    await flush();
    expect(transport.connects).toEqual([{ token: 'tok-late', characterId: 'char-1' }]);
    expect(transport.prepare).toHaveBeenCalledOnce();
  });

  it('says it is waking the character only after 1.5 s (L2)', async () => {
    const { session } = setup();
    void session.start();
    await flush();

    vi.advanceTimersByTime(timing.connectingWords - 1);
    expect(session.state.slow).toBe(false);
    vi.advanceTimersByTime(1);
    expect(session.state.slow).toBe(true);
  });

  it('shows the calm no-character state and never connects when none is configured', async () => {
    const { session, transport } = setup({}, []);
    await session.start();

    expect(session.state.phase).toBe('no-character');
    expect(capsuleState(session.state)).toBe('no-character');
    expect(stageOverlay(session.state)).toBeNull();
    expect(transport.connect).not.toHaveBeenCalled();
  });

  it('uses a stand-in name when the server could not look the name up', async () => {
    const { session } = setup({}, [{ id: 'char-1', name: null, languages: [], portrait: null }]);
    void session.start();
    await flush();

    expect(session.state.name).toBe('Character');
  });

  it.each([
    ['the network', new TransportError('network', 'x'), 'network'],
    ['the service', new TransportError('service', 'x'), 'service'],
  ] as const)('shows Couldn’t connect when %s fails the first connect', async (_c, error, why) => {
    const { session, transport } = setup();
    void session.start();
    await flush();
    await transport.refuse(error);

    expect(session.state).toMatchObject({ phase: 'failed', failure: why });
    expect(stageOverlay(session.state)).toBe('failed');
    expect(capsuleState(session.state)).toBeNull();
  });

  it('gives up on the first connect after 10 s and drops the late session', async () => {
    const { session, transport } = setup();
    void session.start();
    await flush();

    vi.advanceTimersByTime(timing.connectGiveUp);
    expect(session.state).toMatchObject({ phase: 'failed', failure: 'network' });
    expect(transport.disconnects).toBe(1);

    // A connect that answers after the give-up does not bring the session back.
    await transport.accept();
    expect(session.state.phase).toBe('failed');
  });

  it('fails at once when the network is down at start', async () => {
    const { session, network, transport } = setup();
    network.isOnline = false;
    void session.start();
    await flush();

    expect(session.state).toMatchObject({ phase: 'failed', failure: 'network' });
    expect(transport.connect).not.toHaveBeenCalled();
  });

  it('fails when the character list cannot be read, and Try again starts over', async () => {
    const characters = vi
      .fn<() => Promise<Character[]>>()
      .mockRejectedValueOnce(new CredentialsError('Could not reach the app server.'))
      .mockResolvedValue([kira]);
    const { session, transport } = setup({ characters });
    await session.start();
    expect(session.state).toMatchObject({ phase: 'failed', failure: 'network' });

    session.retry();
    await flush();
    await transport.accept();
    expect(session.state.phase).toBe('live');
  });

  it('connects again with a new token on Try again', async () => {
    const { session, transport } = setup();
    void session.start();
    await flush();
    await transport.refuse(new TransportError('service', 'x'));

    session.retry();
    await flush();
    expect(session.state.phase).toBe('connecting');
    expect(transport.connects.map((c) => c.token)).toEqual(['tok-1', 'tok-2']);
    await transport.accept();
    expect(session.state.phase).toBe('live');
  });
});

describe('clearing the conversation (Settings › Talking)', () => {
  it('empties the transcript and keeps the link, but not while an answer is under way', async () => {
    const { session, transport } = await live();
    session.send('What is this?');
    transport.emit({ type: 'activity', activity: 'thinking' });
    expect(session.clearConversation()).toBe(false);
    expect(session.state.items).toHaveLength(1);
    transport.emit(
      { type: 'reply', id: 'r1', text: 'A mug.', streaming: false },
      { type: 'activity', activity: 'idle' },
    );
    // The capsule holds Thinking for the gap before a voice that never comes.
    vi.advanceTimersByTime(5000);
    expect(session.clearConversation()).toBe(true);
    expect(session.state.items).toEqual([]);
    expect(session.state.phase).toBe('live');
    expect(transport.disconnects).toBe(0);
  });
});

describe('typing', () => {
  it('takes a still of what is seen for each question, and none with nothing seen (D1)', async () => {
    let seeing: string | null = 'Camera';
    let stills = 0;
    let answer: (picture: string | null) => void = () => undefined;
    const { session, transport } = await live({
      seeing: () => seeing,
      still: () => {
        stills++;
        return new Promise((resolve) => {
          answer = resolve;
        });
      },
    });

    session.send('What is this?');
    const asked = lastTurn(session.state.items);
    // A newer question while the still is taken: the picture still goes to the one it was taken for.
    transport.emit({ type: 'reply', id: 'r1', text: 'A mug.', streaming: false });
    seeing = null;
    transport.emit({ type: 'question', text: 'And now?' });
    expect(stills).toBe(1);
    answer('still:1');
    await flush();
    expect(session.state.items.find((item) => item.id === asked?.id)).toMatchObject({
      picture: 'still:1',
    });
    expect(lastTurn(session.state.items)).not.toHaveProperty('picture');

    transport.emit({ type: 'reply', id: 'r2', text: 'Nothing is shared.', streaming: false });
    seeing = 'Window';
    transport.emit({ type: 'question', text: 'What about this one?' });
    expect(stills).toBe(2);
    answer(null);
    await flush();
    expect(lastTurn(session.state.items)).not.toHaveProperty('picture');
  });

  it('marks each question with what was shared as it was asked, typed or spoken (D1)', async () => {
    let seeing: string | null = 'Camera';
    const { session, transport } = await live({ seeing: () => seeing });

    session.send('What is this?');
    expect(lastTurn(session.state.items)).toMatchObject({ seen: 'Camera' });
    transport.emit({ type: 'reply', id: 'r1', text: 'A mug.', streaming: false });

    seeing = null;
    transport.emit({ type: 'question', text: 'And now?' });
    expect(lastTurn(session.state.items)).not.toHaveProperty('seen');
  });

  it('asks, ignores the service echoing the question and its listening blip, then answers', async () => {
    const { session, transport } = await live();

    expect(session.send('  What is the capital of France?  ')).toBe(true);
    expect(transport.sent).toEqual(['What is the capital of France?']);
    expect(lastTurn(session.state.items)).toMatchObject({ input: 'typed', status: 'waiting' });

    // As 2.0.1 does: the question comes back, and "listening" stands for about 14 ms.
    transport.emit(
      { type: 'question', text: 'What is the capital of France?' },
      { type: 'activity', activity: 'listening' },
    );
    expect(session.state.talk).toBe('ready');
    transport.emit(
      { type: 'activity', activity: 'idle' },
      { type: 'activity', activity: 'thinking' },
    );
    expect(capsuleState(session.state)).toBe('thinking');

    transport.emit(
      { type: 'reply', id: 'r1', text: '', streaming: true },
      { type: 'reply', id: 'r1', text: 'The capital of France is Paris.', streaming: true },
      { type: 'activity', activity: 'idle' },
      { type: 'reply', id: 'r1', text: 'The capital of France is Paris.', streaming: false },
      { type: 'activity', activity: 'speaking' },
    );
    expect(capsuleState(session.state)).toBe('speaking');
    transport.emit({ type: 'activity', activity: 'idle' });

    expect(session.state.items).toHaveLength(1);
    expect(lastTurn(session.state.items)).toMatchObject({
      question: 'What is the capital of France?',
      reply: 'The capital of France is Paris.',
      status: 'done',
    });
    expect(capsuleState(session.state)).toBe('ready');
  });

  it('stays on Thinking in the gap between the reply’s text and its voice', async () => {
    const { session, transport } = await live();
    session.send('Hello');
    // As recorded: the whole text while streaming, then idle, then the text's end, then the voice.
    transport.emit(
      { type: 'activity', activity: 'thinking' },
      { type: 'reply', id: 'r1', text: 'Hi there.', streaming: true },
      { type: 'activity', activity: 'idle' },
      { type: 'reply', id: 'r1', text: 'Hi there.', streaming: false },
    );
    expect(capsuleState(session.state)).toBe('thinking');
    vi.advanceTimersByTime(timing.voiceGap - 1);
    transport.emit({ type: 'activity', activity: 'speaking' });
    expect(capsuleState(session.state)).toBe('speaking');
    transport.emit({ type: 'activity', activity: 'idle' });
    expect(capsuleState(session.state)).toBe('ready');
  });

  it('goes Ready when no voice follows the text', async () => {
    const { session, transport } = await live();
    session.send('Hello');
    transport.emit(
      { type: 'activity', activity: 'thinking' },
      { type: 'reply', id: 'r1', text: 'Hi there.', streaming: false },
      { type: 'activity', activity: 'idle' },
    );
    vi.advanceTimersByTime(timing.voiceGap);
    expect(capsuleState(session.state)).toBe('ready');
  });

  it.each(['', '   '])('sends nothing for %j', async (text) => {
    const { session, transport } = await live();

    expect(session.send(text)).toBe(false);
    expect(transport.sent).toEqual([]);
  });

  it('sends nothing until the session is live', async () => {
    const { session, transport } = setup();
    void session.start();
    await flush();

    expect(session.send('Hello')).toBe(false);
    expect(transport.sent).toEqual([]);
    expect(session.state.items).toEqual([]);
  });

  it('stops the reply being spoken before it sends a new question', async () => {
    const { session, transport } = await live();
    session.send('Tell me a long story.');
    transport.emit({ type: 'activity', activity: 'speaking' });

    session.send('Shorter, please.');
    expect(transport.interrupts).toBe(1);
    expect(session.state.items.map((i) => i.kind === 'turn' && i.status)).toEqual([
      'stopped',
      'waiting',
    ]);
  });

  it('marks a question the service could not take as failed, and Try again resends it', async () => {
    const { session, transport } = await live();
    session.send('Is it dishwasher safe?');
    transport.emit({ type: 'question-failed' });

    const turn = lastTurn(session.state.items);
    expect(turn?.status).toBe('failed');
    session.retryTurn(turn?.id ?? 0);
    expect(transport.sent).toEqual(['Is it dishwasher safe?', 'Is it dishwasher safe?']);
    expect(session.state.items).toHaveLength(1);
    expect(lastTurn(session.state.items)?.status).toBe('waiting');
  });

  it('ends a turn the service chose not to answer', async () => {
    const { session, transport } = await live();
    session.send('Say nothing.');
    transport.emit({ type: 'no-reply' });

    expect(lastTurn(session.state.items)?.status).toBe('done');
  });
});

describe('sending a typed question', () => {
  it('holds the question as Sending until the service takes it, then makes it a turn', async () => {
    let seeing: string | null = 'Camera';
    let stills = 0;
    const { session, transport } = await live({
      seeing: () => seeing,
      still: () => {
        stills++;
        return Promise.resolve('still:1');
      },
    });
    const intents: string[] = [];
    session.onIntent((intent) => intents.push(intent));
    transport.sends = 'hold';

    expect(session.send('  Is it dishwasher safe too?  ')).toBe(true);
    expect(transport.sent).toEqual(['Is it dishwasher safe too?']);
    expect(session.state.send).toBe('sending');
    expect(session.state.items).toEqual([]);
    // The still is of what was seen at Return, not when the service took it.
    expect(stills).toBe(1);
    seeing = null;

    // The SDK's own echo of the question is not the service: still Sending, and no spoken turn.
    transport.emit({ type: 'question', text: 'Is it dishwasher safe too?' });
    expect(session.state.send).toBe('sending');
    expect(session.state.items).toEqual([]);
    expect(intents).toEqual([]);

    // The service's "listening" may still be the previous question's: not proof (measured 25 Oct).
    transport.emit({ type: 'activity', activity: 'listening' });
    expect(session.state.send).toBe('sending');

    // Its acknowledgement names the question (measured 0.43–1.2 s after the send).
    transport.emit({ type: 'question-taken', text: 'Is it dishwasher safe too?' });
    expect(session.state.send).toBe('idle');
    expect(session.state.items).toHaveLength(1);
    expect(lastTurn(session.state.items)).toMatchObject({
      question: 'Is it dishwasher safe too?',
      input: 'typed',
      seen: 'Camera',
      status: 'waiting',
    });
    expect(intents).toEqual(['sent']);
    await flush();
    expect(lastTurn(session.state.items)).toMatchObject({ picture: 'still:1' });

    // A second echo after the turn stands is still the same question.
    transport.emit({ type: 'question', text: 'Is it dishwasher safe too?' });
    expect(session.state.items).toHaveLength(1);
  });

  it.each([
    ['thinking', { type: 'activity', activity: 'thinking' }],
    ['a reply', { type: 'reply', id: 'r1', text: 'Paris.', streaming: false }],
    ['the previous question’s acknowledgement', { type: 'question-taken', text: 'What is this?' }],
  ] as const)('does not take %s as the service having the question', async (_, event) => {
    const { session, transport } = await live();
    transport.sends = 'hold';
    session.send('Is it dishwasher safe too?');
    transport.emit(event);
    expect(session.state.send).toBe('sending');
  });

  it('takes an acknowledgement that names no question as this one', async () => {
    const { session, transport } = await live();
    transport.sends = 'hold';
    session.send('Is it dishwasher safe too?');
    transport.emit({ type: 'question-taken' });
    expect(session.state.send).toBe('idle');
    expect(session.state.items.filter((item) => item.kind === 'turn')).toHaveLength(1);
  });

  it('keeps one turn per question when the next is sent before the service echoes the last', async () => {
    const { session, transport } = await live({ now: () => Date.now() });
    transport.sends = 'hold';
    const first = 'What is the capital of France?';
    const second = 'Say only the word yes.';
    // As recorded on 25 Oct: the SDK's echo, the first taken, then the second sent while the
    // first is thought about; the service's acknowledgement and its user-transcription echo of the
    // first arrive while the second is Sending, then the second's own.
    session.send(first);
    transport.emit(
      { type: 'question', text: first },
      { type: 'activity', activity: 'listening' },
      { type: 'question-taken', text: first },
    );
    session.send(second);
    transport.emit(
      { type: 'question', text: second },
      { type: 'question-taken', text: first },
      { type: 'question', text: first },
      { type: 'activity', activity: 'thinking' },
      { type: 'reply', id: 'r1', text: '', streaming: false },
    );
    expect(session.state.send).toBe('sending');
    transport.emit(
      { type: 'activity', activity: 'listening' },
      { type: 'question-taken', text: second },
    );
    expect(session.state.send).toBe('idle');
    const turns = session.state.items.filter((item) => item.kind === 'turn');
    expect(turns.map((turn) => [turn.question, turn.input])).toEqual([
      [first, 'typed'],
      [second, 'typed'],
    ]);
    // The second's echo never came: the same words spoken long after its answer are a question again.
    transport.emit(
      { type: 'reply', id: 'r2', text: 'Yes.', streaming: false },
      { type: 'activity', activity: 'idle' },
    );
    vi.advanceTimersByTime(timing.echoWithin);
    transport.emit({ type: 'question', text: second });
    expect(session.state.items.filter((item) => item.kind === 'turn')).toHaveLength(3);
  });

  it('makes a question the service refused a failed turn (T2), not Couldn’t send', async () => {
    const { session, transport } = await live();
    transport.sends = 'hold';
    session.send('Is it dishwasher safe too?');
    transport.emit({ type: 'question-failed', text: 'Is it dishwasher safe too?' });
    expect(session.state.send).toBe('idle');
    expect(lastTurn(session.state.items)).toMatchObject({
      question: 'Is it dishwasher safe too?',
      status: 'failed',
    });
  });

  it('keeps a question that cannot leave as Couldn’t send, and sends it again', async () => {
    const { session, transport } = await live();
    const intents: string[] = [];
    session.onIntent((intent) => intents.push(intent));
    transport.sends = 'drop';

    expect(session.send('Is it dishwasher safe too?')).toBe(true);
    expect(session.state.send).toBe('failed');
    expect(session.state.items).toEqual([]);
    expect(intents).toEqual([]);
    // Nothing is waiting on it: no give-up runs later.
    vi.advanceTimersByTime(60_000);
    expect(session.state.send).toBe('failed');

    transport.sends = 'take';
    expect(session.send('Is it dishwasher safe too?')).toBe(true);
    expect(session.state.send).toBe('idle');
    expect(transport.sent).toEqual(['Is it dishwasher safe too?']);
    expect(session.state.items).toHaveLength(1);
    expect(intents).toEqual(['sent']);
  });

  it('gives up after 10 s with no word from the service, and ignores a late one', async () => {
    const { session, transport } = await live();
    transport.sends = 'hold';
    session.send('Is it dishwasher safe too?');
    vi.advanceTimersByTime(10_000 - 1);
    expect(session.state.send).toBe('sending');
    vi.advanceTimersByTime(1);
    expect(session.state.send).toBe('failed');

    transport.emit({ type: 'question-taken', text: 'Is it dishwasher safe too?' });
    expect(session.state.send).toBe('failed');
    expect(session.state.items).toEqual([]);
  });

  it('cannot send while Sending', async () => {
    const { session, transport } = await live();
    transport.sends = 'hold';
    session.send('First');
    expect(session.send('Second')).toBe(false);
    expect(transport.sent).toEqual(['First']);
  });

  it('turns Sending into Couldn’t send when the session goes offline', async () => {
    const { session, transport, network } = await live();
    transport.sends = 'hold';
    session.send('Is it dishwasher safe too?');
    network.set(false);
    vi.advanceTimersByTime(timing.offlineAfter);
    expect(session.state.phase).toBe('offline');
    expect(session.state.send).toBe('failed');
    expect(session.state.items).toEqual([]);
  });

  it('forgets Couldn’t send when the person lets the text go', async () => {
    const { session, transport } = await live();
    transport.sends = 'drop';
    session.send('Is it dishwasher safe too?');
    session.forgetSend();
    expect(session.state.send).toBe('idle');
  });
});

describe('stopping', () => {
  it('stops a spoken reply, freezes its text and ignores the late thinking', async () => {
    const { session, transport } = await live();
    session.send('Tell me a long story.');
    transport.emit(
      { type: 'activity', activity: 'thinking' },
      { type: 'reply', id: 'r1', text: 'Arthur had tended the lantern.', streaming: true },
      { type: 'activity', activity: 'speaking' },
    );

    session.stop();
    expect(transport.interrupts).toBe(1);
    expect(capsuleState(session.state)).toBe('ready');

    expect(session.state.stops).toBe(1);

    // As recorded: thinking, then the rest of the generated text, then idle.
    transport.emit({ type: 'activity', activity: 'thinking' });
    expect(capsuleState(session.state)).toBe('ready');
    transport.emit(
      {
        type: 'reply',
        id: 'r1',
        text: 'Arthur had tended the lantern. Every night…',
        streaming: false,
      },
      { type: 'activity', activity: 'idle' },
    );
    expect(capsuleState(session.state)).toBe('ready');
    expect(lastTurn(session.state.items)).toMatchObject({
      reply: 'Arthur had tended the lantern.',
      status: 'stopped',
    });

    // The next reply's thinking counts again.
    session.send('And then?');
    transport.emit({ type: 'activity', activity: 'thinking' });
    expect(capsuleState(session.state)).toBe('thinking');
  });

  it('does nothing when nothing is being answered', async () => {
    const { session, transport } = await live();
    session.stop();

    expect(transport.interrupts).toBe(0);
    expect(session.state.stops).toBe(0);
  });
});

describe('push to talk', () => {
  /** A live session whose browser had already allowed the microphone; it reads that on going live. */
  async function withMicrophone() {
    const parts = setup();
    parts.transport.permission = 'granted';
    void parts.session.start();
    await flush();
    await parts.transport.accept();
    await flush();
    return parts;
  }

  it('asks for the microphone on the first talk, and Allow lets the browser ask (K6a)', async () => {
    const { session, transport, notices } = await live();
    await flush();
    expect(session.state.microphone).toBe('unknown');

    session.pressTalk();
    expect(session.state.microphone).toBe('asking');
    vi.advanceTimersByTime(timing.holdThreshold);
    expect(session.state.talk).toBe('ready');

    session.allowMicrophone();
    await flush();
    // Opened once so the browser asks, then closed again until the person talks.
    expect(transport.microphoneCalls).toEqual([true, false]);
    expect(session.state.microphone).toBe('ready');
    expect(notices.keys()).toContain(noticeKeys.micOn);
  });

  it('asks the browser at once where the first run asked it already', async () => {
    const { session, transport, notices } = await live();
    await flush();
    session.microphoneAskedBefore();
    session.pressTalk();
    await flush();
    expect(session.state.microphone).toBe('ready');
    expect(transport.microphoneCalls).toEqual([true, false]);
    expect(notices.keys()).toContain(noticeKeys.micOn);
  });

  it('takes a microphone the first run was given, though the browser still says prompt', async () => {
    const parts = setup({ talkMode: 'hands-free' });
    parts.session.microphoneAllowed();
    void parts.session.start();
    await flush();
    await parts.transport.accept();
    await flush();
    // Hands free listens from the first connect.
    expect(parts.transport.microphoneCalls).toEqual([true]);
    expect(parts.session.state.microphone).toBe('open');
  });

  it('starts blocked where the site settings deny it, and says so on the first talk', async () => {
    const parts = setup();
    parts.transport.permission = 'denied';
    void parts.session.start();
    await flush();
    await parts.transport.accept();
    await flush();
    expect(parts.session.state.microphone).toBe('blocked');
    expect(parts.notices.keys()).not.toContain(noticeKeys.micBlocked);
    parts.session.pressTalk();
    expect(parts.notices.keys()).toContain(noticeKeys.micBlocked);
    expect(parts.transport.microphoneCalls).toEqual([]);
  });

  it('in hands free asks for a microphone never given when the capsule’s button is pressed', async () => {
    const { session, transport } = await live({ talkMode: 'hands-free' });
    await flush();
    expect(session.state.microphone).toBe('unknown');
    session.askForMicrophone();
    expect(session.state.microphone).toBe('asking');
    session.allowMicrophone();
    await flush();
    // Hands free keeps it open: it listens from here on.
    expect(transport.microphoneCalls).toEqual([true]);
    expect(session.state.microphone).toBe('open');
  });

  it('in hands free says a blocked microphone is blocked when the capsule’s button is pressed', async () => {
    const parts = setup({ talkMode: 'hands-free' });
    parts.transport.permission = 'denied';
    void parts.session.start();
    await flush();
    await parts.transport.accept();
    await flush();
    parts.session.askForMicrophone();
    expect(parts.notices.keys()).toContain(noticeKeys.micBlocked);
    expect(parts.session.state.microphone).toBe('blocked');
  });

  it('starts holding after 150 ms, opens the microphone, and closes it after release', async () => {
    const { session, transport } = await withMicrophone();
    expect(session.state.microphone).toBe('ready');

    session.pressTalk();
    vi.advanceTimersByTime(timing.holdThreshold - 1);
    expect(session.state.talk).toBe('ready');
    vi.advanceTimersByTime(1);
    expect(capsuleState(session.state)).toBe('held');
    await flush();
    expect(session.state.microphone).toBe('open');

    // The service hearing the voice keeps the held look.
    transport.emit({ type: 'activity', activity: 'listening' });
    expect(capsuleState(session.state)).toBe('held');

    session.releaseTalk();
    expect(session.state).toMatchObject({ talk: 'ready', talks: 1 });
    expect(transport.microphoneCalls).toEqual([true]);
    vi.advanceTimersByTime(timing.releaseTail);
    await flush();
    expect(transport.microphoneCalls).toEqual([true, false]);
    expect(session.state.microphone).toBe('ready');
  });

  it('ignores a press shorter than 150 ms', async () => {
    const { session, transport } = await withMicrophone();

    session.pressTalk();
    vi.advanceTimersByTime(timing.holdThreshold - 10);
    session.releaseTalk();
    vi.advanceTimersByTime(1000);
    await flush();

    expect(session.state.talks).toBe(0);
    expect(transport.microphoneCalls).toEqual([]);
  });

  it('stops a spoken reply when the talk key goes down', async () => {
    const { session, transport } = await withMicrophone();
    session.send('Tell me a story.');
    transport.emit({ type: 'activity', activity: 'speaking' });

    session.pressTalk();
    expect(transport.interrupts).toBe(1);
    expect(session.state.stops).toBe(1);
  });

  it.each([
    ['blocked', noticeKeys.micBlocked],
    ['busy', noticeKeys.micBusy],
    ['none', noticeKeys.micNone],
  ] as const)('posts the Island request when the microphone is %s', async (outcome, key) => {
    const { session, transport, notices } = await withMicrophone();
    transport.microphone = outcome;

    session.pressTalk();
    vi.advanceTimersByTime(timing.holdThreshold);
    await flush();

    expect(session.state).toMatchObject({ microphone: outcome, talk: 'ready' });
    expect(notices.keys()).toContain(key);
  });

  it('opens typing from Type instead on a microphone banner', async () => {
    const { session, transport, notices } = await withMicrophone();
    transport.microphone = 'blocked';
    const intents: string[] = [];
    session.onIntent((intent) => intents.push(intent));
    session.pressTalk();
    vi.advanceTimersByTime(timing.holdThreshold);
    await flush();

    const banner = notices.posted.find((n) => n.key === noticeKeys.micBlocked);
    expect(banner?.primary?.label).toBe('Try again');
    banner?.secondary?.run();
    expect(intents).toEqual(['type']);
  });

  it('asks the blocked banner again on the next talk, without opening anything', async () => {
    const { session, transport, notices } = await withMicrophone();
    transport.microphone = 'blocked';
    session.pressTalk();
    vi.advanceTimersByTime(timing.holdThreshold);
    await flush();
    session.releaseTalk();
    const calls = transport.microphoneCalls.length;

    session.pressTalk();
    vi.advanceTimersByTime(timing.holdThreshold);
    await flush();
    expect(transport.microphoneCalls).toHaveLength(calls);
    expect(notices.keys().filter((k) => k === noticeKeys.micBlocked)).toHaveLength(2);
  });
});

describe('muting', () => {
  it('mutes, ignores the talk key while muted, and keeps typing', async () => {
    const { session, transport } = await live();

    session.toggleMute();
    expect(capsuleState(session.state)).toBe('muted');
    session.pressTalk();
    vi.advanceTimersByTime(timing.holdThreshold);
    await flush();
    // Neither held nor asking for the microphone.
    expect(session.state).toMatchObject({ talk: 'ready', microphone: 'unknown' });
    expect(transport.microphoneCalls).toEqual([]);
    expect(session.send('Typed while muted')).toBe(true);
    expect(transport.sent).toEqual(['Typed while muted']);

    session.toggleMute();
    expect(capsuleState(session.state)).toBe('ready');
  });

  it('shows the reply’s state over Muted while it is answered', async () => {
    const { session, transport } = await live();
    session.toggleMute();
    session.send('Hello');
    transport.emit({ type: 'activity', activity: 'speaking' });

    expect(capsuleState(session.state)).toBe('speaking');
  });
});

describe('a session that worked', () => {
  it('says nothing about a link that is back within 2 s', async () => {
    const { session, transport, notices } = await live();
    transport.emit({ type: 'reconnecting' });
    vi.advanceTimersByTime(timing.silentReconnect - 1);
    transport.emit({ type: 'reconnected' });
    vi.advanceTimersByTime(5000);

    expect(capsuleState(session.state)).toBe('ready');
    expect(notices.keys()).not.toContain(noticeKeys.connecting);
  });

  it('shows Connecting after 2 s of a dropped link, and clears it when it is back', async () => {
    const { session, transport, notices } = await live();
    transport.emit({ type: 'reconnecting' });
    vi.advanceTimersByTime(timing.silentReconnect);

    expect(capsuleState(session.state)).toBe('connecting');
    expect(notices.keys()).toContain(noticeKeys.connecting);
    transport.emit({ type: 'reconnected' });
    expect(capsuleState(session.state)).toBe('ready');
    expect(notices.closed).toContain(noticeKeys.connecting);
  });

  it('starts a new session when the old one ended, and marks the break', async () => {
    const { session, transport, notices } = await live();
    session.send('Hello');
    transport.emit({ type: 'reply', id: 'r1', text: 'Hi.', streaming: false });

    transport.emit({ type: 'ended' });
    await flush();
    expect(transport.connects).toHaveLength(2);
    expect(transport.connects[1]?.token).toBe('tok-2');
    await transport.accept();

    expect(session.state.phase).toBe('live');
    expect(session.state.items.at(-1)).toMatchObject({ kind: 'divider', label: 'Restarted' });
    expect(notices.keys()).toContain(noticeKeys.restarted);
    expect(stageOverlay(session.state)).toBeNull();
  });

  it('goes Offline after 3 s without network, and back when it returns', async () => {
    const { session, network, notices } = await live();
    network.set(false);
    vi.advanceTimersByTime(timing.offlineAfter - 1);
    expect(session.state.phase).toBe('live');
    vi.advanceTimersByTime(1);

    expect(session.state.phase).toBe('offline');
    expect(capsuleState(session.state)).toBe('offline');
    expect(stageOverlay(session.state)).toBeNull();

    const offline = notices.posted.find((n) => n.key === noticeKeys.offline);
    expect(offline).toMatchObject({
      level: 'status',
      title: 'You’re offline. You can keep working.',
      seconds: 4,
    });
    expect(offline?.primary).toBeUndefined();
    expect(offline?.working).toBeUndefined();
    expect(session.send('Hello')).toBe(false);

    network.set(true);
    expect(session.state.phase).toBe('live');
    expect(notices.closed).toContain(noticeKeys.offline);
    expect(notices.keys()).toContain(noticeKeys.backOnline);
  });

  it('says nothing about a network blip under 3 s', async () => {
    const { session, network, notices } = await live();
    network.set(false);
    vi.advanceTimersByTime(timing.offlineAfter - 100);
    network.set(true);
    vi.advanceTimersByTime(5000);

    expect(session.state.phase).toBe('live');
    expect(notices.keys()).not.toContain(noticeKeys.offline);
  });

  it('shows Unavailable when the service refuses the new session, and keeps retrying', async () => {
    const { session, transport, notices } = await live();
    transport.emit({ type: 'ended' });
    await flush();
    await transport.refuse(new TransportError('service', 'x'));

    expect(session.state.phase).toBe('unavailable');
    expect(capsuleState(session.state)).toBe('unavailable');
    expect(stageOverlay(session.state)).toBeNull();

    expect(notices.posted.filter((n) => n.title.includes('unavailable'))).toEqual([]);

    vi.advanceTimersByTime(timing.retryFirst);
    await flush();
    expect(transport.connects).toHaveLength(3);
    await transport.refuse(new TransportError('service', 'x'));
    vi.advanceTimersByTime(timing.retryFirst);
    await flush();
    expect(transport.connects).toHaveLength(3);
    vi.advanceTimersByTime(timing.retryFirst);
    await flush();
    expect(transport.connects).toHaveLength(4);

    await transport.accept();
    expect(session.state.phase).toBe('live');
  });

  it('retries at once on Try again while unavailable', async () => {
    const { session, transport } = await live();
    transport.emit({ type: 'ended' });
    await flush();
    await transport.refuse(new TransportError('service', 'x'));

    session.retry();
    await flush();
    expect(transport.connects).toHaveLength(3);
  });

  it('raises the weak-connection dot while the link is poor', async () => {
    const { session, transport, notices } = await live();
    transport.emit({ type: 'quality', quality: 'poor' });
    expect(session.state.weak).toBe(true);
    expect(notices.posted.find((n) => n.key === noticeKeys.weak)).toMatchObject({
      mark: 'warn',
      dotAfter: 3,
    });

    transport.emit({ type: 'quality', quality: 'poor' });
    expect(notices.keys().filter((k) => k === noticeKeys.weak)).toHaveLength(1);
    transport.emit({ type: 'quality', quality: 'good' });
    expect(session.state.weak).toBe(false);
    expect(notices.closed).toContain(noticeKeys.weak);
  });
});

describe('switching characters', () => {
  const elena: Character = { id: 'char-2', name: 'Elena', languages: ['es-ES'], portrait: null };

  async function liveWithTwo(overrides: Partial<SessionOptions> = {}) {
    const parts = setup(overrides, [kira, elena]);
    void parts.session.start();
    await flush();
    await parts.transport.accept();
    return parts;
  }

  it('starts with the character last talked to when it is still offered', async () => {
    const { session, transport } = setup({ preferred: () => 'char-2' }, [kira, elena]);
    void session.start();
    await flush();
    expect(transport.connects[0]?.characterId).toBe('char-2');
    expect(session.state.name).toBe('Elena');
  });

  it('starts with the first character when the one last talked to is gone', async () => {
    const { session, transport } = setup({ preferred: () => 'gone' }, [kira, elena]);
    void session.start();
    await flush();
    expect(transport.connects[0]?.characterId).toBe('char-1');
  });

  it('ends the conversation and connects to the chosen character as the same end user', async () => {
    const { session, transport } = await liveWithTwo();
    session.send('Hello');
    transport.emit({ type: 'reply', id: 'r1', text: 'Hi.', streaming: false });

    session.switchTo(elena);

    expect(session.state).toMatchObject({ phase: 'connecting', name: 'Elena', items: [] });
    expect(capsuleState(session.state)).toBe('connecting');
    expect(stageOverlay(session.state)).toBe('switching');
    await flush();
    expect(transport.connects[1]).toEqual({
      token: 'tok-2',
      characterId: 'char-2',
      endUserId: 'dev-user',
    });

    await transport.accept();
    expect(session.state).toMatchObject({ phase: 'live', name: 'Elena', items: [] });
    expect(capsuleState(session.state)).toBe('ready');
    expect(stageOverlay(session.state)).toBeNull();
  });

  it('marks no restart and says nothing restarted', async () => {
    const { session, transport, notices } = await liveWithTwo();
    session.switchTo(elena);
    await flush();
    await transport.accept();
    expect(session.state.items).toEqual([]);
    expect(notices.keys()).not.toContain(noticeKeys.restarted);
  });

  it('takes the old link ending for no break while the new connect runs', async () => {
    const { session, transport, notices } = await liveWithTwo();
    session.switchTo(elena);
    await flush();
    transport.emit({ type: 'ended' });
    await flush();
    expect(transport.connects).toHaveLength(2);
    await transport.accept();
    expect(session.state.items).toEqual([]);
    expect(notices.keys()).not.toContain(noticeKeys.restarted);
  });

  it('lets a later end of the new link start again as before', async () => {
    const { session, transport } = await liveWithTwo();
    session.switchTo(elena);
    await flush();
    await transport.accept();
    transport.emit({ type: 'ended' });
    await flush();
    expect(transport.connects).toHaveLength(3);
    expect(transport.connects[2]?.characterId).toBe('char-2');
  });

  it('drops the old reply that was being spoken without interrupting the new character', async () => {
    const { session, transport } = await liveWithTwo();
    session.send('Hello');
    transport.emit({ type: 'activity', activity: 'speaking' });
    session.switchTo(elena);
    expect(session.state.talk).toBe('ready');
    expect(session.isAnswering()).toBe(false);
    await flush();
    await transport.accept();
    // The new character's first "thinking" is its own, not a stopped reply's tail.
    transport.emit({ type: 'activity', activity: 'thinking' });
    expect(session.state.talk).toBe('thinking');
  });

  it('closes the old character’s notices at once', async () => {
    const { session, transport, notices } = await liveWithTwo();
    transport.emit({ type: 'ended' });
    await flush();
    await transport.refuse(new TransportError('service', 'x'));
    expect(session.state.phase).toBe('unavailable');

    const before = notices.closed.length;
    session.switchTo(elena);
    expect(notices.closed.slice(before)).toEqual(
      expect.arrayContaining([
        noticeKeys.offline,
        noticeKeys.connecting,
        noticeKeys.restarted,
        noticeKeys.weak,
        noticeKeys.backOnline,
      ]),
    );
    // The retry for the old character is called off.
    vi.advanceTimersByTime(timing.retryFirst * 4);
    await flush();
    expect(transport.connects.map((c) => c.characterId)).toEqual(['char-1', 'char-1', 'char-2']);
  });

  it('lands on Unavailable with Try again when the chosen character cannot connect', async () => {
    const { session, transport } = await liveWithTwo();
    session.switchTo(elena);
    await flush();
    await transport.refuse(new TransportError('service', 'x'));
    expect(session.state).toMatchObject({ phase: 'unavailable', name: 'Elena' });
    expect(stageOverlay(session.state)).toBeNull();

    session.retry();
    await flush();
    expect(transport.connects.at(-1)?.characterId).toBe('char-2');
  });

  it('ignores the connect it replaced when a second switch comes first', async () => {
    const { session, transport } = await liveWithTwo();
    session.switchTo(elena);
    session.switchTo(kira);
    await flush();
    await transport.accept();
    expect(session.state).toMatchObject({ phase: 'live', name: 'Kira' });
    expect(transport.connects.at(-1)?.characterId).toBe('char-1');
  });

  it('does nothing for the character already talked to', async () => {
    const { session, transport } = await liveWithTwo();
    session.send('Hello');
    session.switchTo(kira);
    await flush();
    expect(transport.connects).toHaveLength(1);
    expect(session.state.items).toHaveLength(1);
  });

  it('does nothing before it has started', () => {
    const { session, transport } = setup({}, [kira, elena]);
    session.switchTo(elena);
    expect(transport.connect).not.toHaveBeenCalled();
    expect(session.state.character).toBeNull();
  });

  it('reopens the microphone on the new link in hands free', async () => {
    const { session, transport } = await liveWithTwo({ talkMode: 'hands-free' });
    transport.permission = 'granted';
    session.allowMicrophone();
    await flush();
    expect(session.state.microphone).toBe('open');

    session.switchTo(elena);
    expect(session.state.microphone).toBe('ready');
    await flush();
    transport.microphoneCalls.length = 0;
    await transport.accept();
    await flush();
    expect(transport.microphoneCalls).toEqual([true]);
    expect(session.state.microphone).toBe('open');
  });

  it('says nothing on the Island while Elena wakes up, however long it takes', async () => {
    const { session, notices } = await liveWithTwo();
    session.switchTo(elena);
    await flush();
    vi.advanceTimersByTime(timing.connectGiveUp - 1);
    expect(stageOverlay(session.state)).toBe('switching');
    expect(notices.keys()).not.toContain(noticeKeys.connecting);
  });

  it('gives a switch up after 10 s: Couldn’t connect, with retries behind it', async () => {
    const { session, transport, notices } = await liveWithTwo();
    session.switchTo(elena);
    await flush();
    vi.advanceTimersByTime(timing.connectGiveUp - 1);
    expect(session.state.stranded).toBe(false);
    vi.advanceTimersByTime(1);

    expect(session.state).toMatchObject({ phase: 'offline', switching: false, stranded: true });
    expect(stageOverlay(session.state)).toBe('failed');
    expect(transport.disconnect).toHaveBeenCalled();
    // The stage says it: no offline toast for a link that never came.
    expect(notices.keys()).not.toContain(noticeKeys.offline);

    // Its own retry behind the overlay goes live.
    vi.advanceTimersByTime(timing.retryFirst);
    await flush();
    expect(transport.connects.at(-1)?.characterId).toBe('char-2');
    await transport.accept();
    expect(session.state).toMatchObject({ phase: 'live', stranded: false });
    expect(stageOverlay(session.state)).toBeNull();
    // Elena was never live before: no break to mark.
    expect(notices.keys()).not.toContain(noticeKeys.restarted);
  });

  it('opens the microphone in hands free when a switch gets through after giving up', async () => {
    const { session, transport } = await liveWithTwo({ talkMode: 'hands-free' });
    transport.permission = 'granted';
    session.allowMicrophone();
    await flush();
    session.switchTo(elena);
    await flush();
    vi.advanceTimersByTime(timing.connectGiveUp);
    session.retry();
    await flush();
    transport.microphoneCalls.length = 0;
    await transport.accept();
    await flush();
    expect(transport.microphoneCalls).toEqual([true]);
    expect(session.state.microphone).toBe('open');
  });

  it('keeps the old link’s give-up rule: a later reconnect never gives up', async () => {
    const { session, transport } = await liveWithTwo();
    transport.emit({ type: 'ended' });
    await flush();
    vi.advanceTimersByTime(timing.connectGiveUp * 3);
    expect(session.state.phase).toBe('connecting');
    expect(stageOverlay(session.state)).toBeNull();
  });

  it('keeps push to talk closed on the new link', async () => {
    const { session, transport } = await liveWithTwo();
    transport.permission = 'granted';
    await flush();
    session.switchTo(elena);
    await flush();
    transport.microphoneCalls.length = 0;
    await transport.accept();
    await flush();
    expect(transport.microphoneCalls).toEqual([]);
  });
});

describe('stranded: offline for more than 30 s', () => {
  /** Live, then the network goes; the session is Offline from `offlineAfter` on. */
  async function offline() {
    const parts = await live();
    parts.network.set(false);
    vi.advanceTimersByTime(timing.offlineAfter);
    expect(parts.session.state.phase).toBe('offline');
    return parts;
  }

  it('shows Couldn’t connect 30 s after going offline, not before', async () => {
    const { session, notices } = await offline();
    vi.advanceTimersByTime(30_000 - 1);
    expect(stageOverlay(session.state)).toBeNull();
    expect(capsuleState(session.state)).toBe('offline');

    vi.advanceTimersByTime(1);
    expect(session.state.stranded).toBe(true);
    expect(stageOverlay(session.state)).toBe('failed');

    expect(notices.closed).toContain(noticeKeys.offline);
  });

  it('is not shown when the network comes back within 30 s', async () => {
    const { session, network } = await offline();
    vi.advanceTimersByTime(20_000);
    network.set(true);
    vi.advanceTimersByTime(30_000);
    expect(session.state).toMatchObject({ phase: 'live', stranded: false });
    expect(stageOverlay(session.state)).toBeNull();
  });

  it('counts from the first offline: retries in between do not restart the 30 s', async () => {
    const { session, transport, notices } = await live();
    transport.emit({ type: 'ended' });
    await flush();
    await transport.refuse(new TransportError('network', 'x'));
    expect(session.state.phase).toBe('offline');
    const toasts = () => notices.keys().filter((key) => key === noticeKeys.offline).length;
    expect(toasts()).toBe(1);

    // 4 s, 8 s, 16 s: three retries fail inside the 30 s.
    for (const wait of [4000, 8000, 16_000]) {
      vi.advanceTimersByTime(wait);
      await flush();
      await transport.refuse(new TransportError('network', 'x'));
    }
    expect(session.state.stranded).toBe(false);
    vi.advanceTimersByTime(30_000 - 28_000);
    expect(session.state.stranded).toBe(true);
    expect(stageOverlay(session.state)).toBe('failed');

    // The retries behind it go on without another toast.
    vi.advanceTimersByTime(timing.retryMost);
    await flush();
    await transport.refuse(new TransportError('network', 'x'));
    expect(stageOverlay(session.state)).toBe('failed');
    expect(toasts()).toBe(1);
  });

  it('counts from the first offline when the network also says so during a retry', async () => {
    const { session, transport, network, notices } = await live();
    transport.emit({ type: 'ended' });
    await flush();
    await transport.refuse(new TransportError('network', 'x'));
    // The retry at 4 s hangs; the browser says offline then, and Offline follows 3 s later.
    vi.advanceTimersByTime(4000);
    await flush();
    expect(session.state.phase).toBe('connecting');
    network.set(false);
    vi.advanceTimersByTime(3000);
    expect(session.state.phase).toBe('offline');
    expect(notices.keys().filter((key) => key === noticeKeys.offline)).toHaveLength(1);
    vi.advanceTimersByTime(30_000 - 7000);
    expect(session.state.stranded).toBe(true);
  });

  it('keeps Couldn’t connect while a retry of its own runs behind it', async () => {
    const { session, transport } = await live();
    transport.emit({ type: 'ended' });
    await flush();
    await transport.refuse(new TransportError('network', 'x'));
    vi.advanceTimersByTime(30_000);
    await flush();
    expect(session.state.phase).toBe('connecting');
    expect(stageOverlay(session.state)).toBe('failed');
  });

  it('goes back to Connecting on Try again, and live when it works', async () => {
    const { session, transport, network } = await offline();
    vi.advanceTimersByTime(30_000);
    network.isOnline = true;
    const before = transport.connects.length;

    session.retry();
    expect(stageOverlay(session.state)).toBe('connecting');
    await flush();
    expect(transport.connects).toHaveLength(before + 1);
    await transport.accept();
    expect(session.state).toMatchObject({ phase: 'live', stranded: false, retrying: false });
    expect(stageOverlay(session.state)).toBeNull();
  });

  it('comes back to Couldn’t connect when Try again fails, without a toast', async () => {
    const { session, notices } = await offline();
    vi.advanceTimersByTime(30_000);
    const toasts = notices.keys().length;

    session.retry();
    await flush();
    expect(session.state).toMatchObject({ phase: 'offline', stranded: true, retrying: false });
    expect(stageOverlay(session.state)).toBe('failed');
    expect(notices.keys()).toHaveLength(toasts);
  });

  it('shows Connecting on Try again pressed while its own retry already runs', async () => {
    const { session, transport } = await live();
    transport.emit({ type: 'ended' });
    await flush();
    await transport.refuse(new TransportError('network', 'x'));
    vi.advanceTimersByTime(30_000);
    await flush();
    expect(session.state.phase).toBe('connecting');
    const before = transport.connects.length;

    session.retry();
    expect(stageOverlay(session.state)).toBe('connecting');
    expect(transport.connects).toHaveLength(before);
  });

  it('drops the overlay when the link comes back by itself', async () => {
    const { session, network, notices } = await offline();
    vi.advanceTimersByTime(30_000);
    network.set(true);
    expect(session.state).toMatchObject({ phase: 'live', stranded: false });
    expect(stageOverlay(session.state)).toBeNull();
    expect(notices.keys()).toContain(noticeKeys.backOnline);
  });

  it('drops the overlay on a reconnected link', async () => {
    const { session, transport } = await offline();
    vi.advanceTimersByTime(30_000);
    transport.emit({ type: 'reconnected' });
    expect(session.state).toMatchObject({ phase: 'live', stranded: false });
  });

  it('is left behind by a switch to another character', async () => {
    const elena: Character = { id: 'char-2', name: 'Elena', languages: [], portrait: null };
    const { session, network } = await offline();
    vi.advanceTimersByTime(30_000);
    network.isOnline = true;

    session.switchTo(elena);
    expect(session.state).toMatchObject({ stranded: false, switching: true });
    expect(stageOverlay(session.state)).toBe('switching');
  });

  it('does not strand a session that the service refuses by the 30 s mark', async () => {
    const { session, transport } = await live();
    transport.emit({ type: 'ended' });
    await flush();
    await transport.refuse(new TransportError('network', 'x'));
    vi.advanceTimersByTime(timing.retryFirst);
    await flush();
    await transport.refuse(new TransportError('service', 'x'));
    expect(session.state.phase).toBe('unavailable');
    vi.advanceTimersByTime(30_000);
    expect(session.state.stranded).toBe(false);
    expect(stageOverlay(session.state)).toBeNull();
  });

  it('gives the stage back to the capsule when a stranded session’s retry meets the service', async () => {
    const { session, transport } = await live();
    transport.emit({ type: 'ended' });
    await flush();
    await transport.refuse(new TransportError('network', 'x'));
    vi.advanceTimersByTime(30_000);
    await flush();
    expect(stageOverlay(session.state)).toBe('failed');
    await transport.refuse(new TransportError('service', 'x'));
    expect(session.state).toMatchObject({ phase: 'unavailable', stranded: false });
    expect(stageOverlay(session.state)).toBeNull();
    expect(capsuleState(session.state)).toBe('unavailable');
  });

  it('never strands a session that is unavailable: that is the capsule’s', async () => {
    const { session, transport } = await live();
    transport.emit({ type: 'ended' });
    await flush();
    await transport.refuse(new TransportError('service', 'x'));
    vi.advanceTimersByTime(60_000);
    await flush();
    expect(session.state.stranded).toBe(false);
  });
});

describe('disposing', () => {
  it('disconnects and lets no timer fire afterwards', async () => {
    const { session, transport } = setup();
    void session.start();
    await flush();
    await session.dispose();

    vi.advanceTimersByTime(60_000);
    expect(transport.disconnects).toBe(1);
    expect(session.state.phase).toBe('connecting');
  });

  it('starts again after dispose, as React’s development mode asks', async () => {
    const { session, transport } = setup();
    void session.start();
    await flush();
    await session.dispose();
    void session.start();
    await flush();

    expect(transport.connects).toHaveLength(2);
    await transport.accept();
    expect(session.state.phase).toBe('live');
  });
});

describe('failureOf', () => {
  it.each([
    [new TransportError('service', 'x'), 'service'],
    [new TransportError('network', 'x'), 'network'],
    [new CredentialsError('Could not reach the app server.'), 'network'],
    [new CredentialsError('Convai refused the token request.', 502), 'service'],
    [new Error('anything else'), 'network'],
    [{ failure: 'service' }, 'service'],
    [{ failure: 'something' }, 'network'],
  ])('reads %o as %s', (error, failure) => {
    expect(failureOf(error)).toBe(failure);
  });
});
