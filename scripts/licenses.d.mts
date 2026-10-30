import type { Plugin } from 'vite';

export interface LicensedPackage {
  name: string;
  version: string;
  license: string;
  text: string | null;
}

/** One package as `pnpm licenses list --json` lists it. */
export interface ListedPackage {
  name: string;
  versions: string[];
  paths?: string[];
}

export function packagesFrom(
  listed: Record<string, ListedPackage[]>,
  textOf?: (folder: string) => string | null,
): LicensedPackage[];
export function readLicenses(): LicensedPackage[];
export function licenses(): Plugin;
