import { describe, expect, it } from 'vitest';
import { packagesFrom } from './licenses.mjs';

describe('the open-source licenses read at build time (S10)', () => {
  const listed = {
    MIT: [
      { name: '@types/dom-mediacapture-record', versions: ['1.0.22'] },
      { name: 'react', versions: ['19.3.1'], paths: ['C:\\machine\\react'] },
      { name: 'events', versions: ['3.3.0'], paths: ['C:\\machine\\events'] },
    ],
    '(Apache-2.0 AND BSD-3-Clause)': [
      { name: '@bufbuild/protobuf', versions: ['1.10.1'], paths: ['C:\\machine\\protobuf'] },
    ],
  };
  const textOf = (folder: string) => (folder.endsWith('protobuf') ? null : `text of ${folder}`);

  it('lists each package with its license and text, by name, keeping nothing of the machine', () => {
    const packages = packagesFrom(listed, textOf);
    expect(packages.map((one) => one.name)).toEqual(['@bufbuild/protobuf', 'events', 'react']);
    expect(packages[2]).toEqual({
      name: 'react',
      version: '19.3.1',
      license: 'MIT',
      text: 'text of C:\\machine\\react',
    });
    // A package that ships no license file keeps its license, with no text; type packages ship no
    // code and are left out; an expression loses its outer parentheses.
    expect(packages[0]).toMatchObject({ license: 'Apache-2.0 AND BSD-3-Clause', text: null });
    expect(
      JSON.stringify(packages.map((one) => [one.name, one.version, one.license])),
    ).not.toContain('machine');
    expect(packages.every((one) => !('paths' in one))).toBe(true);
  });

  it('fails the build when a package names no license', () => {
    expect(() =>
      packagesFrom({ ...listed, Unknown: [{ name: 'mystery', versions: ['1.0.0'] }] }, textOf),
    ).toThrow('These packages name no license: mystery.');
    expect(() =>
      packagesFrom({ UNLICENSED: [{ name: 'closed', versions: ['1.0.0'] }] }, textOf),
    ).toThrow(/closed/);
  });
});
