import { createContext, useContext, useSyncExternalStore } from 'react';

let context: CanvasRenderingContext2D | null | undefined;

/** Measures text in `font` (a CSS font: "600 22px Inter"), as the page draws it. */
export function measureWith(font: string): (text: string) => number {
  // Asked once: a page without a 2D canvas answers the same every time.
  context ??= document.createElement('canvas').getContext('2d');
  const drawing = context;
  if (!drawing) return (text) => text.length * 11;
  return (text) => {
    drawing.font = font;
    return drawing.measureText(text).width;
  };
}

let fontLoads = 0;
const fontListeners = new Set<() => void>();
const fontLoaded = () => {
  fontLoads++;
  for (const listener of [...fontListeners]) listener();
};

function followFonts(listener: () => void): () => void {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts;
  if (fontListeners.size === 0) fonts?.addEventListener('loadingdone', fontLoaded);
  fontListeners.add(listener);
  return () => {
    fontListeners.delete(listener);
    if (fontListeners.size === 0) fonts?.removeEventListener('loadingdone', fontLoaded);
  };
}

const readFontLoads = () => fontLoads;

/**
 * `measureWith` for text that is measured while it is shown: measured again each time a font file
 * arrives. Inter loads one script at a time, so a name or an answer in letters whose file has not
 * come yet is first measured in the fallback font, which is narrower.
 */
export function useMeasure(font: string): (text: string) => number {
  return measureAt(font, useSyncExternalStore(followFonts, readFontLoads, readFontLoads));
}

let measuredAt = 0;
const measures = new Map<string, (text: string) => number>();

/** One function per font and load: a new one after each load, so what used it is worked out again. */
function measureAt(font: string, loads: number): (text: string) => number {
  if (loads !== measuredAt) {
    measures.clear();
    measuredAt = loads;
  }
  let measure = measures.get(font);
  if (!measure) {
    measure = measureWith(font);
    measures.set(font, measure);
  }
  return measure;
}

/**
 * The person's text size (the kit's `--convai-text-scale`, 0.90 to 1.30), for what is measured or
 * placed by script. It comes from the settings store, not from the stylesheet, so a change in
 * Settings lays these parts out again in the same commit that changes the variable.
 */
export const TextScaleContext = createContext(1);

export function useTextScale(): number {
  return useContext(TextScaleContext);
}
