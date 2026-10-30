export type MicrophoneTestState =
  | { phase: 'idle' }
  | { phase: 'recording'; left: number }
  | { phase: 'playing' }
  /** The microphone could not be opened, or the recording could not be played. */
  | { phase: 'failed' };

/** How long the test records. */
export const testSeconds = 3;

/** What the test needs of the browser, so tests can stand in for it. */
export interface RecorderMedia {
  open(deviceId: string | null): Promise<MediaStream>;
  /** Records `stream` for `ms` (less once `stop` aborts) and gives back what was heard. */
  record(stream: MediaStream, ms: number, stop: AbortSignal): Promise<Blob>;
  /** Plays `recording` once; resolves when it ended, or at once when `stop` aborts. */
  play(recording: Blob, stop: AbortSignal): Promise<void>;
}

export const browserRecorder: RecorderMedia = {
  open: (deviceId) =>
    navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    }),
  record: (stream, ms, stop) =>
    new Promise<Blob>((resolve, reject) => {
      const recorder = new MediaRecorder(stream);
      const parts: Blob[] = [];
      recorder.ondataavailable = (event) => {
        parts.push(event.data);
      };
      recorder.onstop = () => {
        resolve(new Blob(parts, { type: recorder.mimeType }));
      };
      recorder.onerror = () => {
        reject(new Error('The recording failed.'));
      };
      recorder.start();
      const end = () => {
        if (recorder.state !== 'inactive') recorder.stop();
      };
      setTimeout(end, ms);
      stop.addEventListener('abort', end);
    }),
  play: async (recording, stop) => {
    const url = URL.createObjectURL(recording);
    try {
      const audio = new Audio(url);
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          resolve();
        };
        audio.onerror = () => {
          reject(new Error('The recording could not be played.'));
        };
        stop.addEventListener('abort', () => {
          audio.pause();
          resolve();
        });
        audio.play().catch(reject);
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  },
};

export class MicrophoneTest {
  private current: MicrophoneTestState = { phase: 'idle' };
  private readonly listeners = new Set<() => void>();
  private readonly media: RecorderMedia;
  /** Each run's number: a run that was cancelled says nothing more. */
  private run = 0;
  private ticks: ReturnType<typeof setInterval> | undefined;
  private stopping = new AbortController();

  constructor(media: RecorderMedia) {
    this.media = media;
  }

  get state(): MicrophoneTestState {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get busy(): boolean {
    return this.current.phase === 'recording' || this.current.phase === 'playing';
  }

  /** Records and plays back from `deviceId` (null: the default). Resolves once it is idle again. */
  async start(deviceId: string | null): Promise<void> {
    if (this.busy) return;
    const run = ++this.run;
    const stopping = new AbortController();
    this.stopping = stopping;
    let stream: MediaStream;
    try {
      stream = await this.media.open(deviceId);
    } catch {
      if (run === this.run) this.set({ phase: 'failed' });
      return;
    }
    if (run !== this.run) {
      stop(stream);
      return;
    }
    let left = testSeconds;
    this.set({ phase: 'recording', left });
    this.ticks = setInterval(() => {
      left = Math.max(1, left - 1);
      if (run === this.run) this.set({ phase: 'recording', left });
    }, 1000);
    try {
      const recording = await this.media.record(stream, testSeconds * 1000, stopping.signal);
      clearInterval(this.ticks);
      stop(stream);
      if (run !== this.run) return;
      this.set({ phase: 'playing' });
      await this.media.play(recording, stopping.signal);
      if (run === this.run) this.set({ phase: 'idle' });
    } catch {
      clearInterval(this.ticks);
      stop(stream);
      if (run === this.run) this.set({ phase: 'failed' });
    }
  }

  /** Ends a run at once (Settings closed); what it would still say is dropped. */
  cancel(): void {
    this.run++;
    clearInterval(this.ticks);
    this.stopping.abort();
    if (this.current.phase !== 'idle') this.set({ phase: 'idle' });
  }

  private set(state: MicrophoneTestState): void {
    this.current = state;
    for (const listener of [...this.listeners]) listener();
  }
}

function stop(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
