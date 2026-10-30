import type { LevelSource } from '../kit/lens/voice';

/**
 * What the character is doing, as the transport reports it. `idle` is connected with nothing going
 * on; `listening` means the service hears the user speaking.
 */
export type Activity = 'idle' | 'listening' | 'thinking' | 'speaking';

/** How the network to the service is doing, from the transport's own measure. */
export type LinkQuality = 'good' | 'poor' | 'lost';

/** Why a connect failed: the network, or the service (credentials, quota, server). */
export type ConnectFailure = 'network' | 'service';

/** What opening the microphone came to. */
export type MicrophoneOutcome = 'on' | 'blocked' | 'busy' | 'none';

export type TransportEvent =
  | { type: 'activity'; activity: Activity }
  /** The user's question as the service took it: typed text, or the final words of speech. */
  | { type: 'question'; text: string }
  /** The reply so far; the same `id` grows until `streaming` is false. */
  | { type: 'reply'; id: string; text: string; streaming: boolean }
  /** The service declined to answer this turn on purpose. */
  | { type: 'no-reply' }
  /** The service took a typed question (its acknowledgement), named when the service names it. */
  | { type: 'question-taken'; text?: string }
  /** The service could not take a typed question, named when the service names it. */
  | { type: 'question-failed'; text?: string }
  | { type: 'quality'; quality: LinkQuality }
  /** The link dropped and the transport is trying to get it back by itself. */
  | { type: 'reconnecting' }
  | { type: 'reconnected' }
  /** The session ended without being asked to. */
  | { type: 'ended' }
  /** The shared picture could not be published again after a reconnect. */
  | { type: 'vision-failed' };

/** What the service is told a shared picture is: a camera, or a tab, window or screen. */
export type VisionKind = 'camera' | 'screen_share';

/** A picture the character sees. The transport never stops the track: its owner does. */
export interface VisionTrack {
  track: MediaStreamTrack;
  kind: VisionKind;
}

export interface ConnectOptions {
  token: string;
  characterId: string;
  endUserId?: string;
}

/**
 * One conversation with one character, over whatever carries it. The app's session model talks only
 * to this, so tests drive the model with a fake and the app uses the Convai SDK.
 */
export interface SessionTransport {
  /**
   * Starts loading what a connect needs, without connecting, so it arrives while the token is being
   * fetched. Safe to call any number of times; a transport with nothing to load leaves it out.
   */
  prepare?(): void;
  /** Resolves once the character can be talked to; rejects with a `TransportError`. */
  connect(options: ConnectOptions): Promise<void>;
  /** Ends the session; safe to call at any time, and more than once. */
  disconnect(): Promise<void>;
  /** Sends a typed question; false when it cannot leave (no link to the service). */
  sendText(text: string): boolean;
  /** Stops the reply being thought or spoken. */
  interrupt(): void;
  /** Opens or closes the microphone; the first open asks the browser for permission. */
  setMicrophone(open: boolean): Promise<MicrophoneOutcome>;
  /**
   * The microphone to hear from, by its device id, or null for the browser's default. Kept for every
   * later connect; an open microphone moves to it at once. Never opens the microphone.
   */
  setMicrophoneDevice(deviceId: string | null): Promise<void>;
  /** How loud the character's voice plays, 0 to 1; kept for every later connect. */
  setVolume(volume: number): void;
  /** The microphone's permission as far as the browser says without asking. */
  microphonePermission(): Promise<'granted' | 'denied' | 'prompt'>;
  /**
   * The picture the character sees from now on, published again after every reconnect; null sees
   * nothing. Resolves once it is published, or kept for the next connect while there is none;
   * rejects when publishing failed.
   */
  setVision(vision: VisionTrack | null): Promise<void>;
  /** The character's voice, for the Lens while it speaks. */
  readonly characterLevel: LevelSource;
  /** The user's voice, for the Lens while it listens. */
  readonly userLevel: LevelSource;
  subscribe(listener: (event: TransportEvent) => void): () => void;
}

/** A connect that failed, and why. */
export class TransportError extends Error {
  readonly failure: ConnectFailure;

  constructor(failure: ConnectFailure, message: string) {
    super(message);
    this.name = 'TransportError';
    this.failure = failure;
  }
}

/** A level that is always silent: no voice is flowing. */
export const silence: LevelSource = { sample: () => ({ level: 0, onset: false }) };
