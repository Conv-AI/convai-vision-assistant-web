/** Reads the custom properties of each rule in a stylesheet's text, by selector. */
export function readRules(css: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  // Comments and @import statements are no part of any rule.
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/g, '');
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? '').trim().replace(/\s+/g, ' ');
    const declarations = rules.get(selector) ?? new Map<string, string>();
    for (const declaration of (match[2] ?? '').split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      const name = declaration.slice(0, colon).trim();
      if (name.startsWith('--')) declarations.set(name, declaration.slice(colon + 1).trim());
    }
    rules.set(selector, declarations);
  }
  return rules;
}

/** The variables of `base`, with those of each overlay selector in turn on top. */
export function palette(
  rules: Map<string, Map<string, string>>,
  base: string,
  ...overlays: string[]
): Map<string, string> {
  const result = new Map(rules.get(base));
  for (const overlay of overlays) {
    for (const [name, value] of rules.get(overlay) ?? []) result.set(name, value);
  }
  return result;
}
