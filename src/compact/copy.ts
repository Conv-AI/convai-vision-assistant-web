export const compactCopy = {
  /** The title bar's switch, as a group, and its two modes . */
  switch: 'Window mode',
  full: 'Full window',
  compact: 'Compact',

  cardTitle: 'Compact needs a supported browser',
  cardLine:
    'Kira stays in this tab because this browser does not support floating windows. Try a desktop browser with Document Picture-in-Picture support.',

  gotIt: 'Got it',

  away: (name: string) => `${name} is in the floating window`,
  awayKeys: 'Shortcuts work while this tab or the floating window is in front.',
  back: (name: string) => `Bring ${name} back`,

  imagesInFull: 'Images are shared in the full window',
  open: 'Open',
} as const;

/** The card's line for the character's name: "Kira" in the design stands for it. */
export function cardLine(name: string): string {
  return compactCopy.cardLine.replaceAll('Kira', name);
}
