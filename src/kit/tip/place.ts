export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The side of its target the bubble stands on; its tail is on the opposite side of the bubble. */
export type TipSide = 'above' | 'below' | 'left' | 'right';

export interface TipPlace {
  side: TipSide;
  left: number;
  top: number;
  /** From the bubble's near edge (left for above/below, top for left/right) to the tail's box. */
  tailOffset: number;
}

/** The tail's box (14, turned 45°) and its usual offset, 28 from the bubble's near edge (Tip README). */
export const tailSize = 14;
export const tailOffset = 28;

export const targetGap = 16;

export const hostGap = 6;

export const windowMargin = 16;
/** The tail never comes closer than this to a corner of the bubble (radius.m is 14). */
const tailInset = 10;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

/**
 * The bubble's place beside `target`, inside a window `bounds` wide and high, clear of the host's
 * keep-clear areas (an inset preview, a floating panel) where any side allows it. `host` is the bar
 * the target sits in (the capsule): the bubble never stands over it.
 */
export function placeTip(
  target: Box,
  bubble: { width: number; height: number },
  bounds: { width: number; height: number },
  keepClear: readonly Box[] = [],
  host?: Box,
): TipPlace {
  const centreX = target.left + target.width / 2;
  const centreY = target.top + target.height / 2;
  const reach = tailOffset + tailSize / 2;

  const across = (side: 'above' | 'below'): TipPlace => {
    const left = clamp(centreX - reach, windowMargin, bounds.width - windowMargin - bubble.width);
    const top =
      side === 'above'
        ? Math.min(target.top - targetGap, host ? host.top - hostGap : Infinity) - bubble.height
        : Math.max(
            target.top + target.height + targetGap,
            host ? host.top + host.height + hostGap : -Infinity,
          );
    const offset = clamp(
      centreX - left - tailSize / 2,
      tailInset,
      bubble.width - tailInset - tailSize,
    );
    return { side, left, top, tailOffset: offset };
  };
  const beside = (side: 'left' | 'right'): TipPlace => {
    const top = clamp(centreY - reach, windowMargin, bounds.height - windowMargin - bubble.height);
    const left =
      side === 'left'
        ? target.left - targetGap - bubble.width
        : target.left + target.width + targetGap;
    const offset = clamp(
      centreY - top - tailSize / 2,
      tailInset,
      bubble.height - tailInset - tailSize,
    );
    return { side, left, top, tailOffset: offset };
  };

  const inside = (place: TipPlace) =>
    place.left >= windowMargin &&
    place.top >= windowMargin &&
    place.left + bubble.width <= bounds.width - windowMargin &&
    place.top + bubble.height <= bounds.height - windowMargin;
  const clear = (place: TipPlace) =>
    ![...keepClear, ...(host ? [host] : [])].some((area) =>
      overlaps({ ...place, ...bubble }, area),
    );

  const roomLeft = target.left;
  const roomRight = bounds.width - target.left - target.width;
  const sides = [
    across('above'),
    across('below'),
    ...(roomLeft >= roomRight
      ? [beside('left'), beside('right')]
      : [beside('right'), beside('left')]),
  ];
  return (
    sides.find((place) => inside(place) && clear(place)) ?? sides.find(inside) ?? across('above')
  );
}
