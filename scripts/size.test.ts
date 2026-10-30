import { describe, expect, it } from 'vitest';
import {
  firstLoad,
  latinFonts,
  overBudget,
  pageAssets,
  rangeHolds,
  staticImports,
} from './size.mjs';

// A small build as Vite writes one: the page's module imports the kit, which imports a shared
// chunk; Settings' licenses and the SDK wait behind `import()`.
const files: Record<string, string> = {
  'index.html': `<!doctype html><head>
    <script type="module" crossorigin src="/assets/main-1.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/kit-2.js">
    <link rel="stylesheet" crossorigin href="/assets/kit-3.css">
    <link rel="icon" href="/favicon.svg">
  </head>`,
  'assets/main-1.js': `import{a as e}from"./kit-2.js";const t=()=>import(\`./sdk-4.js\`);import("./licenses-5.js");`,
  'assets/kit-2.js': `import"./shared-6.js";export{x as a};`,
  'assets/shared-6.js': 'var x=1;',
  'assets/sdk-4.js': 'a'.repeat(500_000),
  'assets/licenses-5.js': 'b'.repeat(500_000),
  'assets/kit-3.css': `@font-face{font-family:Inter;src:url(/assets/inter-cyr.woff2)format("woff2");unicode-range:U+400-45F}
    @font-face{font-family:Inter;src:url(/assets/inter-latin.woff2)format("woff2");unicode-range:U+0-FF,U+2318}
    .x{color:var(--a)}`,
  'assets/inter-cyr.woff2': 'c'.repeat(30),
  'assets/inter-latin.woff2': 'l'.repeat(100),
};
const read = (file: string) => {
  const text = files[file];
  if (text === undefined) throw new Error(`no ${file}`);
  return Buffer.from(text);
};

describe('the first load (pnpm check:size)', () => {
  it('reads the page’s module, its preloads and its stylesheets, and nothing else', () => {
    expect(pageAssets(read('index.html').toString())).toEqual({
      scripts: ['/assets/main-1.js', '/assets/kit-2.js'],
      styles: ['/assets/kit-3.css'],
    });
  });

  it('follows the imports a module needs before it runs, never an import()', () => {
    expect(staticImports(read('assets/main-1.js').toString())).toEqual(['./kit-2.js']);
    expect(staticImports(read('assets/kit-2.js').toString())).toEqual(['./shared-6.js']);
  });

  it('counts the chunks reached by imports, so one not preloaded is still counted', () => {
    const load = firstLoad('dist', read);
    expect(load.scripts.sort()).toEqual([
      'assets/kit-2.js',
      'assets/main-1.js',
      'assets/shared-6.js',
    ]);
    expect(load.styles).toEqual(['assets/kit-3.css']);
    // What import() loads later is far larger and is not in the sum.
    expect(load.script).toBeLessThan(400);
  });

  it('counts only the font files a page of Latin letters loads, in their own bytes', () => {
    expect(latinFonts(read('assets/kit-3.css').toString())).toEqual(['/assets/inter-latin.woff2']);
    expect(firstLoad('dist', read)).toMatchObject({
      fonts: ['assets/inter-latin.woff2'],
      font: 100,
    });
    // A face without a range holds every letter: the whole font loads.
    expect(latinFonts('@font-face{src:url(./whole.woff2)}')).toEqual(['./whole.woff2']);
  });

  it('reads unicode ranges with single points, spans and wildcards', () => {
    expect(rangeHolds('U+0-FF', 0x41)).toBe(true);
    expect(rangeHolds('U+400-45F, U+0041', 0x41)).toBe(true);
    expect(rangeHolds('U+400-45F', 0x41)).toBe(false);
    expect(rangeHolds('U+00??', 0x41)).toBe(true);
    expect(rangeHolds('U+04??', 0x41)).toBe(false);
    expect(rangeHolds(undefined, 0x41)).toBe(true);
  });

  it('names each part over its budget, and nothing when all fit', () => {
    const load = { scripts: [], styles: [], fonts: [], script: 150_000, style: 21_000, font: 400 };
    expect(overBudget(load, { script: 160_000, style: 20_000, font: 120_000 })).toEqual([
      'styles (gzip): 21.0 kB, over the budget of 20.0 kB',
    ]);
    expect(overBudget(load, { script: 150_000, style: 21_000, font: 400 })).toEqual([]);
  });
});
