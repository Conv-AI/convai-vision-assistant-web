import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const moduleId = 'virtual:licenses';

/** The license file a package ships, as text; null when it ships none. */
function licenseText(folder) {
  if (!folder || !existsSync(folder)) return null;
  const file = readdirSync(folder).find((name) => /^(licen[cs]e|copying)(\b|[-.])/i.test(name));
  return file ? readFileSync(join(folder, file), 'utf8').trim() : null;
}

/**
 * The packages of `pnpm licenses list --json` (grouped by license), each with its license text from
 * `textOf(folder)`, sorted by name. Throws when a package names no license. Type packages
 * (`@types/…`) ship no code and are left out. A license is written without the expression's outer
 * parentheses ("Apache-2.0 AND BSD-3-Clause"). Nothing of the machine it ran on (paths) is kept.
 */
export function packagesFrom(listed, textOf = licenseText) {
  const packages = [];
  const missing = [];
  for (const [license, entries] of Object.entries(listed)) {
    for (const entry of entries) {
      if (entry.name.startsWith('@types/')) continue;
      if (!license.trim() || license === 'Unknown' || license === 'UNLICENSED') {
        missing.push(entry.name);
        continue;
      }
      packages.push({
        name: entry.name,
        version: entry.versions.join(', '),
        license: license.replace(/^\((.*)\)$/, '$1'),
        text: textOf(entry.paths?.[0] ?? ''),
      });
    }
  }
  if (missing.length > 0)
    throw new Error(`These packages name no license: ${missing.join(', ')}. Settle it first.`);
  return packages.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** Every production package with its license, then Inter. */
export function readLicenses() {
  const listed = JSON.parse(
    execSync('pnpm licenses list --prod --json', { cwd: root, encoding: 'utf8' }),
  );
  return [
    ...packagesFrom(listed),
    {
      name: 'Inter',
      version: '4.001',
      license: 'SIL OFL 1.1',
      text: readFileSync(join(root, 'src', 'kit', 'fonts', 'OFL.txt'), 'utf8').trim(),
    },
  ];
}

/** The Vite plugin that serves the list as `virtual:licenses` (its default export). */
export function licenses() {
  return {
    name: 'convai-licenses',
    resolveId(id) {
      return id === moduleId ? `\0${moduleId}` : null;
    },
    load(id) {
      if (id !== `\0${moduleId}`) return null;
      return `export default ${JSON.stringify(readLicenses())};`;
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const one of readLicenses())
    console.log(
      `${one.name} ${one.version}: ${one.license}${one.text ? '' : ' (no license file)'}`,
    );
}
