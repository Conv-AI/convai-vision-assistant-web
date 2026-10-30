import type { LensPalette, Rgb } from './draw';

const tokens: Record<keyof LensPalette, string> = {
  green: '--convai-lens-green',
  mint: '--convai-lens-mint',
  mintWhite: '--convai-lens-mint-white',
  inkMuted: '--convai-lens-ink-muted',
  glassInner: '--convai-lens-glass-inner',
  glassMid: '--convai-lens-glass-mid',
  glassOuter: '--convai-lens-glass-outer',
  rim: '--convai-lens-rim',
};

function parseRgb(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex?.[1]) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const numbers = value.match(/[\d.]+/g)?.map(Number) ?? [];
  return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0];
}

/** The Lens's colors as the theme sets them on `element`. */
export function readPalette(element: Element): LensPalette {
  const style = getComputedStyle(element);
  const read = (name: string) => parseRgb(style.getPropertyValue(name));
  return Object.fromEntries(
    Object.entries(tokens).map(([key, variable]) => [key, read(variable)]),
  ) as unknown as LensPalette;
}
