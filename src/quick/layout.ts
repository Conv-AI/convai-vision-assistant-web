export const panelWidth = 420;
/** The least the panel keeps from the stage's sides. */
export const sideInset = 8;

export const panelGap = 8;

export const panelChrome = 8;
/** Between rows of tiles, and between tiles in a row. */
export const tileGap = 8;
/** Under the character's row, before the tiles. */
export const characterGap = 8;
/** Over "All settings": the panel's 8, its rule drawn in the middle. */
export const ruleHeight = 8;
/** A tile's padding, on each side. */
export const tilePadding = 12;
/** A row holds three tiles; two where three would cut a tile's words (kit `NarrowColumns`). */
export const columns = 3;
export const narrowColumns = 2;

/** A height that grows with the text above 1.00, to the even pixel (kit `QuickTileView.HeightAt`). */
function grown(base: number, textScale: number): number {
  return textScale <= 1 ? base : Math.round((base * textScale) / 2) * 2;
}

/** A tile: 84, growing with the text so its label and value keep their lines (0.58.0). */
export const tileHeight = (textScale: number) => grown(84, textScale);
/** The character's row: 56, the 40 portrait beside its two lines, growing with them. */
export const characterHeight = (textScale: number) => grown(56, textScale);
/** "From Vision Assistant": the panel's 8, then 6 over a 12 line of 1.25, and 8 under it. */
export const appLabelHeight = (textScale: number) => 8 + 6 + Math.ceil(15 * textScale) + 8;
/** "All settings": 44, growing with its words. */
export const settingsHeight = (textScale: number) => grown(44, textScale);

export type Step = 0 | 1 | 2 | 3;

/** What the panel holds. */
export interface PanelContent {
  textScale: number;
  packageTiles: number;
  appTiles: number;
  /** Tiles a row holds. */
  columns: number;
}

const rowsOf = (tiles: number, perRow: number) => Math.ceil(tiles / perRow);
const rowsHeight = (rows: number, textScale: number) =>
  rows === 0 ? 0 : rows * tileHeight(textScale) + (rows - 1) * tileGap;

/** The panel's height at a step, edge to edge. */
export function panelHeight(content: PanelContent, step: Step): number {
  const scale = content.textScale;
  let height = 2 * panelChrome;
  if (step < 2) height += characterHeight(scale) + characterGap;
  if (step < 3) {
    const packageRows = rowsOf(content.packageTiles, content.columns);
    height += rowsHeight(step >= 1 ? Math.min(1, packageRows) : packageRows, scale);
    if (content.appTiles > 0)
      height +=
        appLabelHeight(scale) + rowsHeight(rowsOf(content.appTiles, content.columns), scale);
    height += ruleHeight;
  }
  return height + settingsHeight(scale);
}

/** Half a pixel: a panel that fits to the pixel fits. */
const fitSlack = 0.5;

/**
 * The step the panel takes on a stage with `free` room: the least it can give way and fit, or null
 * where not even "All settings" alone fits, and Quick controls is not offered.
 */
export function stepFor(content: PanelContent, free: number): Step | null {
  for (const step of [0, 1, 2, 3] as const) {
    if (panelHeight(content, step) <= free + fitSlack) return step;
  }
  return null;
}

export interface Stage {
  /** The stage's height and width. */
  height: number;
  width: number;
  /** From the stage's bottom to the capsule's top. */
  capsuleTop: number;

  islandBottom: number;
}

/** The room the panel has between the Island and the capsule, each kept 8 away. */
export function freeRoom(stage: Stage): number {
  return stage.height - stage.capsuleTop - panelGap - (stage.islandBottom + panelGap);
}

/** The panel's width on a stage: 420, or the stage less 8 on each side. */
export function widthOn(stageWidth: number): number {
  return Math.min(panelWidth, stageWidth - 2 * sideInset);
}

/** The room a tile's words have when a row holds `perRow` tiles of a panel `width` wide. */
export function wordsRoom(width: number, perRow: number): number {
  const inner = width - 2 * panelChrome;
  return (inner - (perRow - 1) * tileGap) / perRow - 2 * tilePadding;
}

/**
 * Tiles a row holds: three, or two where three would cut a tile's label or value (kit `FitWords`;
 * a word is never broken to fit). `widest` is the widest of the tiles' words at the text size.
 */
export function columnsFor(width: number, widest: number): number {
  return widest + wordsSlack <= wordsRoom(width, columns) ? columns : narrowColumns;
}

/**
 * What a word measured on a canvas is given to spare: the page draws it up to a pixel or two wider
 * ("Pause vision" measured 101.8 of 102 at text 1.30 and was cut).
 */
export const wordsSlack = 2;

/** The rows of tiles as the panel draws them: the package's, then the app's, each `perRow` wide. */
export function tileRows(packageTiles: number, appTiles: number, perRow: number): number[] {
  const rows: number[] = [];
  for (const count of [packageTiles, appTiles])
    for (let left = count; left > 0; left -= perRow) rows.push(Math.min(perRow, left));
  return rows;
}

export type Arrow = 'left' | 'right' | 'up' | 'down';

export function moveInTiles(rows: readonly number[], from: number, arrow: Arrow): number {
  const total = rows.reduce((sum, count) => sum + count, 0);
  if (arrow === 'left') return Math.max(0, from - 1);
  if (arrow === 'right') return Math.min(total - 1, from + 1);
  let start = 0;
  let row = 0;
  while (row < rows.length - 1 && from >= start + (rows[row] ?? 0)) start += rows[row++] ?? 0;
  const column = from - start;
  const to = arrow === 'up' ? row - 1 : row + 1;
  if (to < 0 || to >= rows.length) return from;
  const toStart = rows.slice(0, to).reduce((sum, count) => sum + count, 0);
  return toStart + Math.min(column, (rows[to] ?? 1) - 1);
}
