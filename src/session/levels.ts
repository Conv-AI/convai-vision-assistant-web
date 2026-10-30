import type { LevelSource } from '../kit/lens/voice';

/** Below this a voice counts as quiet; a syllable starts when the level rises past it. */
const quiet = 0.08;
/** Speech RMS rarely passes 0.25 of full scale; this maps it onto the Lens's 0 to 1. */
const gain = 4;

/** A level from an RMS reading of 0 to 1, with an onset on the rise out of quiet. */
export class LevelMeter implements LevelSource {
  private last = 0;
  private readonly read: () => number;

  constructor(read: () => number) {
    this.read = read;
  }

  sample(): { level: number; onset: boolean } {
    const level = Math.min(1, Math.max(0, this.read() * gain));
    const onset = this.last < quiet && level >= quiet;
    this.last = level;
    return { level, onset };
  }
}

/**
 * The level of a `MediaStreamTrack`, read through an `AnalyserNode`. It reads silence until a track
 * is attached, and again after `detach()`.
 */
export class TrackLevel implements LevelSource {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private node: MediaStreamAudioSourceNode | null = null;
  private buffer = new Float32Array(0);
  private readonly meter = new LevelMeter(() => this.rms());

  attach(track: MediaStreamTrack): void {
    this.detach();
    if (typeof AudioContext === 'undefined') return;
    this.context ??= new AudioContext();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 512;
    this.buffer = new Float32Array(this.analyser.fftSize);
    this.node = this.context.createMediaStreamSource(new MediaStream([track]));
    // The analyser only reads: nothing is connected to the speakers, the SDK plays the voice.
    this.node.connect(this.analyser);
    // A context made before the page had a click or a key starts suspended and reads silence.
    if (this.context.state === 'suspended') {
      const resume = () => void this.context?.resume();
      resume();
      window.addEventListener('pointerdown', resume, { once: true });
      window.addEventListener('keydown', resume, { once: true });
    }
  }

  detach(): void {
    this.node?.disconnect();
    this.node = null;
    this.analyser = null;
  }

  /** Detaches and closes the audio context; the level stays silent afterwards. */
  close(): void {
    this.detach();
    void this.context?.close();
    this.context = null;
  }

  sample(): { level: number; onset: boolean } {
    return this.meter.sample();
  }

  private rms(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buffer);
    let sum = 0;
    for (const value of this.buffer) sum += value * value;
    return Math.sqrt(sum / this.buffer.length);
  }
}
