import { useEffect, useRef, useState } from 'react';
import { useAnnouncement } from '../useAnnouncement';
import {
  createMemory,
  drawGlass,
  drawLoader,
  drawOuter,
  frameRate,
  mixStates,
  type LensDrawState,
  type LensFrame,
  type LensPalette,
} from './draw';
import { lensLabel, type LensState } from './lensLabel';
import { animate, followVoice, wake } from './loop';
import { readPalette } from './palette';
import type { LevelSource, VoiceLevel } from './voice';

export type LensSize = 96 | 72 | 64 | 56 | 48 | 44 | 40 | 32 | 16;

interface CanvasLens {
  size: number;
  pad: number;
  /** Device pixels across the canvas, a whole number. */
  pixels: number;
}

/**
 * Sizes the canvas: the Lens's own box plus 40 % on each side for the light that leaves the glass,
 * in whole device pixels at the screen's pixel ratio (at most 2).
 */
function setUp(canvas: HTMLCanvasElement, size: number, view: Window): CanvasLens {
  const pad = Math.round(size * 0.4);
  const css = size + 2 * pad;
  const pixels = Math.round(css * Math.min(2, view.devicePixelRatio || 1));
  canvas.width = canvas.height = pixels;
  canvas.style.width = canvas.style.height = `${String(css)}px`;
  canvas.style.left = canvas.style.top = `${String(-pad)}px`;
  return { size, pad, pixels };
}

/**
 * Starts drawing on the shared frame while mounted, as often as `rate` asks (frames a second;
 * every frame by default). A render (a new state), size, pixel ratio, palette or motion setting
 * draws on the next frame.
 */
function useLensCanvas(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, palette: LensPalette, frame: LensFrame) => void,
  source: LevelSource | undefined,
  rate: (reduceMotion: boolean) => number = () => Infinity,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  const rateRef = useRef(rate);
  useEffect(() => {
    drawRef.current = draw;
    rateRef.current = rate;
    // A resting or still Lens's loop may be waiting: what it draws may have changed.
    wake(canvasRef.current?.ownerDocument.defaultView ?? window);
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const view = canvas.ownerDocument.defaultView ?? window;
    let lens = setUp(canvas, size, view);
    let palette = readPalette(canvas);
    let reduceMotion = canvas.closest('.convai-reduce-motion') !== null;
    // When the canvas was last drawn; never when it must be drawn on the next frame whatever the
    // rate.
    let drawnAt = -Infinity;
    const changed = () => {
      drawnAt = -Infinity;
      wake(view);
    };

    // A theme, contrast or motion change on the theme's root applies at once.
    const root = canvas.closest('.convai-theme') ?? canvas.ownerDocument.documentElement;
    const watch = new MutationObserver(() => {
      palette = readPalette(canvas);
      reduceMotion = canvas.closest('.convai-reduce-motion') !== null;
      changed();
    });
    watch.observe(root, { attributes: true, attributeFilter: ['class', 'style'] });

    // Zoom or another screen changes the pixel ratio: the canvas is sized again, so it stays sharp.
    let resolution = view.matchMedia(`(resolution: ${String(view.devicePixelRatio)}dppx)`);
    const resize = () => {
      // Sizing the canvas clears it.
      lens = setUp(canvas, size, view);
      changed();
      resolution.removeEventListener('change', resize);
      resolution = view.matchMedia(`(resolution: ${String(view.devicePixelRatio)}dppx)`);
      resolution.addEventListener('change', resize);
    };
    resolution.addEventListener('change', resize);

    const silent: VoiceLevel = { level: 0, slow: 0, onset: false, history: [] };
    const [voice, release] = source ? followVoice(source, view) : [silent, () => undefined];
    const item = {
      visible: true,
      frame(now: number, dt: number) {
        // Every frame: 0 ms between draws; a still Lens: Infinity, until something changes.
        const every = 1000 / rateRef.current(reduceMotion);
        // 10 ms of slack: the loop's timer can bring a frame 8 ms early, and on a 60 Hz screen a
        // Lens resting at 15 a second still draws every 4th frame.
        // (Never drawn and still: -Infinity + Infinity is NaN, which no time is less than.)
        if (now < drawnAt + every - 10) return drawnAt + every - now;
        drawnAt = now;
        const k = lens.pixels / (lens.size + 2 * lens.pad) / (256 / lens.size);
        const offset = (lens.pad * lens.pixels) / (lens.size + 2 * lens.pad);
        const P = (lens.pad * 256) / lens.size;
        ctx.setTransform(k, 0, 0, k, offset, offset);
        ctx.clearRect(-P, -P, 256 + 2 * P, 256 + 2 * P);
        drawRef.current(ctx, palette, { now, dt, size: lens.size, voice, reduceMotion });
        return every;
      },
    };
    // The canvas's own window's observer: one from the tab never sees a canvas in the Compact
    // window intersect in Firefox, and the Lens would stand still there.
    const visibility = new (view as typeof globalThis).IntersectionObserver(
      (entries) => {
        for (const entry of entries) item.visible = entry.isIntersecting;
        // Off screen it was not drawn, and the loop may sleep with nothing else to draw.
        changed();
      },
      { rootMargin: '100px' },
    );
    visibility.observe(canvas);
    const stop = animate(item, view);
    return () => {
      stop();
      release();
      visibility.disconnect();
      watch.disconnect();
      resolution.removeEventListener('change', resize);
    };
  }, [size, source]);

  return canvasRef;
}

interface LensProps {
  /** The character's name: the Lens is read as the character, never as "orb" or "Lens". */
  name: string;
  state: LensState;
  size?: LensSize;
  /**
   * The voice the Lens follows while listening or speaking. Keep the same object across renders:
   * a new one starts the Lens's drawing again.
   */
  level?: LevelSource;
  /**
   * True where the Lens stands inside a control that names itself (the capsule's button): it is then
   * drawn only, with no name and no announcement of its own.
   */
  decorative?: boolean;
  /** The 10 warn dot at the lower right: the character is unavailable. */
  warning?: boolean;
  className?: string;
}

export function Lens({
  name,
  state,
  size = 64,
  level,
  decorative = false,
  warning = false,
  className,
}: LensProps) {
  const drawState: LensDrawState = state === 'offline' ? 'muted' : state;
  const [memory] = useState(() => createMemory(drawState));
  const label = lensLabel(name, state);
  const spoken = useAnnouncement(label);
  const canvasRef = useLensCanvas(
    size,
    (ctx, palette, frame) => {
      mixStates(memory, drawState, frame);
      ctx.save();
      drawOuter(ctx, palette, memory, frame);
      ctx.restore();
      drawGlass(ctx, palette, memory, frame);
    },
    level,
    (reduceMotion) => frameRate(memory, drawState, reduceMotion),
  );

  return (
    <>
      <span
        role={decorative ? undefined : 'img'}
        aria-label={decorative ? undefined : label}
        aria-hidden={decorative || undefined}
        className={['convai-lens', state === 'offline' && 'convai-lens--offline', className]
          .filter(Boolean)
          .join(' ')}
        style={{ ['--convai-lens-size' as string]: `${String(size)}px` }}
        data-state={state}
      >
        <canvas ref={canvasRef} className="convai-lens__canvas" aria-hidden="true" />
        {warning && <span className="convai-lens__warning" aria-hidden="true" />}
      </span>
      {!decorative && (
        <span className="convai-visually-hidden" role="status">
          {spoken}
        </span>
      )}
    </>
  );
}

export function LensLoader({ className }: { className?: string }) {
  const canvasRef = useLensCanvas(
    24,
    (ctx, palette, frame) => {
      drawLoader(ctx, palette, frame);
    },
    undefined,
  );
  return (
    <span
      className={['convai-lens', 'convai-lens--loader', className].filter(Boolean).join(' ')}
      style={{ ['--convai-lens-size' as string]: '24px' }}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="convai-lens__canvas" />
    </span>
  );
}
