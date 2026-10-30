import { createVoiceLevel, stepVoice, type LevelSource, type VoiceLevel } from './voice';

/** Something drawn on the shared animation frame. */
export interface Animated {
  /** False while it is off screen: it is not drawn then. */
  visible: boolean;
  /**
   * Draws `now`; returns how many milliseconds it can wait for its next frame (0: the next one;
   * Infinity: until something wakes the loop).
   */
  frame(now: number, dt: number): number;
}

/** The window a loop runs on: its own animation frame, which a hidden tab's frame does not stop. */
export type FrameWindow = Pick<Window, 'requestAnimationFrame' | 'setTimeout' | 'clearTimeout'>;

interface Loop {
  animated: Set<Animated>;
  voices: Map<LevelSource, { voice: VoiceLevel; followers: number }>;
  /** The timer that asks for a later frame. */
  timer?: number;
  last: number;
}

const loops = new Map<FrameWindow, Loop>();

function loopOf(view: FrameWindow): Loop {
  let loop = loops.get(view);
  if (!loop) {
    loop = { animated: new Set(), voices: new Map(), last: 0 };
    loops.set(view, loop);
  }
  return loop;
}

/**
 * Asks for a frame in `wait` milliseconds instead of any asked before: the next frame when it is
 * that close, or a timer that ends half a frame early, so the frame comes about on time.
 */
function later(view: FrameWindow, loop: Loop, wait: number) {
  view.clearTimeout(loop.timer);
  const next = () =>
    view.requestAnimationFrame((now) => {
      // Asked twice for one frame (woken while a frame was asked for): it runs once.
      if (now === loop.last) return;
      // As the design's loop: the first frame after a pause steps at most 50 ms.
      const dt = Math.min(0.05, (now - loop.last) / 1000 || 0.016);
      loop.last = now;
      for (const [source, { voice }] of loop.voices) stepVoice(voice, source, now, dt);
      let wait = Infinity;
      for (const item of loop.animated)
        if (item.visible) wait = Math.min(wait, item.frame(now, dt));
      later(view, loop, wait);
      // Nothing is drawn or followed here any more.
      if (loop.animated.size + loop.voices.size === 0) loops.delete(view);
    });
  if (wait < 17) next();
  else if (wait < Infinity) loop.timer = view.setTimeout(next, wait - 8);
}

/** Draws on the next frame of `view` whatever its items waited for: something of theirs changed. */
export function wake(view: FrameWindow = window): void {
  const loop = loops.get(view);
  if (loop?.animated.size) later(view, loop, 0);
}

/** Draws `item` on the animation frames of `view` until the returned function is called. */
export function animate(item: Animated, view: FrameWindow = window): () => void {
  const loop = loopOf(view);
  loop.animated.add(item);
  wake(view);
  return () => {
    loop.animated.delete(item);
    // One more frame forgets the loop when this was its last item.
    later(view, loop, 0);
  };
}

/**
 * The voice level for `source` in `view`, stepped once per frame there however many Lenses follow
 * it. Release it with the returned function.
 */
export function followVoice(
  source: LevelSource,
  view: FrameWindow = window,
): [VoiceLevel, () => void] {
  const loop = loopOf(view);
  const entry = loop.voices.get(source) ?? { voice: createVoiceLevel(), followers: 0 };
  entry.followers += 1;
  loop.voices.set(source, entry);
  return [
    entry.voice,
    () => {
      entry.followers -= 1;
      if (entry.followers === 0) loop.voices.delete(source);
    },
  ];
}
