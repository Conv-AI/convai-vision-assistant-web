export const pickerCopy = {
  title: 'Characters',
  search: (count: number) => `Search ${String(count)} characters`,
  searchName: 'Search characters',
  clear: 'Clear search',
  close: 'Close',
  back: 'Back to characters',
  recent: 'Recent',
  all: 'All characters',
  results: (count: number) => (count === 1 ? '1 result' : `${String(count)} results`),
  noMatch: (query: string) => `No characters match “${query}”`,

  noMatchLine: 'Search looks at names and languages.',
  failedLine: 'Check your connection.',

  dots: 'Character',
  dotsValue: (name: string, at: number, of: number) => `${name}, ${String(at)} of ${String(of)}`,
  speaks: 'Speaks',
  talkingNow: 'Talking now',
  talk: (name: string) => `Talk to ${name}`,
  failed: 'Couldn’t load characters',
  retry: 'Try again',
  /** The bar's character chip: what a press opens. */
  chip: 'Characters',
  chipSingle: (name: string) => `About ${name}`,
} as const;
