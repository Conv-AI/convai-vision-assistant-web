export interface TokenRow {
  name: string;

  backdrop?: string;

  isNew?: boolean;
}

export interface TokenGroup {
  group: string;
  /** Colors get a swatch; the rest print their value. */
  colors: boolean;
  tokens: TokenRow[];
}

const t = (name: string, backdrop?: string, isNew?: boolean): TokenRow => ({
  name,
  backdrop,
  isNew,
});

export const tokenGroups: TokenGroup[] = [
  {
    group: 'Surfaces',
    colors: true,
    tokens: [
      t('surface.ground'),
      t('surface.sheet'),
      t('scroll.thumb', 'surface.sheet'),
      t('surface.sidebar'),
      t('surface.island'),
      t('edge.onLight', 'a picture', true),
      t('edge.island'),
      t('surface.material', 'any content'),
      t('surface.menu', 'surface.sheet'),
      t('scrim', 'any content'),
      t('scrim.black', undefined, true),
      t('shadow.soft', 'surface.ground'),
    ],
  },
  {
    group: 'Fills and edges',
    colors: true,
    tokens: [
      t('fill', 'surface.sheet'),
      t('fill.emphasis', 'surface.sheet'),
      t('fill.hover', 'the fill below'),
      t('fill.selected', 'surface.sheet'),
      t('fill.pressed', 'surface.sheet'),
      t('fill.highlight', 'surface.menu', true),
      t('edge', 'surface.sheet'),
      t('edge.strong', 'surface.sheet'),
      t('edge.button', 'surface.sheet', true),
      t('edge.key', 'a button’s fill', true),
      t('edge.disabled', 'surface.ground', true),
      t('focus.ring', 'surface.sheet'),
      t('switch.off', 'fill on sheet'),
      t('knob.edge', 'knob'),
    ],
  },
  {
    group: 'Text',
    colors: true,
    tokens: [
      t('text.primary'),
      t('text.secondary', 'sheet · island'),
      t('text.tertiary', 'sheet · island'),
      t('text.disabled', 'sheet'),
    ],
  },
  {
    group: 'Accents',
    colors: true,
    tokens: [
      t('accent.user'),
      t('accent.user.text'),
      t('accent.user.pressed'),
      t('accent.share', undefined, true),
      t('lens.green'),
      t('ai.accent'),
      t('ai.edge', 'content'),
      t('ai.tint', 'surface.sheet'),
      t('ai.text'),
    ],
  },
  {
    group: 'Status',
    colors: true,
    tokens: [
      t('warn'),
      t('warn.text'),
      t('warn.tint', 'surface.sheet'),
      t('danger.fill'),
      t('danger.fill.button'),
      t('danger.fill.button.pressed', undefined, true),
      t('danger.fill.text'),
      t('danger.text'),
      t('danger.tint', 'surface.sheet'),
    ],
  },
  {
    group: 'Shape, font, motion',
    colors: false,
    tokens: [
      t('radius.xs'),
      t('radius.s'),
      t('radius.m'),
      t('radius.l'),
      t('radius.capsule'),
      t('lens.ambient'),
      t('font.ui'),
      t('motion.fast'),
      t('motion.standard'),
      t('motion.deliberate'),
      t('motion.island'),
      t('motion.lens'),
      t('motion.shot'),
    ],
  },
];

/** The CSS variable of a token: `edge.onLight` → `--convai-edge-onlight`. */
export function tokenVariable(token: string): string {
  return `--convai-${token.toLowerCase().replaceAll('.', '-')}`;
}
