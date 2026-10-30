/**
 * The Lens drawing, ported from the design's `lens-speak.js` (production variant "system" and the
 * loader "ld-sweepbreath"). Everything is drawn in a 256 × 256 space centred on the glass; the
 * component scales it to the Lens's size. Theme colors come in as a palette read from the tokens;
 * the only fixed colors are the glass's white highlights and black shade, which are light, not theme.
 */

export type Rgb = [number, number, number];

export interface LensPalette {
  green: Rgb;
  mint: Rgb;
  mintWhite: Rgb;
  inkMuted: Rgb;
  glassInner: Rgb;
  glassMid: Rgb;
  glassOuter: Rgb;
  rim: Rgb;
}

export const lensStates = [
  'ready',
  'listening',
  'held',
  'thinking',
  'connecting',
  'speaking',
  'muted',
] as const;
export type LensDrawState = (typeof lensStates)[number];

/** A damped spring's position and speed. */
export interface Spring {
  x: number;
  v: number;
}

/** What one Lens remembers between frames. */
export interface LensMemory {
  mix: Record<LensDrawState, number>;
  springs: Record<LensDrawState, Spring>;
  /** Reduce Motion: where each state's ease started, and from what weight. */
  eases: Record<LensDrawState, { from: number; target: number; start: number }>;
  breathFast: Spring;
  breathSlow: Spring;
}

/** The voice as the drawing reads it this frame. */
export interface LensVoice {
  level: number;
  slow: number;
}

export interface LensFrame {
  now: number;
  dt: number;
  size: number;
  voice: LensVoice;
  reduceMotion: boolean;
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const paint = (c: Rgb, a: number) =>
  `rgb(${String(c[0] | 0)} ${String(c[1] | 0)} ${String(c[2] | 0)} / ${String(clamp(a, 0, 1))})`;
const mix = (a: Rgb, b: Rgb, k: number): Rgb => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];

export function createMemory(state: LensDrawState): LensMemory {
  const record = <T>(make: (s: LensDrawState) => T) =>
    Object.fromEntries(lensStates.map((s) => [s, make(s)])) as Record<LensDrawState, T>;
  return {
    mix: record((s) => (s === state ? 1 : 0)),
    springs: record((s) => ({ x: s === state ? 1 : 0, v: 0 })),
    eases: record((s) => ({ from: s === state ? 1 : 0, target: s === state ? 1 : 0, start: 0 })),
    breathFast: { x: 0, v: 0 },
    breathSlow: { x: 0, v: 0 },
  };
}

/** A damped spring of frequency `f` (Hz) and damping `z`, moved `dt` seconds toward `target`. */
export function spring(s: Spring, target: number, f: number, z: number, dt: number): number {
  const w = 2 * Math.PI * f;
  const n = Math.max(1, Math.ceil(dt / 0.008));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (-w * w * (s.x - target) - 2 * z * w * s.v) * h;
    s.x += s.v * h;
  }
  return s.x;
}

export const reducedBlendMs = 250;

export function mixStates(memory: LensMemory, state: LensDrawState, frame: LensFrame): void {
  for (const s of lensStates) {
    const target = s === state ? 1 : 0;
    const ease = memory.eases[s];
    const springState = memory.springs[s];
    if (frame.reduceMotion) {
      if (ease.target !== target) {
        ease.from = memory.mix[s];
        ease.target = target;
        ease.start = frame.now;
      }
      const k = clamp((frame.now - ease.start) / reducedBlendMs, 0, 1);
      memory.mix[s] = ease.from + (target - ease.from) * (1 - (1 - k) * (1 - k));
      springState.x = memory.mix[s];
      springState.v = 0;
    } else {
      memory.mix[s] = clamp(spring(springState, target, 1.1, 0.8, frame.dt), 0, 1);
      ease.from = memory.mix[s];
      ease.target = target;
      ease.start = frame.now;
    }
  }
}

/**
 * How often a resting Lens is drawn. Measured with `lens-steps.mjs` at 16 to 96: the largest step
 * between two drawn frames is the same as at 60 a second (its rim's edge), so it looks the same.
 */
export const restingRate = 15;

/**
 * Frames a second the Lens needs to look the same: every frame while it moves or blends; 15 while
 * it rests ready or muted, whose breath and rim drift slowly; none for a muted Lens under Reduce
 * Motion, which is still.
 */
export function frameRate(memory: LensMemory, state: LensDrawState, reduceMotion: boolean): number {
  const moving = lensStates.some(
    (s) => Math.abs(memory.mix[s] - (s === state ? 1 : 0)) + Math.abs(memory.springs[s].v) > 1e-3,
  );
  if (moving || (state !== 'ready' && state !== 'muted')) return Infinity;
  return state === 'muted' && reduceMotion ? 0 : restingRate;
}

function glass(ctx: CanvasRenderingContext2D, p: LensPalette, size: number, rotation: number) {
  const g = ctx.createRadialGradient(97, 66, 0, 128, 128, 150);
  g.addColorStop(0, paint(p.glassInner, 1));
  g.addColorStop(0.42, paint(p.glassMid, 1));
  g.addColorStop(1, paint(p.glassOuter, 1));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(128, 128, 128, 0, 7);
  ctx.fill();
  const sw = ((size >= 96 ? 2 : size >= 56 ? 1.5 : 1.25) * 256) / size;
  ctx.lineWidth = sw;
  ctx.strokeStyle = paint(p.rim, 1);
  ctx.beginPath();
  ctx.arc(128, 128, 128 - sw / 2, 0, 7);
  ctx.stroke();
  const c = ctx.createConicGradient(-0.7 + rotation, 128, 128);
  c.addColorStop(0, paint(WHITE, 0.75));
  c.addColorStop(0.1, paint(WHITE, 0.18));
  c.addColorStop(0.4, paint(WHITE, 0.02));
  c.addColorStop(0.54, paint(WHITE, 0.45));
  c.addColorStop(0.66, paint(WHITE, 0.08));
  c.addColorStop(1, paint(WHITE, 0.75));
  ctx.strokeStyle = c;
  ctx.lineWidth = sw * 0.7;
  ctx.beginPath();
  ctx.arc(128, 128, 128 - sw / 2, 0, 7);
  ctx.stroke();
  return sw;
}

function arcs(
  ctx: CanvasRenderingContext2D,
  sw: number,
  widthDeg: number,
  alpha: number,
  col: Rgb,
) {
  const r = 128 - sw / 2;
  const d = Math.PI / 180;
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';
  for (const c of [95, 275]) {
    const a0 = (c - widthDeg / 2 - 90) * d;
    const a1 = (c + widthDeg / 2 - 90) * d;
    const g = ctx.createConicGradient(a0, 128, 128);
    const span = (a1 - a0) / (2 * Math.PI);
    g.addColorStop(0, paint(col, 0));
    g.addColorStop(span * 0.5, paint(col, alpha));
    g.addColorStop(span, paint(col, 0));
    g.addColorStop(1, paint(col, 0));
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.arc(128, 128, r, a0, a1);
    ctx.stroke();
  }
}

function glow(ctx: CanvasRenderingContext2D, r: number, a: number, col: Rgb, x = 128, y = 128) {
  if (a <= 0.002) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, paint(col, a));
  g.addColorStop(0.6, paint(col, a * 0.3));
  g.addColorStop(1, paint(col, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
}

interface Ink {
  ink: Rgb;
  a: number;
}

/** The Convai mark: a light pair and a dark pair of rounded squares. */
function mark(
  ctx: CanvasRenderingContext2D,
  p: LensPalette,
  k: number,
  light: Ink,
  dark: Ink,
  glowPx: number,
  glowA: number,
) {
  ctx.save();
  ctx.translate(128, 128);
  ctx.scale(k, k);
  ctx.translate(-129, -130);
  if (glowPx) {
    ctx.shadowColor = paint(p.green, glowA);
    ctx.shadowBlur = glowPx;
  }
  ctx.fillStyle = paint(light.ink, light.a);
  ctx.beginPath();
  ctx.roundRect(52, 24, 76, 76, 9);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(2, 100, 52, 52, 7);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(42, 100);
  ctx.quadraticCurveTo(52, 100, 52, 90);
  ctx.lineTo(52, 100);
  ctx.closePath();
  ctx.moveTo(54, 110);
  ctx.quadraticCurveTo(54, 100, 64, 100);
  ctx.lineTo(54, 100);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = paint(dark.ink, dark.a);
  ctx.beginPath();
  ctx.roundRect(84, 128, 108, 108, 10);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(182, 54, 74, 74, 8);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(172, 128);
  ctx.quadraticCurveTo(182, 128, 182, 118);
  ctx.lineTo(182, 128);
  ctx.closePath();
  ctx.moveTo(192, 138);
  ctx.quadraticCurveTo(192, 128, 202, 128);
  ctx.lineTo(192, 128);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function gloss(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 8, 0, 128);
  g.addColorStop(0, paint(WHITE, 0.12));
  g.addColorStop(1, paint(WHITE, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(128, 70, 108, 62, 0, 0, 7);
  ctx.fill();
  const s = ctx.createRadialGradient(128, 128, 96, 128, 128, 128);
  s.addColorStop(0, paint(BLACK, 0));
  s.addColorStop(1, paint(BLACK, 0.5));
  ctx.fillStyle = s;
  ctx.fillRect(0, 0, 256, 256);
}

function lobe(
  ctx: CanvasRenderingContext2D,
  p: LensPalette,
  sw: number,
  angle: number,
  alpha: number,
  spread: number,
) {
  const r = 128 - sw / 2;
  const d = Math.PI / 180;
  const g = ctx.createConicGradient(angle, 128, 128);
  const sp = (spread * d) / (2 * Math.PI);
  g.addColorStop(0, paint(p.mintWhite, 0));
  g.addColorStop(sp * 0.65, paint(p.mintWhite, alpha));
  g.addColorStop(sp, paint(p.mintWhite, 0));
  g.addColorStop(1, paint(p.mintWhite, 0));
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';
  ctx.strokeStyle = g;
  ctx.beginPath();
  ctx.arc(128, 128, r, angle, angle + spread * d);
  ctx.stroke();
}

const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export interface BreathClock {
  c: number;
  b: number;
  th: number;
  v: number;
}

/**
 * The loader's one clock (period 1.6 s): the mark flares and the arcs make an eased half turn while
 * it inhales, then rest and narrow while it exhales. Under Reduce Motion the arcs stop turning and
 * the breath keeps half its amplitude.
 */
export function breathClock(now: number, reduceMotion: boolean): BreathClock {
  const t = now / 1000;
  const c = (t % 1.6) / 1.6;
  const b = 0.5 - 0.5 * Math.cos(c * 2 * Math.PI);
  if (reduceMotion) return { c, b: 0.25 + b * 0.5, th: 0, v: 0 };
  const u = c < 0.5 ? easeInOutCubic(c * 2) : 1;
  return {
    c,
    b,
    th: u * Math.PI + Math.floor(t / 1.6) * Math.PI,
    v: c < 0.5 ? Math.sin(c * 2 * Math.PI) : 0,
  };
}

function drawSweep(
  ctx: CanvasRenderingContext2D,
  p: LensPalette,
  sw: number,
  k: BreathClock,
  alpha: number,
) {
  const d = Math.PI / 180;
  const r = 128 - sw / 2;
  const w = (34 + 26 * k.b) * d;
  const tail = k.v * 70 * d;
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';
  for (const cd of [95, 275]) {
    const a0 = (cd - 90) * d + k.th - w / 2;
    const g = ctx.createConicGradient(a0 - tail, 128, 128);
    const T = (tail + w) / (2 * Math.PI);
    const sp = w / (2 * Math.PI);
    g.addColorStop(0, paint(p.green, 0));
    g.addColorStop(T - sp * 0.5, paint(mix(p.green, p.mint, k.b * 0.6), 0.95 * alpha));
    g.addColorStop(T, paint(p.green, 0));
    g.addColorStop(1, paint(p.green, 0));
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.arc(128, 128, r, a0 - tail, a0 + w);
    ctx.stroke();
  }
}

function drawBreathMark(ctx: CanvasRenderingContext2D, p: LensPalette, k: BreathClock) {
  const b = k.b;
  glow(ctx, 62 + b * 16, 0.12 + b * 0.22, p.green);
  mark(
    ctx,
    p,
    0.46,
    { ink: mix(p.mint, p.mintWhite, b * 0.5), a: 0.22 + b * 0.5 },
    { ink: mix(p.mint, p.mintWhite, b * 0.7), a: 0.55 + b * 0.45 },
    4 + b * 14,
    0.25 + b * 0.45,
  );
}

function drawBreathOuter(
  ctx: CanvasRenderingContext2D,
  p: LensPalette,
  k: BreathClock,
  alpha: number,
) {
  const b = k.b;
  if (alpha * b < 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const R = 134 + b * 26;
  const g = ctx.createRadialGradient(128, 128, 120, 128, 128, R);
  g.addColorStop(0, paint(p.mint, alpha * b * 0.28));
  g.addColorStop(0.6, paint(p.green, alpha * b * 0.08));
  g.addColorStop(1, paint(p.green, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-92, -92, 440, 440);
  ctx.restore();
}

/** Speaking's outer breath: mint near the glass (fast), green far out (slow), additive. */
function speakingBreath(
  ctx: CanvasRenderingContext2D,
  p: LensPalette,
  memory: LensMemory,
  frame: LensFrame,
  weight: number,
  amplitude: number,
) {
  if (weight < 0.01) return;
  const level = frame.voice.level * weight;
  const A = spring(memory.breathFast, level, 4.5, 0.62, frame.dt) * amplitude;
  const B = spring(memory.breathSlow, frame.voice.slow * weight, 1.6, 0.9, frame.dt) * amplitude;
  const br = 0.5 + 0.5 * Math.sin((frame.now / 1000) * 1.9);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const R2 = 150 + br * 6 + B * 56 + A * 22;
  let g = ctx.createRadialGradient(128, 128, 116, 128, 128, R2);
  g.addColorStop(0, paint(p.green, weight * (0.06 + 0.04 * br + B * 0.32)));
  g.addColorStop(0.45, paint(p.green, weight * (0.03 + B * 0.14)));
  g.addColorStop(1, paint(p.green, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-92, -92, 440, 440);
  const R1 = 134 + A * 30;
  g = ctx.createRadialGradient(128, 128, 122, 128, 128, R1);
  g.addColorStop(0, paint(p.mint, weight * (0.05 + A * 0.45)));
  g.addColorStop(0.6, paint(p.mint, weight * A * 0.12));
  g.addColorStop(1, paint(p.mint, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-92, -92, 440, 440);
  ctx.restore();
}

export function breathAmplitude(frame: Pick<LensFrame, 'size' | 'reduceMotion'>): number {
  return frame.size < 44 || frame.reduceMotion ? 0.5 : 1;
}

/** Everything outside the glass: speaking's breath, connecting's breath, listening's gathering rings. */
export function drawOuter(
  ctx: CanvasRenderingContext2D,
  p: LensPalette,
  memory: LensMemory,
  frame: LensFrame,
) {
  const m = memory.mix;
  const amplitude = breathAmplitude(frame);
  speakingBreath(ctx, p, memory, frame, m.speaking, amplitude);
  // The connecting clock keeps half its breath under Reduce Motion itself; here only the size halves it.
  if (m.connecting > 0.01) {
    const k = breathClock(frame.now, frame.reduceMotion);
    drawBreathOuter(ctx, p, k, m.connecting * (frame.size < 44 ? 0.5 : 1));
  }
  const live = m.listening + m.held;
  if (live > 0.01) {
    // Light gathering into the glass: rings travel inward, brightening as they arrive.
    const t = frame.now / 1000;
    const U = frame.voice.level;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) {
      const ph = frame.reduceMotion ? (i + 1) / 4 : (t * 0.7 + i / 3) % 1;
      const r = 174 - ph * 46;
      const a = live * (0.05 + U * 0.45) * Math.sin(ph * Math.PI) * (0.3 + 0.7 * ph) * amplitude;
      ctx.shadowColor = paint(p.green, a);
      ctx.shadowBlur = 12;
      ctx.strokeStyle = paint(p.green, a * 0.8);
      ctx.beginPath();
      ctx.arc(128, 128, r, 0, 7);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** The glass and everything in it, clipped to the circle. */
export function drawGlass(
  ctx: CanvasRenderingContext2D,
  p: LensPalette,
  memory: LensMemory,
  frame: LensFrame,
) {
  const m = memory.mix;
  const t = frame.now / 1000;
  const calm = frame.reduceMotion ? 0.5 : 1;
  const U = frame.voice.level;
  const br =
    (0.5 + 0.3 * Math.sin((t * 2 * Math.PI) / 4.5) + 0.2 * Math.sin((t * 2 * Math.PI) / 7.3 + 1)) *
    calm;
  const live = m.listening + m.held;
  const work = m.thinking;
  const S = m.speaking;
  const sp = U * S;

  ctx.save();
  ctx.beginPath();
  ctx.arc(128, 128, 128, 0, 7);
  ctx.clip();
  const sw = glass(ctx, p, frame.size, frame.reduceMotion ? 0 : Math.sin(t * 0.27) * 0.05);

  if (m.muted > 0.01) {
    ctx.fillStyle = paint(BLACK, m.muted * 0.3);
    ctx.fillRect(0, 0, 256, 256);
  }
  if (work > 0.01) {
    const x = frame.reduceMotion ? 128 : 128 + Math.sin(t * 0.7) * 46 * Math.cos(t * 0.23);
    const y = frame.reduceMotion ? 128 : 128 + Math.sin(t * 1.1 + 1.7) * 42;
    glow(ctx, 80, work * (0.3 + 0.08 * Math.sin(t * 2.3) * calm), p.mintWhite, x, y);
  }
  const kb = breathClock(frame.now, frame.reduceMotion);
  glow(
    ctx,
    70 + sp * 40 + live * U * 16 + m.connecting * kb.b * 16,
    m.ready * (0.1 + 0.12 * br) +
      live * (0.2 + U * 0.3) +
      S * (0.22 + U * 0.5) +
      work * 0.06 +
      m.connecting * (0.12 + kb.b * 0.22),
    mix(p.green, p.mintWhite, work),
  );
  arcs(
    ctx,
    sw,
    40 + m.held * 30 + live * U * 8,
    m.ready * 0.5 + live + S * 0.95 + m.muted * 0.12,
    p.green,
  );
  if (work > 0.01) {
    const angle = frame.reduceMotion ? -Math.PI / 2 : (t * 2 * Math.PI) / 1.6;
    lobe(ctx, p, sw, angle, work * 0.9, 110);
  }
  const cw = m.connecting;
  const b = kb.b * cw;
  if (cw > 0.01) drawSweep(ctx, p, sw, kb, cw);
  const ink = mix(
    mix(mix(p.mint, p.mintWhite, m.thinking), p.mintWhite, b * 0.6),
    p.inkMuted,
    m.muted,
  );
  ctx.globalAlpha = clamp(1 - m.ready * 0.22 - m.muted * 0.35, 0, 1);
  mark(
    ctx,
    p,
    0.46,
    { ink, a: 0.45 + sp * 0.25 + cw * (-0.23 + kb.b * 0.5) },
    { ink, a: 1 - cw * 0.45 * (1 - kb.b) },
    6 + sp * 10 + b * 10,
    0.35 * (1 - m.muted) + sp * 0.35 + b * 0.35,
  );
  ctx.globalAlpha = 1;
  gloss(ctx);
  ctx.restore();
}

/** The 24 px loader: Connecting's motion with no states. */
export function drawLoader(ctx: CanvasRenderingContext2D, p: LensPalette, frame: LensFrame) {
  const k = breathClock(frame.now, frame.reduceMotion);
  // The loader is under 44: its outer breath is drawn at half amplitude too.
  drawBreathOuter(ctx, p, k, 0.5);
  ctx.save();
  ctx.beginPath();
  ctx.arc(128, 128, 128, 0, 7);
  ctx.clip();
  const turn = frame.reduceMotion ? 0 : Math.sin((frame.now / 1000) * 0.27) * 0.05;
  const sw = glass(ctx, p, frame.size, turn);
  drawSweep(ctx, p, sw, k, 1);
  drawBreathMark(ctx, p, k);
  gloss(ctx);
  ctx.restore();
}
