import type { LevelSource } from '../kit/lens/voice';
import {
  silence,
  type ConnectOptions,
  type MicrophoneOutcome,
  type SessionTransport,
  type TransportEvent,
  type VisionTrack,
} from './transport';

/**
 * A transport that loads its implementation on the first connect. The window paints and shows the
 * launch state without the SDK and its WebRTC stack, which arrive while the character wakes up.
 */
export class LazyTransport implements SessionTransport {
  private inner: SessionTransport | null = null;
  private loading: Promise<SessionTransport> | null = null;
  /** A picture chosen before the SDK arrived, handed to it once it does. */
  private vision: VisionTrack | null = null;
  /** The microphone and the volume chosen before the SDK arrived. */
  private device: string | null = null;
  private volume = 1;
  private readonly listeners = new Set<(event: TransportEvent) => void>();
  private readonly load: () => Promise<SessionTransport>;

  readonly characterLevel: LevelSource = {
    sample: (now) => (this.inner ?? { characterLevel: silence }).characterLevel.sample(now),
  };
  readonly userLevel: LevelSource = {
    sample: (now) => (this.inner ?? { userLevel: silence }).userLevel.sample(now),
  };

  constructor(load: () => Promise<SessionTransport>) {
    this.load = load;
  }

  private ready(): Promise<SessionTransport> {
    this.loading ??= this.load().then((inner) => {
      this.inner = inner;
      if (this.vision) void inner.setVision(this.vision);
      if (this.device !== null) void inner.setMicrophoneDevice(this.device);
      inner.setVolume(this.volume);
      inner.subscribe((event) => {
        for (const listener of [...this.listeners]) listener(event);
      });
      return inner;
    });
    return this.loading;
  }

  prepare(): void {
    // A load that fails is said by the connect that waits for it.
    this.ready().catch(() => undefined);
  }

  async connect(options: ConnectOptions): Promise<void> {
    await (await this.ready()).connect(options);
  }

  async disconnect(): Promise<void> {
    await this.inner?.disconnect();
  }

  sendText(text: string): boolean {
    return this.inner?.sendText(text) ?? false;
  }

  interrupt(): void {
    this.inner?.interrupt();
  }

  async setMicrophone(open: boolean): Promise<MicrophoneOutcome> {
    if (!this.inner) return open ? 'blocked' : 'on';
    return this.inner.setMicrophone(open);
  }

  async setMicrophoneDevice(deviceId: string | null): Promise<void> {
    this.device = deviceId;
    await this.inner?.setMicrophoneDevice(deviceId);
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.inner?.setVolume(volume);
  }

  async microphonePermission(): Promise<'granted' | 'denied' | 'prompt'> {
    return this.inner ? this.inner.microphonePermission() : 'prompt';
  }

  async setVision(vision: VisionTrack | null): Promise<void> {
    this.vision = vision;
    await this.inner?.setVision(vision);
  }

  subscribe(listener: (event: TransportEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
