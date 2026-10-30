import { vi } from 'vitest';
import {
  silence,
  type ConnectOptions,
  type MicrophoneOutcome,
  type SessionTransport,
  type TransportEvent,
  type VisionTrack,
} from '../transport';

/**
 * A transport the tests drive by hand: `connect()` waits until the test settles it, and `emit()`
 * plays what the service would say. The sequences in session.test.ts follow a real session with
 * `@convai/web-sdk` 2.0.1 (recorded 23 October 2026).
 */
export class FakeTransport implements SessionTransport {
  readonly characterLevel = silence;
  readonly userLevel = silence;
  readonly sent: string[] = [];
  readonly connects: ConnectOptions[] = [];
  interrupts = 0;
  disconnects = 0;
  microphone: MicrophoneOutcome = 'on';
  permission: 'granted' | 'denied' | 'prompt' = 'prompt';
  readonly microphoneCalls: boolean[] = [];
  /** Every microphone chosen, in order; null is the browser's default. */
  readonly devices: (string | null)[] = [];
  /** Set to make the next `setMicrophoneDevice` reject, as a device the browser cannot open does. */
  deviceError: Error | null = null;
  volume = 1;
  /** Every picture handed over, in order; null is "see nothing". */
  readonly visions: (VisionTrack | null)[] = [];
  /** Set to make the next `setVision` with a picture reject. */
  visionError: Error | null = null;
  private pending: { resolve: () => void; reject: (error: unknown) => void } | null = null;
  private readonly listeners = new Set<(event: TransportEvent) => void>();

  prepare = vi.fn();

  connect = vi.fn((options: ConnectOptions) => {
    this.connects.push(options);
    return new Promise<void>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  });

  /** Lets the running `connect()` resolve. */
  async accept(): Promise<void> {
    this.pending?.resolve();
    this.pending = null;
    await flush();
  }

  /** Makes the running `connect()` reject. */
  async refuse(error: unknown): Promise<void> {
    this.pending?.reject(error);
    this.pending = null;
    await flush();
  }

  disconnect = vi.fn(() => {
    this.disconnects++;
    return Promise.resolve();
  });

  /**
   * How a typed question goes: `take` (the service acknowledges it at once), `hold` (nothing until
   * the test emits what the service says) or `drop` (it cannot leave: no link).
   */
  sends: 'take' | 'hold' | 'drop' = 'take';

  sendText(text: string): boolean {
    if (this.sends === 'drop') return false;
    this.sent.push(text);
    if (this.sends === 'take') this.emit({ type: 'question-taken', text });
    return true;
  }

  interrupt(): void {
    this.interrupts++;
  }

  setMicrophone(open: boolean): Promise<MicrophoneOutcome> {
    this.microphoneCalls.push(open);
    return Promise.resolve(open ? this.microphone : 'on');
  }

  microphonePermission(): Promise<'granted' | 'denied' | 'prompt'> {
    return Promise.resolve(this.permission);
  }

  setMicrophoneDevice(deviceId: string | null): Promise<void> {
    this.devices.push(deviceId);
    const error = this.deviceError;
    this.deviceError = null;
    return error ? Promise.reject(error) : Promise.resolve();
  }

  setVolume(volume: number): void {
    this.volume = volume;
  }

  setVision(vision: VisionTrack | null): Promise<void> {
    this.visions.push(vision);
    if (vision && this.visionError) {
      const error = this.visionError;
      this.visionError = null;
      return Promise.reject(error);
    }
    return Promise.resolve();
  }

  subscribe(listener: (event: TransportEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(...events: TransportEvent[]): void {
    for (const event of events) for (const listener of [...this.listeners]) listener(event);
  }
}

/** Lets pending promise callbacks run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
