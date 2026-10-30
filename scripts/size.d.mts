export interface FirstLoad {
  scripts: string[];
  styles: string[];
  fonts: string[];
  /** Scripts, in gzip bytes. */
  script: number;
  /** Styles, in gzip bytes. */
  style: number;
  /** The Latin font files, in bytes. */
  font: number;
}

export type Budget = Pick<FirstLoad, 'script' | 'style' | 'font'>;

export function pageAssets(html: string): { scripts: string[]; styles: string[] };
export function staticImports(code: string): string[];
export function rangeHolds(range: string | undefined, point: number): boolean;
export function latinFonts(css: string): string[];
export function firstLoad(root: string, read?: (file: string) => Buffer): FirstLoad;
export function overBudget(load: FirstLoad, budget: Budget): string[];
