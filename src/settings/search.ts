/** What the search reads of a row. */
export interface SearchableRow {
  label: string;
  description?: string;
  /** Extra words the row is found by ("mic microphone"). */
  keywords?: string;
}

export interface SearchableSection {
  title: string;
  groups: readonly { label: string; rows: readonly SearchableRow[] }[];
}

type GroupOf<S extends SearchableSection> = S['groups'][number];
type RowOf<S extends SearchableSection> = GroupOf<S>['rows'][number];

/** One group of results: its section, its group, and the rows found in it, in their own order. */
export interface SearchGroup<S extends SearchableSection> {
  section: S;
  group: GroupOf<S>;
  rows: RowOf<S>[];
}

/** How many characters a query needs before it searches: results come from the second character. */
export const minimumLength = 2;

/** True when `query` is long enough to search with. */
export function isQuery(query: string): boolean {
  return fold(query).replaceAll(' ', '').length >= minimumLength;
}

export function findRows<S extends SearchableSection>(
  sections: readonly S[],
  query: string,
): SearchGroup<S>[] {
  const wanted = words(query);
  if (!isQuery(query) || wanted.length === 0) return [];
  // "Audio", "Microphone": a section's or a group's name finds its rows when nothing else is found.
  const own = collect(sections, wanted, false);
  return own.length > 0 ? own : collect(sections, wanted, true);
}

/**
 * The line over a group of results: "Section › Group", the group's name cut at its first comma (kit
 * round 8, 2); the section alone for a group with no name.
 */
export function resultLabel(section: string, group: string): string {
  const comma = group.indexOf(',');
  const short = comma > 0 ? group.slice(0, comma) : group;
  return short.trim() === '' ? section : `${section} › ${short}`;
}

/** How many rows the groups hold: the number the results' first line says. */
export function countRows(groups: readonly { rows: readonly unknown[] }[]): number {
  return groups.reduce((sum, group) => sum + group.rows.length, 0);
}

function collect<S extends SearchableSection>(
  sections: readonly S[],
  wanted: readonly string[],
  names: boolean,
): SearchGroup<S>[] {
  const found: (SearchGroup<S> & { tier: number })[] = [];
  for (const section of sections) {
    for (const group of section.groups) {
      const shared = names ? [...words(section.title), ...words(group.label)] : [];
      const rows = group.rows.filter((row) => matches(wanted, shared, row));
      if (rows.length > 0)
        found.push({
          section,
          group,
          rows,
          tier: Math.min(...rows.map((row) => tier(wanted, row))),
        });
    }
  }
  // `sort` is stable: groups of one tier stay in the sidebar's order.
  return found
    .sort((a, b) => a.tier - b.tier)
    .map(({ section, group, rows }) => ({ section, group, rows }));
}

/** 0 when the row's label holds every word, 1 with its description too, 2 otherwise. */
function tier(wanted: readonly string[], row: SearchableRow): number {
  const has = (own: readonly string[]) =>
    wanted.every((want) => own.some((word) => word.startsWith(want)));
  const label = words(row.label);
  if (has(label)) return 0;
  return has([...label, ...words(row.description ?? '')]) ? 1 : 2;
}

function matches(
  wanted: readonly string[],
  shared: readonly string[],
  row: SearchableRow,
): boolean {
  const own = [
    ...shared,
    ...words(row.label),
    ...words(row.description ?? ''),
    ...words(row.keywords ?? ''),
  ];
  return wanted.every((want) => own.some((word) => word.startsWith(want)));
}

const plain: Record<string, string> = {
  ß: 'ss',
  ø: 'o',
  ı: 'i',
  æ: 'ae',
  œ: 'oe',
  đ: 'd',
  ł: 'l',
};

/** Lower case, without accents, and every run that is not a letter or a digit one space. */
export function fold(text: string): string {
  let folded = '';
  for (const c of text.normalize('NFD')) {
    if (/\p{Mn}/u.test(c)) continue;
    if (/[\p{L}\p{N}]/u.test(c)) {
      const lower = c.toLowerCase();
      folded += plain[lower] ?? lower;
    }
    // An apostrophe joins a word ("Kira’s" is one word, found by "kiras" and by "kira").
    else if (c === "'" || c === '’') continue;
    else if (folded.length > 0 && !folded.endsWith(' ')) folded += ' ';
  }
  return folded.trim();
}

function words(text: string): string[] {
  const folded = fold(text);
  return folded.length === 0 ? [] : folded.split(' ');
}
