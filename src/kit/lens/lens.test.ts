import { describe, expect, it } from 'vitest';
import {
  breathAmplitude,
  breathClock,
  createMemory,
  drawGlass,
  drawLoader,
  drawOuter,
  frameRate,
  mixStates,
  restingRate,
  spring,
  type LensDrawState,
  type LensFrame,
  type LensPalette,
} from './draw';
import { lensLabel, type LensState } from './lensLabel';
import {
  createVoiceLevel,
  delayedLevel,
  scriptedSpeech,
  stepVoice,
  type LevelSource,
} from './voice';

const frame = (now: number, reduceMotion = false): LensFrame => ({
  now,
  dt: 0.016,
  size: 64,
  voice: { level: 0, slow: 0 },
  reduceMotion,
});

describe('lensLabel', () => {
  it.each<[LensState, string]>([
    ['ready', 'Kira, ready'],
    ['listening', 'Kira, listening'],
    ['held', 'Kira, listening while you hold'],
    ['thinking', 'Kira, thinking'],
    ['speaking', 'Kira, speaking'],
    ['muted', 'Kira, muted. You can still type.'],
    ['connecting', 'Connecting to Kira'],
    ['offline', 'Kira, offline'],
  ])('reads %s as the character, never as the Lens', (state, label) => {
    expect(lensLabel('Kira', state)).toBe(label);
  });
});

describe('the voice level', () => {
  const steady = (level: number): LevelSource => ({ sample: () => ({ level, onset: false }) });

  it('rises in 35 ms and falls in 160 ms', () => {
    const voice = createVoiceLevel();
    stepVoice(voice, steady(1), 0, 0.035);
    expect(voice.level).toBe(1);
    stepVoice(voice, steady(0), 35, 0.08);
    expect(voice.level).toBeCloseTo(0.5, 6);
  });

  it('follows the phrase slowly, over 380 ms', () => {
    const voice = createVoiceLevel();
    stepVoice(voice, steady(1), 0, 0.038);
    expect(voice.slow).toBeCloseTo(0.1, 6);
  });

  it('remembers the recent levels for echoes that lag the voice', () => {
    const voice = createVoiceLevel();
    stepVoice(voice, steady(1), 0, 0.05);
    stepVoice(voice, steady(1), 100, 0.05);
    expect(delayedLevel(voice, 100, 100)).toBe(1);
    expect(delayedLevel(voice, 200, 100)).toBe(0);
  });

  it('gives the same scripted speech for the same seed, with pauses and syllable onsets', () => {
    const a = scriptedSpeech();
    const b = scriptedSpeech();
    const levels = Array.from({ length: 400 }, (_, i) => a.sample(i * 25));
    expect(levels).toEqual(Array.from({ length: 400 }, (_, i) => b.sample(i * 25)));
    expect(levels.some((s) => s.level === 0)).toBe(true);
    expect(Math.max(...levels.map((s) => s.level))).toBeLessThanOrEqual(1);
    expect(levels.filter((s) => s.onset).length).toBeGreaterThan(20);
  });
});

describe('state blending', () => {
  it('springs toward the new state, so a change is a morph, never a cut', () => {
    const memory = createMemory('ready');
    mixStates(memory, 'speaking', frame(0));
    expect(memory.mix.speaking).toBeGreaterThan(0);
    expect(memory.mix.speaking).toBeLessThan(0.1);
    for (let t = 16; t < 3000; t += 16) mixStates(memory, 'speaking', frame(t));
    expect(memory.mix.speaking).toBeCloseTo(1, 2);
    expect(memory.mix.ready).toBeCloseTo(0, 2);
  });

  it('eases over 250 ms under Reduce Motion, with no overshoot', () => {
    const memory = createMemory('ready');
    const seen: number[] = [];
    for (let t = 0; t <= 300; t += 25) {
      mixStates(memory, 'thinking', frame(1000 + t, true));
      seen.push(memory.mix.thinking);
    }
    expect(seen[0]).toBe(0);
    expect(seen[10]).toBe(1);
    expect(Math.max(...seen)).toBe(1);
    expect(seen.every((v, i) => i === 0 || v >= (seen[i - 1] ?? 0))).toBe(true);
  });

  it('settles a damped spring on its target', () => {
    const s = { x: 0, v: 0 };
    for (let i = 0; i < 300; i++) spring(s, 1, 1.1, 0.8, 0.016);
    expect(s.x).toBeCloseTo(1, 3);
  });
});

describe('how often the Lens needs drawing', () => {
  it('rests ready and muted at 15 a second once settled, and stills muted under Reduce Motion', () => {
    expect(frameRate(createMemory('ready'), 'ready', false)).toBe(restingRate);
    expect(frameRate(createMemory('ready'), 'ready', true)).toBe(restingRate);
    expect(frameRate(createMemory('muted'), 'muted', false)).toBe(restingRate);
    expect(frameRate(createMemory('muted'), 'muted', true)).toBe(0);
  });

  it('draws every frame for every other state', () => {
    for (const state of ['listening', 'held', 'thinking', 'connecting', 'speaking'] as const)
      expect(frameRate(createMemory(state), state, false)).toBe(Infinity);
  });

  it('draws every frame while a blend moves, until it settles', () => {
    const memory = createMemory('speaking');
    expect(frameRate(memory, 'ready', false)).toBe(Infinity);
    let t = 0;
    for (; t < 600; t += 16) mixStates(memory, 'ready', frame(t));
    expect(frameRate(memory, 'ready', false)).toBe(Infinity);
    for (; t < 6000; t += 16) mixStates(memory, 'ready', frame(t));
    expect(frameRate(memory, 'ready', false)).toBe(restingRate);
    // A spring still moving at its target is not settled.
    memory.springs.ready.v = 0.01;
    expect(frameRate(memory, 'ready', false)).toBe(Infinity);
  });
});

describe('the loader clock', () => {
  it('turns the arcs half a turn per 1.6 s breath, eased while it inhales', () => {
    expect(breathClock(0, false).th).toBe(0);
    expect(breathClock(800, false).th).toBeCloseTo(Math.PI, 6);
    expect(breathClock(1200, false).th).toBeCloseTo(Math.PI, 6);
    expect(breathClock(2400, false).th).toBeCloseTo(2 * Math.PI, 6);
  });

  it('stops the arcs under Reduce Motion and keeps the breath at half its amplitude', () => {
    for (const now of [0, 400, 800, 1200, 2400]) expect(breathClock(now, true).th).toBe(0);
    const breaths = [0, 400, 800, 1200].map((now) => breathClock(now, true).b);
    const full = [0, 400, 800, 1200].map((now) => breathClock(now, false).b);
    expect(Math.max(...breaths) - Math.min(...breaths)).toBeCloseTo(
      (Math.max(...full) - Math.min(...full)) / 2,
      6,
    );
  });
});

describe('the outer breath', () => {
  it('is drawn at half amplitude below 44 or under Reduce Motion, never less', () => {
    expect(breathAmplitude({ size: 64, reduceMotion: false })).toBe(1);
    expect(breathAmplitude({ size: 44, reduceMotion: false })).toBe(1);
    expect(breathAmplitude({ size: 32, reduceMotion: false })).toBe(0.5);
    expect(breathAmplitude({ size: 64, reduceMotion: true })).toBe(0.5);
    expect(breathAmplitude({ size: 32, reduceMotion: true })).toBe(0.5);
  });
});

/**
 * A canvas that keeps where things are drawn: each conic gradient's start angle (the glass's
 * gloss, the arcs, the thinking lobe), each radial gradient's centre (the glows) and each arc's
 * radius and ends. Colors and alphas are left out.
 */
function placesDrawn(draw: (ctx: CanvasRenderingContext2D) => void): number[] {
  const places: number[] = [];
  const gradient = { addColorStop: () => undefined };
  const ctx = new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === 'createConicGradient')
          return (angle: number) => {
            places.push(angle);
            return gradient;
          };
        if (name === 'createRadialGradient')
          return (x0: number, y0: number) => {
            places.push(x0, y0);
            return gradient;
          };
        if (name === 'createLinearGradient') return () => gradient;
        if (name === 'arc')
          return (_x: number, _y: number, r: number, a0: number, a1: number) => {
            places.push(r, a0, a1);
          };
        return () => undefined;
      },
      set: () => true,
    },
  ) as CanvasRenderingContext2D;
  draw(ctx);
  return places.map((n) => Math.round(n * 1e4) / 1e4);
}

const palette = new Proxy({}, { get: () => [120, 220, 180] }) as unknown as LensPalette;

function drawnAt(
  state: LensDrawState,
  now: number,
  reduceMotion: boolean,
  part: 'glass' | 'outer' | 'loader',
) {
  const memory = createMemory(state);
  const at: LensFrame = {
    now,
    dt: 0.016,
    size: 64,
    voice: { level: 0.4, slow: 0.4 },
    reduceMotion,
  };
  return placesDrawn((ctx) => {
    if (part === 'glass') drawGlass(ctx, palette, memory, at);
    else if (part === 'outer') drawOuter(ctx, palette, memory, at);
    else drawLoader(ctx, palette, at);
  });
}

describe('what moves under Reduce Motion', () => {
  it.each<[string, LensDrawState, 'glass' | 'outer' | 'loader']>([
    ['the glass, its arcs and the thinking lobe and glow', 'thinking', 'glass'],
    ['the glass and arcs while ready', 'ready', 'glass'],
    ['the listening rings', 'listening', 'outer'],
    ['the loader’s glass', 'connecting', 'loader'],
  ])('holds %s in place, which turn or travel with motion', (_what, state, part) => {
    // One breath (1.6 s) apart: what the breath sizes is drawn the same, what turns is not.
    expect(drawnAt(state, 2600, true, part)).toEqual(drawnAt(state, 1000, true, part));
    expect(drawnAt(state, 2600, false, part)).not.toEqual(drawnAt(state, 1000, false, part));
  });
});
