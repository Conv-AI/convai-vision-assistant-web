import { describe, expect, it } from 'vitest';
import tokensCss from './tokens.css?raw';
import {
  contrastOn,
  distance,
  hsl,
  over,
  parseColor,
  withOklchLightness,
  type Rgba,
} from './test/colorMath';
import { palette, readRules } from './test/readTokens';

const rules = readRules(tokensCss);
const theme = '.convai-theme';
const highContrast = '.convai-theme.convai-high-contrast';
const aiOverlays = ['.convai-theme.convai-ai--cyan', '.convai-theme.convai-ai--yellow'];

type Palette = Map<string, string>;

function color(p: Palette, token: string): Rgba {
  const value = p.get(`--convai-${token}`);
  if (value === undefined) throw new Error(`--convai-${token} is not set`);
  return parseColor(value);
}

function withAlpha(c: Rgba, a: number): Rgba {
  return { ...c, a };
}

const base = palette(rules, theme);
const raised = palette(rules, theme, highContrast);
const sheet = (p: Palette) => color(p, 'surface-sheet');

const boardTokens = [
  'surface.ground',
  'surface.sheet',
  'scroll.thumb',
  'surface.sidebar',
  'surface.island',
  'edge.onLight',
  'edge.island',
  'surface.material',
  'surface.menu',
  'scrim',
  'scrim.black',
  'shadow.soft',
  'fill',
  'fill.emphasis',
  'fill.hover',
  'fill.selected',
  'fill.pressed',
  'fill.highlight',
  'edge',
  'edge.strong',
  'edge.button',
  'edge.key',
  'edge.disabled',
  'focus.ring',
  'switch.off',
  'knob.edge',
  'lens.ambient',
  'text.primary',
  'text.secondary',
  'text.tertiary',
  'text.disabled',
  'accent.user',
  'accent.user.text',
  'accent.user.pressed',
  'accent.share',
  'lens.green',
  'ai.accent',
  'ai.edge',
  'ai.tint',
  'ai.text',
  'warn',
  'warn.text',
  'warn.tint',
  'danger.fill',
  'danger.fill.button',
  'danger.fill.button.pressed',
  'danger.fill.text',
  'danger.text',
  'danger.tint',
  'radius.xs',
  'radius.s',
  'radius.m',
  'radius.l',
  'radius.capsule',
  'font.ui',
  'motion.fast',
  'motion.standard',
  'motion.deliberate',
  'motion.island',
  'motion.lens',
  'motion.shot',
];

describe('Convai theme tokens', () => {
  it('sets every token the theme specification name', () => {
    const missing = boardTokens.filter(
      (name) => !base.has(`--convai-${name.toLowerCase().replaceAll('.', '-')}`),
    );
    expect(missing).toEqual([]);
  });

  it('keeps the values theme gives', () => {
    expect(base.get('--convai-surface-sheet')).toBe('#17171a');
    expect(base.get('--convai-text-secondary')).toBe('rgba(246, 248, 250, 0.62)');
    expect(base.get('--convai-accent-share')).toBe('#75dba8');
    expect(base.get('--convai-radius-l')).toBe('24px');
    expect(base.get('--convai-motion-island')).toBe('420ms');
  });
});

describe.each([
  ['the Convai theme', base],
  ['high contrast', raised],
])('theme checks on %s', (_name, p) => {
  const surfaces: [string, Rgba][] = [
    ['sheet', sheet(p)],
    ['Island', color(p, 'surface-island')],
    ['material', over(color(p, 'surface-material'), color(p, 'surface-ground'))],
  ];

  it.each(surfaces)('reads every text token on the %s', (_surface, surface) => {
    expect(contrastOn(color(p, 'text-primary'), surface)).toBeGreaterThanOrEqual(7);
    expect(contrastOn(color(p, 'text-secondary'), surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastOn(color(p, 'text-tertiary'), surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps disabled text at 3 : 1 and the scroll thumb at 3 : 1 on the sheet', () => {
    expect(contrastOn(color(p, 'text-disabled'), sheet(p))).toBeGreaterThanOrEqual(3);
    expect(contrastOn(color(p, 'scroll-thumb'), sheet(p))).toBeGreaterThanOrEqual(3);
  });

  it('reads danger text, text on the user accent and text on the red buttons', () => {
    expect(contrastOn(color(p, 'danger-text'), sheet(p))).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastOn(color(p, 'accent-user-text'), color(p, 'accent-user')),
    ).toBeGreaterThanOrEqual(4.5);
    for (const fill of ['danger-fill-button', 'danger-fill-button-pressed']) {
      expect(contrastOn(color(p, 'danger-fill-text'), color(p, fill))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

const aiPalettes: [string, Palette][] = [
  ['mint', base],
  ...aiOverlays.map((o): [string, Palette] => [o, palette(rules, theme, o)]),
];

describe.each(aiPalettes)('the character color %s', (_name, p) => {
  const accent = color(p, 'ai-accent');

  it('reads its text on the sheet', () => {
    expect(contrastOn(color(p, 'ai-text'), sheet(p))).toBeGreaterThanOrEqual(4.5);
  });

  it('draws its edge at 80 % and its tint at 12 % of the accent', () => {
    expect(distance(color(p, 'ai-edge'), withAlpha(accent, 0.8))).toBeLessThan(0.5);
    expect(distance(color(p, 'ai-tint'), withAlpha(accent, 0.12))).toBeLessThan(0.5);
  });

  it('stays distinct from the user accent', () => {
    const user = color(p, 'accent-user');
    const chroma = (c: Rgba) => (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
    const u = hsl(user);
    const a = hsl(accent);
    if (chroma(user) < 0.1 || chroma(accent) < 0.1) {
      const gap = Math.abs(u.s - a.s) >= 0.4 || contrastOn(user, accent) >= 1.4;
      expect(gap).toBe(true);
    } else {
      const dh = Math.abs(u.h - a.h);
      expect(Math.min(dh, 360 - dh)).toBeGreaterThanOrEqual(60);
    }
  });
});

describe('derived tokens follow their rules', () => {
  const primary = color(base, 'text-primary');

  function leastAlpha(from: number, need: number, surface: Rgba): number {
    for (let percent = Math.round(from * 100); percent < 100; percent++) {
      if (contrastOn(withAlpha(primary, percent / 100), surface) >= need) return percent / 100;
    }
    return 1;
  }

  it('makes text.disabled the least alpha from 40 % that reaches 3 : 1 on the sheet', () => {
    expect(color(base, 'text-disabled')).toEqual(
      withAlpha(primary, leastAlpha(0.4, 3, sheet(base))),
    );
  });

  it('keeps disabled text at 3 : 1 on every raised fill a disabled control sits on in high contrast', () => {
    const disabled = color(raised, 'text-disabled');
    expect(disabled.a).toBeGreaterThanOrEqual(0.52);
    for (const fill of ['fill', 'fill-emphasis', 'fill-hover', 'fill-highlight']) {
      const ground = over(color(raised, fill), sheet(raised));
      expect(contrastOn(disabled, ground)).toBeGreaterThanOrEqual(3);
    }
  });

  it('orders the button edges: disabled 10 % < button 16 % < key 24 %', () => {
    const edge = color(base, 'edge');
    const strong = color(base, 'edge-strong');
    expect(color(base, 'edge-button')).toEqual(withAlpha(edge, edge.a * 2));
    expect(color(base, 'edge-key')).toEqual(withAlpha(strong, Math.max(strong.a, 0.24)));
    expect(color(base, 'edge-disabled')).toEqual(withAlpha(strong, 0.1));
  });

  it('takes fill.highlight from fill.emphasis and the focus ring from text.primary at 60 %', () => {
    expect(color(base, 'fill-highlight')).toEqual(color(base, 'fill-emphasis'));
    expect(color(base, 'focus-ring')).toEqual(withAlpha(primary, 0.6));
  });

  it('makes the scroll thumb white at the least alpha from 34 % with 3 : 1, and 16 points more under the pointer', () => {
    const thumb = color(base, 'scroll-thumb');
    expect({ ...thumb, a: 1 }).toEqual(parseColor('#ffffff'));
    let least = 0.34;
    while (contrastOn(withAlpha(thumb, least), sheet(base)) < 3)
      least = Math.round(least * 100 + 1) / 100;
    expect(thumb.a).toBe(least);
    expect(color(base, 'scroll-thumb-hover').a).toBeCloseTo(thumb.a + 0.16, 6);
  });

  it('presses the red button OKLCH L 0.06 away from its light text', () => {
    const pressed = withOklchLightness(color(base, 'danger-fill-button'), -0.06);
    expect(distance(color(base, 'danger-fill-button-pressed'), pressed)).toBeLessThanOrEqual(1);
  });

  it('composes the state colors a part paints itself', () => {
    const user = color(base, 'accent-user');
    const userText = color(base, 'accent-user-text');
    const close = (token: string, expected: Rgba) => {
      expect(distance(color(base, token), expected)).toBeLessThanOrEqual(1);
    };
    close('accent-user-hover', over(withAlpha(user, 0.9), sheet(base)));
    close('accent-user-text-quiet', over(withAlpha(userText, 0.66), user));
    close('accent-user-key', over(withAlpha(userText, 0.1), user));
    close('switch-knob-disabled', over(withAlpha(color(base, 'switch-knob'), 0.4), sheet(base)));
  });

  it.each([
    ['the Convai theme', base],
    ['high contrast', raised],
  ])('dims a disabled fill to 40 %% of it on %s', (_name, p) => {
    for (const fill of ['fill', 'fill-emphasis', 'fill-selected']) {
      const rest = color(p, fill);
      expect(distance(color(p, `${fill}-disabled`), withAlpha(rest, rest.a * 0.4))).toBeLessThan(
        0.5,
      );
    }
  });

  it('builds the portrait ground from fill.emphasis over the sheet', () => {
    const ground = over(color(base, 'fill-emphasis'), sheet(base));
    const portrait = color(base, 'portrait-ground');
    expect(distance(portrait, ground)).toBeLessThanOrEqual(1);
    expect(
      distance(color(base, 'portrait-ground-light'), withOklchLightness(portrait, 0.06)),
    ).toBeLessThanOrEqual(1);
    expect(
      distance(color(base, 'portrait-ground-island'), withOklchLightness(portrait, -0.03)),
    ).toBeLessThanOrEqual(1);
  });
});

describe('high contrast raises the translucent tokens', () => {
  const alpha = (p: Palette, token: string) => color(p, token).a;

  it('raises text, edges and fills by the contrast rule', () => {
    expect(alpha(raised, 'text-secondary')).toBe(0.82);
    expect(alpha(raised, 'text-tertiary')).toBe(0.72);
    expect(alpha(raised, 'edge')).toBe(0.28);
    expect(alpha(raised, 'edge-strong')).toBe(0.5);
    expect(alpha(raised, 'edge-disabled')).toBe(0.28);
    for (const fill of ['fill', 'fill-emphasis', 'fill-hover', 'fill-highlight']) {
      expect(alpha(raised, fill)).toBeCloseTo(alpha(base, fill) + 0.04, 6);
    }
    for (const fill of ['fill-selected', 'fill-pressed']) {
      expect(alpha(raised, fill)).toBeCloseTo(alpha(base, fill) + 0.1, 6);
    }
    expect(alpha(raised, 'focus-ring')).toBe(1);
  });

  it('draws the Island edge as the raised edge over the Island, as one opaque color', () => {
    const island = color(raised, 'surface-island');
    const expected = over(color(raised, 'edge'), island);
    expect(distance(color(raised, 'edge-island'), expected)).toBeLessThanOrEqual(1);
  });

  it('presses the red button with its rest red', () => {
    expect(raised.get('--convai-danger-fill-button-pressed')).toBe(
      raised.get('--convai-danger-fill-button'),
    );
  });

  it('keeps opaque colors as the theme set them', () => {
    for (const [name, value] of rules.get(highContrast) ?? []) {
      if (name === '--convai-edge-island' || name === '--convai-danger-fill-button-pressed')
        continue;
      if (name === '--convai-focus-ring') continue;
      expect(parseColor(base.get(name) ?? '').a, name).toBeLessThan(1);
      expect(parseColor(value).a, name).toBeLessThanOrEqual(1);
    }
  });
});
