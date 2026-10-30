import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
  ['/src/**/*.{ts,tsx,css}', '!/src/**/*.test.{ts,tsx}', '!/src/**/test/**'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

// The Lens drawing composes its token colors as numbers on a canvas; its only literals are the
// glass's white light and black shade. The app's own token file names the few colors the kit has
// no token for.
const allowed = new Set(['/src/kit/tokens.css', '/src/kit/lens/draw.ts', '/src/app/tokens.css']);
const colorLiteral = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/gi;

describe('color literals', () => {
  it('appear only in the token file', () => {
    const found: string[] = [];
    for (const [path, text] of Object.entries(sources)) {
      if (allowed.has(path)) continue;
      const withoutComments = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const match of withoutComments.matchAll(colorLiteral))
        found.push(`${path}: ${match[0]}`);
    }
    expect(found).toEqual([]);
  });

  it('are found by the check', () => {
    const sample = 'a { color: #fff; background: rgba(0, 0, 0, 0.5); }';
    expect([...sample.matchAll(colorLiteral)].map((m) => m[0])).toEqual(['#fff', 'rgba(']);
  });

  it('reads the files it guards', () => {
    expect(Object.keys(sources)).toContain('/src/kit/tokens.css');
    expect(Object.keys(sources)).toContain('/src/kit/metrics.css');
  });
});
