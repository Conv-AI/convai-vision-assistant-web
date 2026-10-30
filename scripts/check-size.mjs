// Fails when the built app's first load in dist/ is over its budget. Run it after `pnpm build`:
//   pnpm check:size
//
// The first load is what index.html fetches before the window shows (scripts/size.mjs): the SDK,
// Settings' licenses and anything else behind an `import()` are not part of it.

import { firstLoad, overBudget } from './size.mjs';

const budget = { script: 152_300, style: 21_000, font: 120_000 };

let load;
try {
  load = firstLoad('dist');
} catch (error) {
  console.error(`check-size: dist/ could not be read (${String(error)}). Run pnpm build first.`);
  process.exit(1);
}
const kB = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;
const over = overBudget(load, budget);
if (over.length > 0) {
  console.error(`check-size: the first load is over its budget:\n  ${over.join('\n  ')}`);
  console.error(`  scripts: ${load.scripts.join(', ')}`);
  process.exit(1);
}
console.log(
  `check-size: first load ${kB(load.script)} of scripts and ${kB(load.style)} of styles (gzip), ` +
    `${kB(load.font)} of font (${load.fonts.join(', ')}): within the budget.`,
);
