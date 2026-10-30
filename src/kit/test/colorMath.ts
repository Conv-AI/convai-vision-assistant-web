/** Red, green and blue in 0–255; alpha in 0–1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(value: string): Rgba {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{6})$/.exec(text);
  if (hex?.[1]) {
    const n = Number.parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
    text,
  );
  if (rgba) {
    const [, r, g, b, a] = rgba;
    return { r: Number(r), g: Number(g), b: Number(b), a: a === undefined ? 1 : Number(a) };
  }
  throw new Error(`Not a color the token checks read: ${value}`);
}

/** `color` drawn over the opaque `backdrop`, with its alpha rounded to a whole step of 1/255. */
export function over(color: Rgba, backdrop: Rgba): Rgba {
  const a = Math.round(color.a * 255) / 255;
  const mix = (f: number, b: number) => f * a + b * (1 - a);
  return {
    r: mix(color.r, backdrop.r),
    g: mix(color.g, backdrop.g),
    b: mix(color.b, backdrop.b),
    a: 1,
  };
}

function channelToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToChannel(v: number): number {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(c * 255)));
}

export function luminance(c: Rgba): number {
  return (
    0.2126 * channelToLinear(c.r) + 0.7152 * channelToLinear(c.g) + 0.0722 * channelToLinear(c.b)
  );
}

/** WCAG contrast of two opaque colors. */
export function contrast(a: Rgba, b: Rgba): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The contrast of `text` as it is drawn on the opaque `surface`. */
export function contrastOn(text: Rgba, surface: Rgba): number {
  return contrast(over(text, surface), surface);
}

function toOklab(c: Rgba): [number, number, number] {
  const r = channelToLinear(c.r);
  const g = channelToLinear(c.g);
  const b = channelToLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab(lightness: number, a: number, b: number): Rgba {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: linearToChannel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToChannel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToChannel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: 1,
  };
}

export function oklchLightness(c: Rgba): number {
  return toOklab(c)[0];
}

/** `c` with `delta` added to its OKLCH lightness, hue and chroma kept, as whole sRGB channels. */
export function withOklchLightness(c: Rgba, delta: number): Rgba {
  const [l, a, b] = toOklab(c);
  return fromOklab(l + delta, a, b);
}

export function hsl(c: Rgba): { h: number; s: number; l: number } {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return { h, s, l };
}

/** The largest difference between two colors' channels, in 0–255 steps, and between their alphas in 1/255 steps. */
export function distance(a: Rgba, b: Rgba): number {
  return Math.max(
    Math.abs(a.r - b.r),
    Math.abs(a.g - b.g),
    Math.abs(a.b - b.b),
    Math.abs(a.a - b.a) * 255,
  );
}
