import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = 'dist';
const variables = ['CONVAI_API_KEY'];

function fail(message) {
  console.error(`check-bundle: ${message}`);
  process.exit(1);
}

const needles = ['CONVAI_API_KEY', 'fake-convai-transport', 'convaiVisionTest'];
for (const name of variables) {
  const value = process.env[name];
  // Without a stand-in value there is nothing to find, and the check would pass on nothing.
  if (!value) fail(`${name} is not set. Build and check with a stand-in API key.`);
  needles.push(value);
}

let files;
try {
  files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
} catch {
  fail(`${root}/ was not found. Run pnpm build first.`);
}
if (files.length === 0) fail(`${root}/ is empty. Run pnpm build first.`);

const leaks = [];
for (const file of files) {
  const text = readFileSync(file, 'latin1');
  for (const needle of needles) {
    if (text.includes(needle))
      leaks.push(`${relative('.', file)} contains a forbidden credential or test marker`);
  }
}

if (leaks.length > 0)
  fail(`server-only values or the test fake reached the build:\n  ${leaks.join('\n  ')}`);
console.log(
  `check-bundle: ${String(files.length)} files in ${root}/ hold no server-only value and no test fake.`,
);
