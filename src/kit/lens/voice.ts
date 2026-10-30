export interface VoiceLevel {
  /** 0 to 1, the voice as it is now. */
  level: number;
  /** 0 to 1, the voice over the last phrase. */
  slow: number;
  /** True on the frame a syllable starts. */
  onset: boolean;
  /** Recent levels with their time, newest last, for echoes that lag the voice. */
  history: [time: number, level: number][];
}

/** Where a level comes from: a microphone, the character's audio, or the scripted demo speech. */
export interface LevelSource {
  /** The level at `now` (ms) and whether a syllable starts there. */
  sample(now: number): { level: number; onset: boolean };
}

export function createVoiceLevel(): VoiceLevel {
  return { level: 0, slow: 0, onset: false, history: [] };
}

/** Moves `voice` to the level `source` gives at `now`, `dt` seconds after the last step. */
export function stepVoice(
  voice: VoiceLevel,
  source: LevelSource | null,
  now: number,
  dt: number,
): void {
  const { level: target, onset } = source ? source.sample(now) : { level: 0, onset: false };
  const rate = target > voice.level ? dt / 0.035 : dt / 0.16;
  voice.level += (target - voice.level) * Math.min(1, rate);
  voice.onset = onset;
  voice.slow += (voice.level - voice.slow) * Math.min(1, dt / 0.38);
  voice.history.push([now, voice.level]);
  if (voice.history.length > 90) voice.history.shift();
}

/** The level `ms` milliseconds before `now`. */
export function delayedLevel(voice: VoiceLevel, ms: number, now: number): number {
  for (let i = voice.history.length - 1; i >= 0; i--) {
    const entry = voice.history[i];
    if (entry && entry[0] <= now - ms) return entry[1];
  }
  return 0;
}

interface Syllable {
  t0: number;
  dur: number;
  amp: number;
}

/**
 * Realistic speech for demos and the gallery: three sentences of phrases, words and syllables with
 * natural pauses and falling intonation, looping. The same seed always gives the same speech.
 */
export function scriptedSpeech(seed = 7): LevelSource {
  let state = seed;
  const random = () => (state = (state * 16807) % 2147483647) / 2147483647;
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const script: Syllable[] = [];
  let t = 0.6;
  for (let s = 0; s < 3; s++) {
    const phrases = 2 + Math.floor(random() * 2);
    for (let p = 0; p < phrases; p++) {
      const words = 2 + Math.floor(random() * 4);
      for (let w = 0; w < words; w++) {
        const syllables = 1 + Math.floor(random() * 3);
        const stress = Math.floor(random() * syllables);
        for (let y = 0; y < syllables; y++) {
          const dur = 0.11 + random() * 0.12 + (y === stress ? 0.05 : 0);
          const last = p === phrases - 1 && w === words - 1 ? 0.2 : 0;
          const amp = (y === stress ? 0.8 : 0.5) + random() * 0.2 - last;
          script.push({ t0: t, dur, amp: clamp(amp, 0.25, 1) });
          t += dur + 0.02 + random() * 0.03;
        }
        t += 0.05 + random() * 0.08;
      }
      t += p === phrases - 1 ? 0 : 0.32 + random() * 0.3;
    }
    t += 0.9 + random() * 0.6;
  }
  const loop = t + 0.8;
  let lastSyllable = -1;

  return {
    sample(now) {
      const time = (now / 1000) % loop;
      let level = 0;
      let index = -1;
      script.forEach((s, i) => {
        if (time < s.t0 - 0.02 || time > s.t0 + s.dur + 0.12) return;
        const u = time - s.t0;
        let envelope =
          u < 0.03
            ? u / 0.03
            : u < s.dur
              ? 1 - (0.25 * (u - 0.03)) / s.dur
              : Math.max(0, 1 - (u - s.dur) / 0.1);
        envelope *= 0.9 + 0.1 * Math.sin(u * 60);
        level = Math.max(level, envelope * s.amp);
        index = i;
      });
      const onset = index !== lastSyllable && index >= 0;
      if (onset) lastSyllable = index;
      return { level, onset };
    },
  };
}
