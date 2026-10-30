// What the built app's first load costs: the scripts, styles and font a visit fetches before the
// window can show its first screen. `pnpm check:size` (scripts/check-size.mjs) holds it to a budget.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/** The scripts and styles `index.html` asks for at once: its module, preloads and stylesheets. */
export function pageAssets(html) {
  const scripts = [];
  const styles = [];
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/g) ?? []) {
    const address = /\b(?:src|href)="([^"]+)"/.exec(tag)?.[1];
    if (!address) continue;
    if (tag.startsWith('<script') || /rel="modulepreload"/.test(tag)) scripts.push(address);
    else if (/rel="stylesheet"/.test(tag)) styles.push(address);
  }
  return { scripts, styles };
}

/** The chunks a built module imports before it runs (`import … from`), never an `import()`. */
export function staticImports(code) {
  const found = new Set();
  for (const match of code.matchAll(/\b(?:from|import)\s*["'](\.\/[^"']+\.js)["']/g))
    found.add(match[1]);
  return [...found];
}

/** Whether a `unicode-range` holds a code point; a face without one holds every letter. */
export function rangeHolds(range, point) {
  if (!range) return true;
  return range.split(',').some((part) => {
    const [low, high] = part.trim().replace(/^U\+/i, '').split('-');
    if (!low) return false;
    if (low.includes('?')) {
      return (
        point >= parseInt(low.replace(/\?/g, '0'), 16) &&
        point <= parseInt(low.replace(/\?/g, 'F'), 16)
      );
    }
    return point >= parseInt(low, 16) && point <= parseInt(high ?? low, 16);
  });
}

/** The font files a page of Latin letters loads: every face whose range holds "A". */
export function latinFonts(css) {
  const files = [];
  for (const face of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
    const file = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(face)?.[1];
    const range = /unicode-range\s*:\s*([^;}]+)/.exec(face)?.[1];
    if (file && rangeHolds(range, 0x41)) files.push(file);
  }
  return files;
}

/**
 * The first load of the app built in `root`: the scripts (the page's and everything they import
 * before running) and styles in gzip bytes, as a server sends them, and the Latin font files in
 * their own bytes (woff2 is compressed already).
 */
export function firstLoad(root, read = (file) => readFileSync(join(root, file))) {
  const local = (address) => address.replace(/^\//, '');
  const { scripts, styles } = pageAssets(read('index.html').toString('utf8'));
  const seen = new Set();
  const queue = scripts.map(local);
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const folder = file.slice(0, file.lastIndexOf('/') + 1);
    for (const imported of staticImports(read(file).toString('utf8')))
      queue.push(folder + imported.slice(2));
  }
  const gzip = (file) => gzipSync(read(file)).length;
  const css = styles.map(local);
  const fonts = css.flatMap((file) => latinFonts(read(file).toString('utf8')).map(local));
  const sum = (files, size) => files.reduce((total, file) => total + size(file), 0);
  return {
    scripts: [...seen],
    styles: css,
    fonts: [...new Set(fonts)],
    script: sum([...seen], gzip),
    style: sum(css, gzip),
    font: sum([...new Set(fonts)], (file) => read(file).length),
  };
}

/** What is over its budget, in words; empty when everything fits. */
export function overBudget(load, budget) {
  const kB = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;
  const over = [];
  for (const [key, words] of [
    ['script', 'scripts (gzip)'],
    ['style', 'styles (gzip)'],
    ['font', 'Latin font'],
  ]) {
    if (load[key] > budget[key])
      over.push(`${words}: ${kB(load[key])}, over the budget of ${kB(budget[key])}`);
  }
  return over;
}
