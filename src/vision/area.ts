export interface ShareArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rectangle of whole pixels, counted from the surface's top-left pixel. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SurfaceSize {
  width: number;
  height: number;
}

export const minimumPixels = 64;

export const noArea: ShareArea = { x: 0, y: 0, width: 0, height: 0 };

export const middleHalf: ShareArea = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

function clamp01(value: number): number {
  return Number.isNaN(value) ? 0 : Math.max(0, Math.min(1, value));
}

/** A rectangle of the surface, each value a fraction of its width or height, kept inside it. */
export function shareArea(x: number, y: number, width: number, height: number): ShareArea {
  const left = clamp01(x);
  const top = clamp01(y);
  return {
    x: left,
    y: top,
    width: Math.max(0, Math.min(clamp01(width), 1 - left)),
    height: Math.max(0, Math.min(clamp01(height), 1 - top)),
  };
}

export function isEmpty(area: ShareArea): boolean {
  return area.width <= 0 || area.height <= 0;
}

export function sameArea(a: ShareArea, b: ShareArea): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** The area a rectangle of pixels covers on a surface of this size, cut to it; none without a size. */
export function areaOf(rect: PixelRect, surface: SurfaceSize): ShareArea {
  if (surface.width <= 0 || surface.height <= 0) return noArea;
  return shareArea(
    rect.x / surface.width,
    rect.y / surface.height,
    rect.width / surface.width,
    rect.height / surface.height,
  );
}

function round(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * The area in whole pixels of a surface this size, as the character gets them and the readout names
 * them. Each edge is rounded to its nearest pixel, so two areas that touch stay touching; an area that
 * is not empty has at least one pixel each way. Null for no area or a surface without a size.
 */
export function toPixels(area: ShareArea, surface: SurfaceSize): PixelRect | null {
  const { width, height } = surface;
  if (isEmpty(area) || width <= 0 || height <= 0) return null;
  const left = Math.min(round(area.x * width), width - 1);
  const top = Math.min(round(area.y * height), height - 1);
  const right = Math.min(width, round((area.x + area.width) * width));
  const bottom = Math.min(height, round((area.y + area.height) * height));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/** What a pixel size reads as, in the readout and after the chip's "Region": "1024 × 576". */
export function sizeWords(width: number, height: number): string {
  return `${String(width)} × ${String(height)}`;
}

/** The least width and height of an area: the minimum, or the whole surface where it is smaller. */
export function least(surface: SurfaceSize): SurfaceSize {
  return {
    width: Math.min(minimumPixels, Math.max(1, surface.width)),
    height: Math.min(minimumPixels, Math.max(1, surface.height)),
  };
}

/** What a press takes hold of: a handle near a corner, the area inside it, or a new area elsewhere. */
export type Grip =
  'none' | 'new' | 'move' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

function clampTo(value: number, size: number): number {
  return Math.max(0, Math.min(size, value));
}

export class AreaSelection {
  private current: ShareArea;
  private held: Grip = 'none';
  private before: ShareArea = noArea;
  private anchor = { x: 0, y: 0 };
  private offset = { x: 0, y: 0 };
  private size = { width: 0, height: 0 };

  /** `area`: the area drawn when the crop opens (the middle half, the current one, or the last one's). */
  constructor(area: ShareArea = noArea) {
    this.current = area;
  }

  get area(): ShareArea {
    return this.current;
  }

  get hasArea(): boolean {
    return !isEmpty(this.current);
  }

  /** What the pointer holds while its button is down. */
  get grip(): Grip {
    return this.held;
  }

  /**
   * What a press at this point would take hold of. `reach` is how near a corner a press still takes
   * its handle, in the surface's pixels.
   */
  gripAt(x: number, y: number, surface: SurfaceSize, reach: number): Grip {
    const pixels = this.hasArea ? toPixels(this.current, surface) : null;
    if (pixels) {
      const right = pixels.x + pixels.width;
      const bottom = pixels.y + pixels.height;
      const nearLeft = Math.abs(x - pixels.x) <= reach;
      const nearRight = Math.abs(x - right) <= reach;
      const nearTop = Math.abs(y - pixels.y) <= reach;
      const nearBottom = Math.abs(y - bottom) <= reach;
      if (nearLeft && nearTop) return 'top-left';
      if (nearRight && nearTop) return 'top-right';
      if (nearLeft && nearBottom) return 'bottom-left';
      if (nearRight && nearBottom) return 'bottom-right';
      if (x >= pixels.x && x < right && y >= pixels.y && y < bottom) return 'move';
    }
    return 'new';
  }

  /** The pointer's button went down at this point. */
  press(x: number, y: number, surface: SurfaceSize, reach: number): void {
    this.before = this.current;
    if (surface.width <= 0 || surface.height <= 0) {
      this.held = 'none';
      return;
    }
    this.held = this.gripAt(x, y, surface, reach);
    const pixels = toPixels(this.current, surface) ?? { x: 0, y: 0, width: 0, height: 0 };
    const right = pixels.x + pixels.width;
    const bottom = pixels.y + pixels.height;
    switch (this.held) {
      case 'move':
        this.offset = { x: round(x) - pixels.x, y: round(y) - pixels.y };
        this.size = { width: pixels.width, height: pixels.height };
        break;
      case 'top-left':
        this.anchor = { x: right, y: bottom };
        break;
      case 'top-right':
        this.anchor = { x: pixels.x, y: bottom };
        break;
      case 'bottom-left':
        this.anchor = { x: right, y: pixels.y };
        break;
      case 'bottom-right':
        this.anchor = { x: pixels.x, y: pixels.y };
        break;
      default:
        this.anchor = {
          x: clampTo(round(x), surface.width),
          y: clampTo(round(y), surface.height),
        };
    }
  }

  /** The pointer moved to this point with its button down. Returns whether the area changed. */
  dragTo(x: number, y: number, surface: SurfaceSize): boolean {
    const { width, height } = surface;
    if (this.held === 'none' || width <= 0 || height <= 0) return false;
    const was = this.current;
    const toX = clampTo(round(x), width);
    const toY = clampTo(round(y), height);
    const { anchor } = this;
    switch (this.held) {
      case 'move': {
        const left = Math.max(0, Math.min(round(x) - this.offset.x, width - this.size.width));
        const top = Math.max(0, Math.min(round(y) - this.offset.y, height - this.size.height));
        this.set({ x: left, y: top, width: this.size.width, height: this.size.height }, surface);
        break;
      }
      case 'new':
        this.set(
          {
            x: Math.min(anchor.x, toX),
            y: Math.min(anchor.y, toY),
            width: Math.abs(toX - anchor.x),
            height: Math.abs(toY - anchor.y),
          },
          surface,
        );
        break;
      default: {
        // The held corner stays on its own side of the anchor, at least the minimum away from it.
        const smallest = least(surface);
        const leftHeld = this.held === 'top-left' || this.held === 'bottom-left';
        const topHeld = this.held === 'top-left' || this.held === 'top-right';
        const cornerX = leftHeld
          ? Math.max(0, Math.min(toX, anchor.x - smallest.width))
          : Math.min(width, Math.max(toX, anchor.x + smallest.width));
        const cornerY = topHeld
          ? Math.max(0, Math.min(toY, anchor.y - smallest.height))
          : Math.min(height, Math.max(toY, anchor.y + smallest.height));
        this.set(
          {
            x: Math.min(anchor.x, cornerX),
            y: Math.min(anchor.y, cornerY),
            width: Math.abs(cornerX - anchor.x),
            height: Math.abs(cornerY - anchor.y),
          },
          surface,
        );
      }
    }
    return !sameArea(this.current, was);
  }

  /**
   * The pointer's button came up. A new area smaller than the minimum (a click) gives way to the one
   * before the press. Returns whether the area differs from the one before the press.
   */
  release(surface: SurfaceSize): boolean {
    if (this.held === 'none') return false;
    const held = this.held;
    this.held = 'none';
    if (held === 'new' && !reaches(this.current, surface)) this.current = this.before;
    return !sameArea(this.current, this.before);
  }

  /** Lets go of a gesture as if it never happened: the area before the press stays. */
  abandon(): void {
    if (this.held === 'none') return;
    this.held = 'none';
    this.current = this.before;
  }

  private set(rect: PixelRect, surface: SurfaceSize): void {
    this.current = rect.width > 0 && rect.height > 0 ? areaOf(rect, surface) : noArea;
  }
}

/** Whether an area is as large as the minimum on a surface of this size. */
function reaches(area: ShareArea, surface: SurfaceSize): boolean {
  const pixels = toPixels(area, surface);
  if (!pixels) return false;
  const smallest = least(surface);
  return pixels.width >= smallest.width && pixels.height >= smallest.height;
}

export const sentShortEdge = 1080;

export function sentSize(width: number, height: number): SurfaceSize {
  let w = width;
  let h = height;
  const shortEdge = Math.min(w, h);
  if (shortEdge > sentShortEdge) {
    const scale = sentShortEdge / shortEdge;
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  return { width: Math.max(2, w - (w & 1)), height: Math.max(2, h - (h & 1)) };
}
