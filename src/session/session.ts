import { CredentialsError } from '../credentials/api';
import type { Character } from '../credentials/characters';
import type { TokenSource } from '../credentials/tokenSource';
import type { Notification } from '../kit/island/notification';
import type { CapsuleState, TalkMode } from '../kit/capsule/capsuleCopy';
import {
  backOnlineNotice,
  connectingNotice,
  microphoneBlockedNotice,
  microphoneBusyNotice,
  microphoneMissingNotice,
  microphoneOnNotice,
  noticeKeys,
  offlineNotice,
  restartedNotice,
  weakNotice,
} from './notices';
import { retryDelay, timing } from './timing';
import {
  TransportError,
  type Activity,
  type ConnectFailure,
  type MicrophoneOutcome,
  type SessionTransport,
  type TransportEvent,
} from './transport';
import * as transcript from './turns';
import type { TranscriptItem } from './turns';

export type Phase =
  'loading' | 'connecting' | 'live' | 'offline' | 'unavailable' | 'failed' | 'no-character';

/** The conversation's own state while live. `held` is push to talk with the key down. */
export type Talk = 'ready' | 'listening' | 'held' | 'thinking' | 'speaking';

export type Microphone = 'unknown' | 'asking' | 'ready' | 'open' | 'blocked' | 'busy' | 'none';

export interface SessionState {
  phase: Phase;
  /** True once a connect has worked; failures after that never block the stage. */
  everConnected: boolean;
  /** Why the last connect failed. */
  failure: ConnectFailure | null;
  /** A safe setup or API error from the app server, never a raw SDK error. */
  failureMessage?: string;
  /** The running connect has taken longer than 1.5 s, so it says so. */
  slow: boolean;
  talk: Talk;
  /** When `talk` last changed, in milliseconds since the epoch: captions follow the voice by it. */
  talkSince: number;
  /** When the character last stopped speaking, in milliseconds since the epoch; 0 before. */
  spokeUntil: number;
  talkMode: TalkMode;
  muted: boolean;
  microphone: Microphone;
  character: Character | null;
  /** The character's name for every line of copy. */
  name: string;
  items: readonly TranscriptItem[];

  talks: number;
  /** How many answers the person stopped (Esc, a click on the Lens, talking or typing over it). */
  stops: number;
  /** The link is weak (the warn dot is up). */
  weak: boolean;

  switching: boolean;

  stranded: boolean;

  retrying: boolean;

  send: SendState;
}

export type SendState = 'idle' | 'sending' | 'failed';

/** The Island, as far as the session posts to it. */
export interface Notices {
  post(notification: Notification): void;
  /** `now`: the person's own action closed it, so it goes without its minimum time. */
  close(key: string, now?: boolean): void;
}

export interface Network {
  online(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

export type Intent = 'type' | 'sent';

export interface SessionOptions {
  transport: SessionTransport;
  tokens: TokenSource;
  characters: () => Promise<Character[]>;
  notices: Notices;
  network?: Network;
  talkMode?: TalkMode;
  now?: () => number;
  /** What the character sees now, for each question's meta line; null with nothing shared. */
  seeing?: () => string | null;
  /** A still of what the character sees now (an image URL), for the question's picture; null without one. */
  still?: () => Promise<string | null>;
  /** The character to start with when it is offered: the one last talked to on this device. */
  preferred?: () => string | null;
}

/** The name the copy uses when the app server could not look the character's name up. */
export const fallbackName = 'Character';

export const browserNetwork: Network = {
  online: () => navigator.onLine,
  subscribe(listener) {
    const on = () => {
      listener(true);
    };
    const off = () => {
      listener(false);
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  },
};

type TimerName =
  | 'slow'
  | 'giveUp'
  | 'silent'
  | 'offline'
  | 'stranded'
  | 'retry'
  | 'hold'
  | 'tail'
  | 'speech'
  | 'send';

/** Why a token request or a connect failed. */
export function failureOf(error: unknown): ConnectFailure {
  if (error instanceof TransportError) return error.failure;
  // A transport built outside this bundle (the end-to-end tests' fake) says it the same way.
  if (typeof error === 'object' && error !== null && 'failure' in error) {
    return error.failure === 'service' ? 'service' : 'network';
  }
  // The app server answered, so Convai is what said no; no answer at all is the network.
  if (error instanceof CredentialsError) return error.status === undefined ? 'network' : 'service';
  return 'network';
}

export class Session {
  private current: SessionState;
  private readonly listeners = new Set<() => void>();
  private readonly intents = new Set<(intent: Intent) => void>();
  private readonly timers = new Map<TimerName, ReturnType<typeof setTimeout>>();
  private readonly options: Required<Omit<SessionOptions, 'talkMode'>>;
  private generation = 0;
  private nextId = 1;
  private attempts = 0;
  /** After a stop, the service's late "thinking" or "speaking" is not the next turn. */
  private stopping = false;
  private link: 'up' | 'reconnecting' | 'down' = 'down';
  /** A reply's words have come and its voice has not started yet. */
  private awaitingVoice = false;
  private disposed = false;
  private started = false;
  /** The character now chosen has been live: a later connect to it is a restart. */
  private characterLive = false;

  private askedBefore = false;
  /** The typed question the service has not taken yet, with what was seen as it was sent. */
  private sending: { question: string; seen: string | null; still: Promise<string | null> } | null =
    null;
  /**
   * Typed questions the service took lately: it may echo one back as a user transcription once the
   * next is on its way (recorded 25 Oct), which is the same question, not a spoken one.
   */
  private echoes: { question: string; at: number }[] = [];
  private unsubscribe: (() => void)[] = [];

  constructor(options: SessionOptions) {
    this.options = {
      network: browserNetwork,
      now: () => Date.now(),
      seeing: () => null,
      still: () => Promise.resolve(null),
      preferred: () => null,
      ...options,
    };
    this.current = {
      phase: 'loading',
      everConnected: false,
      failure: null,
      slow: false,
      talk: 'ready',
      talkSince: 0,
      spokeUntil: 0,
      talkMode: options.talkMode ?? 'push-to-talk',
      muted: false,
      microphone: 'unknown',
      character: null,
      name: fallbackName,
      items: [],
      talks: 0,
      stops: 0,
      weak: false,
      switching: false,
      stranded: false,
      retrying: false,
      send: 'idle',
    };
  }

  get state(): SessionState {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onIntent(listener: (intent: Intent) => void): () => void {
    this.intents.add(listener);
    return () => this.intents.delete(listener);
  }

  /**
   * Loads the characters and connects to the first. A second call while started does nothing;
   * after `dispose()` it starts again (React's development mode runs effects twice).
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.disposed = false;
    const { transport, network } = this.options;
    this.unsubscribe.push(
      transport.subscribe((event) => {
        this.onTransport(event);
      }),
      network.subscribe((online) => {
        this.onNetwork(online);
      }),
    );
    let characters: Character[];
    try {
      characters = await this.options.characters();
    } catch (error) {
      if (this.isDisposed()) return;
      this.fail(failureOf(error), error instanceof CredentialsError ? error.message : undefined);
      return;
    }
    if (this.isDisposed()) return;
    const preferred = this.options.preferred();
    const character = characters.find((one) => one.id === preferred) ?? characters[0];
    if (!character) {
      this.set({ phase: 'no-character' });
      return;
    }
    this.set({ character, name: character.name ?? fallbackName });
    await this.connect(false);
  }

  /** Ends the session and every timer; the store keeps its last state. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.started = false;
    this.generation++;
    for (const name of [...this.timers.keys()]) this.clear(name);
    for (const stop of this.unsubscribe.splice(0)) stop();
    await this.options.transport.disconnect();
  }

  retry(): void {
    const { phase, character, stranded } = this.current;
    if (phase === 'live' || phase === 'no-character') return;
    if (phase === 'connecting') {
      if (stranded) this.set({ retrying: true });
      return;
    }
    this.attempts = 0;
    this.clear('retry');
    if (!character) {
      this.started = false;
      for (const stop of this.unsubscribe.splice(0)) stop();
      void this.start();
      return;
    }
    if (stranded) this.set({ retrying: true });
    void this.connect(this.current.everConnected);
  }

  switchTo(character: Character): void {
    const { phase } = this.current;
    if (!this.started || phase === 'no-character' || phase === 'loading') return;
    if (character.id === this.current.character?.id) return;
    // Nothing the old character was saying or about to say counts any more.
    this.stopping = false;
    this.awaitingVoice = false;
    this.attempts = 0;
    for (const name of [
      'hold',
      'tail',
      'speech',
      'silent',
      'offline',
      'stranded',
      'retry',
    ] as const)
      this.clear(name);
    const { notices } = this.options;
    for (const key of [
      noticeKeys.connecting,
      noticeKeys.offline,
      noticeKeys.backOnline,
      noticeKeys.restarted,
      noticeKeys.weak,
    ])
      notices.close(key, true);
    this.link = 'down';
    this.characterLive = false;
    this.set({
      character,
      name: character.name ?? fallbackName,
      items: [],
      talk: 'ready',
      weak: false,
      switching: true,
      stranded: false,
      retrying: false,
      // The old link's microphone goes with it; the new one opens it again in hands free.
      microphone: this.current.microphone === 'open' ? 'ready' : this.current.microphone,
    });
    void this.connect(false, true);
  }

  send(text: string): boolean {
    const question = text.trim();
    if (question === '' || this.current.phase !== 'live' || this.current.send === 'sending')
      return false;
    if (this.isAnswering()) this.stop();
    this.stopping = false;
    const seen = this.options.seeing();
    // What was seen at Return is what the question is about, however long the service takes.
    const still = seen === null ? Promise.resolve(null) : this.options.still();
    this.sending = { question, seen, still };
    this.set({ send: 'sending' });
    this.later('send', timing.sendGiveUp, () => {
      this.sendFailed();
    });
    // The transport may answer inside the call (a test double does): `sending` is set before it.
    if (!this.options.transport.sendText(question)) this.sendFailed();
    return true;
  }

  forgetSend(): void {
    if (this.current.send === 'failed') this.set({ send: 'idle' });
  }

  /** The service has the typed question: it becomes the newest turn and the field lets it go. */
  private taken(): void {
    const sent = this.sending;
    if (!sent) return;
    this.sending = null;
    this.clear('send');
    this.echoes = [...this.echoes, { question: sent.question, at: this.now() }];
    this.set({
      send: 'idle',
      items: transcript.ask(
        this.current.items,
        this.id(),
        sent.question,
        'typed',
        this.now(),
        sent.seen,
      ),
    });
    this.takeStill(sent.still);
    for (const listener of [...this.intents]) listener('sent');
  }

  /** A question the service echoes back that was typed and taken lately; each echo counts once. */
  private isTypedEcho(text: string): boolean {
    const now = this.now();
    this.echoes = this.echoes.filter((echo) => now - echo.at < timing.echoWithin);
    const at = this.echoes.findIndex((echo) => echo.question === text.trim());
    if (at < 0) return false;
    this.echoes = this.echoes.filter((_, i) => i !== at);
    return true;
  }

  private sendFailed(): void {
    if (!this.sending) return;
    this.sending = null;
    this.clear('send');
    this.set({ send: 'failed' });
  }

  /** The newest question gets a still of what the character sees, when something is seen. */
  private takeStill(still?: Promise<string | null>): void {
    const turn = transcript.lastTurn(this.current.items);
    if (turn?.seen === undefined || turn.picture !== undefined) return;
    (still ?? this.options.still())
      .then((picture) => {
        if (picture !== null)
          this.set({ items: transcript.withPicture(this.current.items, turn.id, picture) });
      })
      .catch(() => undefined);
  }

  /** Try again on a failed turn: the same question, in its place. */
  retryTurn(id: number): void {
    if (this.current.phase !== 'live') return;
    const turn = this.current.items.find((item) => item.kind === 'turn' && item.id === id);
    if (turn?.kind !== 'turn' || turn.status !== 'failed') return;
    this.stopping = false;
    this.set({ items: transcript.retry(this.current.items, id) });
    this.options.transport.sendText(turn.question);
  }

  clearConversation(): boolean {
    if (this.isAnswering()) return false;
    if (this.current.items.length > 0) this.set({ items: [] });
    return true;
  }

  stop(): void {
    if (!this.isAnswering()) return;
    this.options.transport.interrupt();
    this.stopping = true;
    this.awaitingVoice = false;
    this.clear('speech');
    this.set({
      items: transcript.stop(this.current.items),
      talk: 'ready',
      stops: this.current.stops + 1,
    });
  }

  /** True while a reply is being thought or spoken, or is still on its way. */
  isAnswering(): boolean {
    const { talk, items } = this.current;
    const status = transcript.lastTurn(items)?.status;
    return (
      talk === 'thinking' || talk === 'speaking' || status === 'waiting' || status === 'streaming'
    );
  }

  pressTalk(): void {
    const { phase, talkMode, muted, microphone } = this.current;
    if (phase !== 'live') return;
    if (this.isAnswering()) this.stop();
    if (talkMode === 'hands-free' || muted) return;
    if (microphone === 'blocked' || microphone === 'none') {
      this.postMicrophoneProblem(microphone);
      return;
    }
    if (microphone === 'unknown' || microphone === 'asking') {
      this.askForMicrophone();
      return;
    }
    this.clear('tail');
    this.later('hold', timing.holdThreshold, () => {
      this.set({ talk: 'held' });
      void this.openMicrophone();
    });
  }

  /** The talk key or the Lens came up, or the window lost focus while it was down. */
  releaseTalk(): void {
    this.clear('hold');
    if (this.current.talk !== 'held') return;
    this.set({ talk: 'ready', talks: this.current.talks + 1 });
    this.later('tail', timing.releaseTail, () => {
      void this.closeMicrophone();
    });
  }

  toggleMute(): void {
    const muted = !this.current.muted;
    if (muted && this.current.talk === 'held') {
      this.clear('hold');
      this.set({ talk: 'ready' });
    }
    this.set({ muted });
    if (muted) void this.closeMicrophone();
    else if (this.current.talkMode === 'hands-free' && this.current.microphone === 'ready')
      void this.openMicrophone();
  }

  askForMicrophone(): void {
    const { phase, microphone } = this.current;
    if (phase !== 'live' || microphone === 'asking') return;
    if (microphone === 'unknown') {
      if (this.askedBefore) void this.tryMicrophone();
      else this.set({ microphone: 'asking' });
      return;
    }
    if (microphone === 'blocked' || microphone === 'busy' || microphone === 'none')
      this.postMicrophoneProblem(microphone);
  }

  /** The first run asked the browser for the microphone: the next ask is the browser's own. */
  microphoneAskedBefore(): void {
    this.askedBefore = true;
  }

  /**
   * The first run was given the microphone. The browser's permission may not say so (Chrome's
   * "Allow this time" leaves it at "prompt"), so the session takes it from the run.
   */
  microphoneAllowed(): void {
    if (this.current.microphone === 'unknown') this.set({ microphone: 'ready' });
  }

  allowMicrophone(): void {
    void this.tryMicrophone();
  }

  /** Type instead, on the ask or a microphone banner. */
  typeInstead(): void {
    if (this.current.microphone === 'asking') this.set({ microphone: 'unknown' });
    for (const listener of [...this.intents]) listener('type');
  }

  /** Dismisses the ask without an answer; the next talk asks again. */
  dismissAsk(): void {
    if (this.current.microphone === 'asking') this.set({ microphone: 'unknown' });
  }

  setTalkMode(talkMode: TalkMode): void {
    if (talkMode === this.current.talkMode) return;
    this.set({ talkMode });
    if (talkMode === 'push-to-talk') void this.closeMicrophone();
    else if (!this.current.muted && this.current.microphone === 'ready') void this.openMicrophone();
  }

  // Connecting ---------------------------------------------------------------------------------

  /** `switching`: another character was chosen, so the capsule says Connecting at once. */
  private async connect(restart: boolean, switching = false): Promise<void> {
    const generation = ++this.generation;
    const { character } = this.current;
    if (!character) return;
    this.clear('retry');
    this.clear('slow');
    this.set({ phase: 'connecting', slow: switching, failure: null, failureMessage: undefined });
    this.later('slow', timing.connectingWords, () => {
      this.set({ slow: true });

      if (this.current.everConnected && stageOverlay(this.current) === null)
        this.options.notices.post(connectingNotice(this.current.name));
    });

    if (!this.current.everConnected || switching) {
      this.later('giveUp', timing.connectGiveUp, () => {
        this.generation++;
        void this.options.transport.disconnect();
        if (this.current.everConnected) this.set({ stranded: true });
        this.fail('network');
      });
    }
    if (!this.options.network.online()) {
      this.fail('network');
      return;
    }
    // The SDK loads on the first connect: alongside the token, not after it.
    this.options.transport.prepare?.();
    try {
      const token = await this.options.tokens.getToken();
      if (generation !== this.generation) return;
      await this.options.transport.connect({
        token: token.token,
        characterId: character.id,
        ...(token.endUserId ? { endUserId: token.endUserId } : {}),
      });
      if (generation !== this.generation) return;
      this.connected(restart);
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(failureOf(error), error instanceof CredentialsError ? error.message : undefined);
    }
  }

  private connected(restart: boolean): void {
    this.clear('slow');
    this.clear('giveUp');
    this.clear('stranded');
    this.attempts = 0;
    this.link = 'up';
    this.stopping = false;
    const { notices } = this.options;
    notices.close(noticeKeys.connecting);
    notices.close(noticeKeys.offline);
    // A new session after one was lost: the transcript keeps what was said and marks the break. A
    // switch that gave up and then got through is no restart: that character was never live.
    const restarting = restart && this.characterLive;
    const firstTime = !this.characterLive;
    this.characterLive = true;
    this.set({
      phase: 'live',
      everConnected: true,
      failure: null,
      slow: false,
      talk: 'ready',
      items: restarting ? transcript.restarted(this.current.items, this.id()) : this.current.items,
      switching: false,
      stranded: false,
      retrying: false,
    });
    if (restarting) notices.post(restartedNotice(this.current.name));
    void this.readPermission();
    const { talkMode, muted, microphone } = this.current;
    // Hands free listens from a character's first connect with a microphone given before (the
    // first run, or the character before).
    if (firstTime && talkMode === 'hands-free' && !muted && microphone === 'ready')
      void this.openMicrophone();
  }

  private fail(failure: ConnectFailure, failureMessage?: string): void {
    this.clear('slow');
    this.clear('giveUp');
    this.link = 'down';
    this.set({ failureMessage });
    const { notices } = this.options;
    notices.close(noticeKeys.connecting);
    if (!this.current.everConnected) {
      this.set({ phase: 'failed', failure, slow: false, switching: false });
      return;
    }
    const { stranded } = this.current;
    if (failure === 'network') {
      this.set({
        phase: 'offline',
        failure,
        slow: false,
        talk: 'ready',
        switching: false,
        retrying: false,
      });

      if (!stranded && !this.timers.has('stranded')) {
        notices.post(offlineNotice());
        this.strandLater();
      }
    } else {
      this.clear('stranded');
      this.set({
        phase: 'unavailable',
        failure,
        slow: false,
        talk: 'ready',
        switching: false,
        stranded: false,
        retrying: false,
      });
      notices.close(noticeKeys.offline);
    }
    this.later('retry', retryDelay(this.attempts++), () => {
      void this.connect(true);
    });
  }

  private strandLater(): void {
    // Every way out of the stretch (live again, the service answering, a switch) clears it.
    this.later('stranded', timing.strandedAfter, () => {
      this.options.notices.close(noticeKeys.offline, true);
      this.set({ stranded: true, retrying: false });
    });
  }

  private onNetwork(online: boolean): void {
    if (!online) {
      this.later('offline', timing.offlineAfter, () => {
        if (this.options.network.online() || !this.current.everConnected) return;
        if (this.current.phase === 'live' || this.current.phase === 'connecting') {
          this.set({ phase: 'offline', failure: 'network', talk: 'ready' });
          // Once per stretch offline, as in `fail`.
          if (!this.current.stranded && !this.timers.has('stranded')) {
            this.options.notices.post(offlineNotice());
            this.strandLater();
          }
        }
      });
      return;
    }
    this.clear('offline');
    if (this.current.phase !== 'offline') return;
    if (this.link === 'up') {
      this.clear('stranded');
      this.set({ phase: 'live', failure: null, stranded: false, retrying: false });
      this.options.notices.close(noticeKeys.offline);
      this.options.notices.post(backOnlineNotice());
    } else if (this.link === 'down') {
      this.attempts = 0;
      void this.connect(true);
    }
  }

  // The transport ------------------------------------------------------------------------------

  private onTransport(event: TransportEvent): void {
    // Only the service's answer about this very question means it has it (measured 25 Oct: 0.43–1.2 s
    // after the send). Its "listening", "thinking" and replies may still be the previous question's,
    // and so may an acknowledgement that names another question; the SDK's own echo is not the service.
    const sending = this.sending;
    if (
      sending &&
      (event.type === 'question-taken' || event.type === 'question-failed') &&
      (event.text === undefined || event.text.trim() === sending.question)
    )
      this.taken();
    switch (event.type) {
      case 'question-taken':
        return;
      case 'activity':
        this.onActivity(event.activity);
        return;
      case 'question':
        if (this.sending?.question === event.text.trim()) return;
        if (this.isTypedEcho(event.text)) return;
        if (transcript.isEcho(this.current.items, event.text)) return;
        this.set({
          items: transcript.ask(
            this.current.items,
            this.id(),
            event.text,
            'voice',
            this.now(),
            this.options.seeing(),
          ),
        });
        this.takeStill();
        return;
      case 'reply':
        // Words have come while thinking: their voice is on its way.
        if (event.text.trim() !== '' && this.current.talk === 'thinking') this.awaitingVoice = true;
        this.set({
          items: transcript.reply(
            this.current.items,
            this.id(),
            event.id,
            event.text,
            event.streaming,
            this.now(),
          ),
        });
        return;
      case 'no-reply':
        this.set({ items: transcript.settle(this.current.items) });
        return;
      case 'question-failed':
        this.set({ items: transcript.fail(this.current.items), talk: 'ready' });
        return;
      case 'quality':
        this.onQuality(event.quality === 'good');
        return;
      case 'reconnecting':
        this.link = 'reconnecting';
        this.later('silent', timing.silentReconnect, () => {
          if (this.current.phase !== 'live') return;
          this.set({ phase: 'connecting', slow: true });
          this.options.notices.post(connectingNotice(this.current.name));
        });
        return;
      case 'reconnected':
        this.link = 'up';
        this.clear('silent');
        this.options.notices.close(noticeKeys.connecting);
        if (this.current.phase === 'offline') {
          this.options.notices.close(noticeKeys.offline);
          this.options.notices.post(backOnlineNotice());
        }
        if (this.current.phase === 'connecting' || this.current.phase === 'offline') {
          this.clear('stranded');
          this.set({ phase: 'live', slow: false, failure: null, stranded: false, retrying: false });
        }
        return;
      case 'ended':
        // The link to the character left behind ends: the connect to the chosen one is on its way.
        if (this.current.switching) return;
        this.link = 'down';
        this.clear('silent');
        if (this.disposed || !this.current.everConnected) return;
        this.stopping = false;
        this.set({ items: transcript.stop(this.current.items), talk: 'ready' });
        if (this.options.network.online()) void this.connect(true);
        return;
      case 'vision-failed':
        // The sources say it: the session itself goes on.
        return;
    }
  }

  private onActivity(activity: Activity): void {
    const { talk, talkMode, microphone } = this.current;
    if (activity === 'idle') {
      this.stopping = false;
      // The text came before the voice: 2.0.1 reports idle for about half a second between them.
      // The capsule stays on Thinking for that gap rather than blink to Ready.
      if (this.awaitingVoice && talk === 'thinking') {
        this.later('speech', timing.voiceGap, () => {
          this.awaitingVoice = false;
          if (this.current.talk === 'thinking') this.set({ talk: 'ready' });
        });
        return;
      }
      if (talk !== 'held') this.set({ talk: 'ready' });
      return;
    }
    if (activity === 'speaking') {
      this.awaitingVoice = false;
      this.clear('speech');
    }
    if (this.stopping) return;
    if (activity === 'listening') {
      // A typed question makes the service report listening for a moment; only an open
      // microphone is listened to.
      const hearing = microphone === 'open' && (talkMode === 'hands-free' || talk === 'held');
      if (hearing && talk !== 'held') this.set({ talk: 'listening' });
      return;
    }
    if (talk === 'held') return;
    this.set({ talk: activity });
  }

  private onQuality(good: boolean): void {
    if (good === !this.current.weak) return;
    this.set({ weak: !good });
    if (good) this.options.notices.close(noticeKeys.weak);
    else this.options.notices.post(weakNotice());
  }

  // The microphone -----------------------------------------------------------------------------

  private async readPermission(): Promise<void> {
    if (this.current.microphone !== 'unknown') return;
    const permission = await this.options.transport.microphonePermission();
    // The person may have answered the ask while the browser was asked.
    if (this.microphone() !== 'unknown') return;
    if (permission === 'granted') {
      this.set({ microphone: 'ready' });
      if (this.current.talkMode === 'hands-free' && !this.current.muted) void this.openMicrophone();
    } else if (permission === 'denied') {
      // The site's settings keep it: talking says so at once rather than asking to no end.
      this.set({ microphone: 'blocked' });
    }
  }

  private async openMicrophone(): Promise<void> {
    const outcome = await this.options.transport.setMicrophone(true);
    if (outcome === 'on') {
      const stillWanted =
        !this.current.muted &&
        (this.current.talkMode === 'hands-free' || this.current.talk === 'held');
      if (!stillWanted) {
        await this.options.transport.setMicrophone(false);
        this.set({ microphone: 'ready' });
        return;
      }
      this.set({ microphone: 'open' });
      return;
    }
    if (this.current.talk === 'held') this.set({ talk: 'ready' });
    this.microphoneFailed(outcome);
  }

  private async closeMicrophone(): Promise<void> {
    if (this.current.microphone !== 'open') return;
    await this.options.transport.setMicrophone(false);
    if (this.microphone() === 'open') this.set({ microphone: 'ready' });
  }

  /** Read again after an await: `dispose()` may have run meanwhile. */
  private isDisposed(): boolean {
    return this.disposed;
  }

  /** The microphone's state now, read again after an await. */
  private microphone(): Microphone {
    return this.current.microphone;
  }

  /** Allow, or Try again on a microphone banner: open once to ask, then close until talking. */
  private async tryMicrophone(): Promise<void> {
    const outcome = await this.options.transport.setMicrophone(true);
    if (outcome !== 'on') {
      this.microphoneFailed(outcome);
      return;
    }
    const wanted = this.current.talkMode === 'hands-free' && !this.current.muted;
    if (!wanted) await this.options.transport.setMicrophone(false);
    const { notices } = this.options;
    notices.close(noticeKeys.micBlocked);
    notices.close(noticeKeys.micBusy);
    notices.close(noticeKeys.micNone);
    this.set({ microphone: wanted ? 'open' : 'ready' });
    notices.post(microphoneOnNotice());
  }

  private microphoneFailed(outcome: Exclude<MicrophoneOutcome, 'on'>): void {
    this.set({ microphone: outcome });
    this.postMicrophoneProblem(outcome);
  }

  private postMicrophoneProblem(problem: Exclude<MicrophoneOutcome, 'on'>): void {
    const { name } = this.current;
    const retry = {
      label: 'Try again',
      run: () => {
        this.allowMicrophone();
      },
    };
    const typeInstead = {
      label: 'Type instead',
      run: () => {
        this.typeInstead();
      },
    };
    const notice =
      problem === 'blocked'
        ? microphoneBlockedNotice(name, retry, typeInstead)
        : problem === 'busy'
          ? microphoneBusyNotice(name, retry, typeInstead)
          : microphoneMissingNotice(name, typeInstead);
    this.options.notices.post(notice);
  }

  // Plumbing -----------------------------------------------------------------------------------

  private set(change: Partial<SessionState>): void {
    if (this.sending && change.phase !== undefined && change.phase !== 'live') {
      this.sending = null;
      this.clear('send');
      change = { ...change, send: 'failed' };
    }
    const talkSince =
      change.talk !== undefined && change.talk !== this.current.talk
        ? this.now()
        : this.current.talkSince;
    const spokeUntil =
      this.current.talk === 'speaking' && change.talk !== undefined && change.talk !== 'speaking'
        ? this.now()
        : this.current.spokeUntil;
    this.current = { ...this.current, ...change, talkSince, spokeUntil };
    for (const listener of [...this.listeners]) listener();
  }

  private later(name: TimerName, ms: number, run: () => void): void {
    this.clear(name);
    this.timers.set(
      name,
      setTimeout(() => {
        this.timers.delete(name);
        if (!this.disposed) run();
      }, ms),
    );
  }

  private clear(name: TimerName): void {
    const timer = this.timers.get(name);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(name);
  }

  private id(): number {
    return this.nextId++;
  }

  private now(): number {
    return this.options.now();
  }
}

export function capsuleState(state: SessionState): CapsuleState | 'no-character' | null {
  switch (state.phase) {
    case 'loading':
    case 'failed':
      return null;
    case 'no-character':
      return 'no-character';
    case 'offline':
      return 'offline';
    case 'unavailable':
      return 'unavailable';
    case 'connecting':
      if (!state.everConnected) return null;
      if (state.slow) return 'connecting';
      break;
    case 'live':
      break;
  }
  if (state.talk === 'thinking' || state.talk === 'speaking') return state.talk;
  if (state.muted) return 'muted';
  return state.talk;
}

export type Overlay = 'boot' | 'connecting' | 'switching' | 'failed';

export function stageOverlay(
  state: Pick<SessionState, 'phase' | 'everConnected' | 'switching' | 'stranded' | 'retrying'>,
): Overlay | null {
  if (state.everConnected) {
    if (state.stranded)
      return state.retrying && state.phase === 'connecting' ? 'connecting' : 'failed';
    if (state.switching && state.phase === 'connecting') return 'switching';
    return null;
  }
  switch (state.phase) {
    case 'loading':
      return 'boot';
    case 'connecting':
      return 'connecting';
    case 'failed':
      return 'failed';
    default:
      return null;
  }
}
