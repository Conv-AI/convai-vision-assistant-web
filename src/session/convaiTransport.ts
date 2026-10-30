import { ConvaiClient, type ChatMessage, type ServerResponse } from '@convai/web-sdk/core';
import { AudioRenderer } from '@convai/web-sdk/vanilla';
import { LevelMeter, TrackLevel } from './levels';
import {
  TransportError,
  type Activity,
  type ConnectOptions,
  type MicrophoneOutcome,
  type SessionTransport,
  type TransportEvent,
  type VisionTrack,
} from './transport';

/** LiveKit's code for a disconnect the client asked for. */
const clientInitiated = 1;

/** The part of `ConvaiClient` this transport uses, so tests can stand in for it. */
export type ConvaiClientLike = Pick<
  ConvaiClient,
  | 'connect'
  | 'disconnect'
  | 'sendUserTextMessage'
  | 'sendInterruptMessage'
  | 'on'
  | 'room'
  | 'audioControls'
  | 'videoControls'
>;

export type ClientFactory = (
  config: ConstructorParameters<typeof ConvaiClient>[0],
) => ConvaiClientLike;

/** The SDK config for a session. `url` is left out, never undefined: 2.0.1 then dials `/connect`. */
export function clientConfig(options: ConnectOptions) {
  return {
    authToken: options.token,
    characterId: options.characterId,
    ...(options.endUserId ? { endUserId: options.endUserId } : {}),
    // The microphone opens on the first talk, so nobody is asked for it before they want to talk.
    startWithAudioOn: false,
    // The video channel carries what is shared; the SDK opens no camera of its own.
    enableVideo: true,
    startWithVideoOn: false,
  };
}

const activities: Record<string, Activity | undefined> = {
  connected: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
};

/** The events a chat message stands for; most message types are not the conversation's words. */
export function messageEvents(message: ChatMessage | undefined): TransportEvent[] {
  // 2.0.1 once emitted `message` with no payload during a reply.
  if (!message) return [];
  switch (message.type) {
    case 'user-llm-text':
      return message.content.trim() === '' ? [] : [{ type: 'question', text: message.content }];
    case 'user-transcription':
      return message.isStreaming === false && message.content.trim() !== ''
        ? [{ type: 'question', text: message.content }]
        : [];
    case 'bot-llm-text':
      return [
        {
          type: 'reply',
          id: message.id,
          text: message.content,
          streaming: message.isStreaming !== false,
        },
      ];
    case 'llm-no-response':
      return [{ type: 'no-reply' }];
    default:
      return [];
  }
}

/** A typed question the service could not take; one still on its way is not refused. */
export function isQuestionFailure(response: ServerResponse): boolean {
  return response.event_type === 'user_text_message' && response.status === 'error';
}

/** The service's acknowledgement of a typed question (measured 25 Oct, 0.43–1.2 s after it). */
export function isQuestionTaken(response: ServerResponse): boolean {
  return response.event_type === 'user_text_message' && response.status === 'success';
}

/** Why `connect()` failed: an unreachable network, or the service saying no. */
export function connectFailure(error: unknown, online: boolean): TransportError {
  if (!online || error instanceof TypeError) {
    return new TransportError('network', 'The network could not reach Convai.');
  }
  return new TransportError('service', 'Convai did not start the session.');
}

/** What a failed `getUserMedia` means for the person. */
export function microphoneFailure(error: unknown): MicrophoneOutcome {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'none';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'blocked';
}

/** The conversation over `@convai/web-sdk`: one `ConvaiClient` per connect. */
export class ConvaiTransport implements SessionTransport {
  readonly characterLevel = new TrackLevel();
  readonly userLevel: LevelMeter;

  private client: ConvaiClientLike | null = null;
  /** The client's connect has resolved: it can publish. */
  private ready = false;
  /** The picture wanted now; every connect publishes it again. */
  private vision: VisionTrack | null = null;
  /** Publishing runs one change at a time, in the order asked. */
  private visionWork: Promise<void> = Promise.resolve();
  private renderer: AudioRenderer | null = null;
  /** Where the SDK puts the character's `<audio>` elements, so their volume is ours to set. */
  private speakers: HTMLElement | null = null;
  /** The microphone chosen (null: the browser's default) and the voice's volume. */
  private device: string | null = null;
  private volume = 1;
  private stops: (() => void)[] = [];
  private readonly listeners = new Set<(event: TransportEvent) => void>();
  private readonly create: ClientFactory;

  constructor(create: ClientFactory = (config) => new ConvaiClient(config)) {
    this.create = create;
    this.userLevel = new LevelMeter(() =>
      this.client?.audioControls.isAudioMuted === false ? this.client.audioControls.audioLevel : 0,
    );
  }

  subscribe(listener: (event: TransportEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(options: ConnectOptions): Promise<void> {
    await this.disconnect();
    const client = this.create(clientConfig(options));
    this.client = client;
    this.listen(client);
    try {
      await client.connect();
    } catch (error) {
      await this.disconnect();
      throw connectFailure(error, navigator.onLine);
    }
    if (this.client !== client) return;
    this.ready = true;
    // A new client has published nothing: the picture shared before the break goes out again.
    if (this.vision) {
      this.applyVision(client, this.vision).catch(() => {
        this.emit({ type: 'vision-failed' });
      });
    }
    const speakers = this.speakerBox();
    this.renderer = new AudioRenderer(client.room, { container: speakers });
    // Each voice element the SDK adds plays at the chosen volume.
    const voices = new MutationObserver(() => {
      this.applyVolume();
    });
    voices.observe(speakers, { childList: true });
    this.stops.push(() => {
      voices.disconnect();
    });
    if (this.device !== null) {
      this.applyDevice(client).catch(() => undefined);
    }
    const room = client.room;
    const onReconnecting = () => {
      this.emit({ type: 'reconnecting' });
    };
    const onReconnected = () => {
      this.emit({ type: 'reconnected' });
    };
    const onQuality = (quality: unknown, participant: { isLocal: boolean }) => {
      if (!participant.isLocal) return;
      const value = String(quality);
      this.emit({
        type: 'quality',
        quality: value === 'poor' ? 'poor' : value === 'lost' ? 'lost' : 'good',
      });
    };
    room.on('reconnecting', onReconnecting);
    room.on('reconnected', onReconnected);
    room.on('connectionQualityChanged', onQuality);
    this.stops.push(() => {
      room.off('reconnecting', onReconnecting);
      room.off('reconnected', onReconnected);
      room.off('connectionQualityChanged', onQuality);
    });
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    // Cleared first: from here nothing is sent to the old client and nothing it says counts.
    this.client = null;
    this.ready = false;
    for (const stop of this.stops.splice(0)) stop();
    this.renderer?.destroy();
    this.renderer = null;
    this.characterLevel.detach();
    if (client) await client.disconnect().catch(() => undefined);
  }

  sendText(text: string): boolean {
    // 2.0.1 drops a message silently while its room is down: say so instead.
    const client = this.client;
    if (!client) return false;
    const room: string = client.room.state;
    if (room === 'disconnected') return false;
    client.sendUserTextMessage(text);
    return true;
  }

  interrupt(): void {
    this.client?.sendInterruptMessage();
  }

  async setMicrophone(open: boolean): Promise<MicrophoneOutcome> {
    const audio = this.client?.audioControls;
    if (!audio) return open ? 'blocked' : 'on';
    try {
      if (!open) {
        if (audio.isAudioEnabled && !audio.isAudioMuted) await audio.muteAudio();
        return 'on';
      }
      if (!audio.isAudioEnabled) await audio.enableAudio();
      if (audio.isAudioMuted) await audio.unmuteAudio();
      audio.startAudioLevelMonitoring();
      return 'on';
    } catch (error) {
      return microphoneFailure(error);
    }
  }

  async setMicrophoneDevice(deviceId: string | null): Promise<void> {
    this.device = deviceId;
    const client = this.client;
    if (client && this.ready) await this.applyDevice(client);
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyVolume();
  }

  /**
   * Moves the microphone to the chosen device. LiveKit keeps it as the default for the next time the
   * microphone opens, and moves an open one at once; unlike the SDK's `setAudioDevice`, it opens
   * nothing. The browser's default is asked for loosely: not every browser names it "default".
   */
  private async applyDevice(client: ConvaiClientLike): Promise<void> {
    const device = this.device;
    await client.room.switchActiveDevice('audioinput', device ?? 'default', device !== null);
  }

  private applyVolume(): void {
    for (const audio of this.speakers?.querySelectorAll('audio') ?? []) audio.volume = this.volume;
  }

  private speakerBox(): HTMLElement {
    if (!this.speakers) {
      this.speakers = document.createElement('div');
      this.speakers.hidden = true;
      document.body.append(this.speakers);
    }
    return this.speakers;
  }

  async microphonePermission(): Promise<'granted' | 'denied' | 'prompt'> {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' });
      return status.state;
    } catch {
      return 'prompt';
    }
  }

  setVision(vision: VisionTrack | null): Promise<void> {
    this.vision = vision;
    const client = this.client;
    if (!client || !this.ready) return Promise.resolve();
    return this.applyVision(client, vision);
  }

  /** Publishes `wanted` on `client` after the changes before it, unless a newer one replaced it. */
  private applyVision(client: ConvaiClientLike, wanted: VisionTrack | null): Promise<void> {
    const run = this.visionWork
      .catch(() => undefined)
      .then(async () => {
        if (this.client !== client || this.vision !== wanted) return;
        const video = client.videoControls;
        if (wanted) {
          // The track is the app's: it keeps the preview running after an unpublish.
          await video.publishVideoTrack(wanted.track, {
            source: wanted.kind,
            stopTrackOnUnpublish: false,
          });
        } else {
          await video.unpublishVisionSource();
        }
      });
    this.visionWork = run;
    return run;
  }

  private emit(event: TransportEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  private listen(client: ConvaiClientLike): void {
    const own = (handler: () => void) => {
      if (this.client === client) handler();
    };
    this.stops.push(
      client.on('stateChange', (state) => {
        own(() => {
          const activity = activities[state.agentState];
          if (activity) this.emit({ type: 'activity', activity });
        });
      }),
      client.on('message', (message) => {
        own(() => {
          for (const event of messageEvents(message)) this.emit(event);
        });
      }),
      client.on('serverResponse', (response) => {
        own(() => {
          // 2.0.1's answer names the question in `extras.text`.
          const text = response.extras?.text;
          const named = text === undefined ? {} : { text };
          if (isQuestionFailure(response)) this.emit({ type: 'question-failed', ...named });
          else if (isQuestionTaken(response)) this.emit({ type: 'question-taken', ...named });
        });
      }),
      // On LiveKit the voice arrives as `characterAudioTrack`; `botAudioTrack` is the WebSocket
      // transport's. Either feeds the Lens.
      client.on('characterAudioTrack', (event) => {
        own(() => {
          this.characterLevel.attach(event.track);
        });
      }),
      client.on('botAudioTrack', (track) => {
        own(() => {
          this.characterLevel.attach(track);
        });
      }),
      client.on('disconnect', (reason) => {
        own(() => {
          if (Number(reason) !== clientInitiated) this.emit({ type: 'ended' });
        });
      }),
    );
  }
}
