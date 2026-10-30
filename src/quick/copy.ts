export const quickCopy = {
  /** The panel's name, as a screen reader hears it when it opens. */
  title: 'Quick controls',
  handsFree: 'Hands free',
  captions: 'Captions',
  transcript: 'Transcript',
  type: 'Type',
  mute: 'Mute',
  textSize: 'Text size',
  on: 'On',
  off: 'Off',
  noMicrophone: 'No microphone',
  change: 'Change',
  allSettings: 'All settings',
  back: 'Back',

  fromApp: 'From Vision Assistant',
  pauseVision: 'Pause vision',
  source: 'Source',
  /**
   * The Source tile's value line while nothing is shared. Shorter than the title bar's "Nothing
   * shared", which at text 1.30 would not fit a third of the row and take the rows down to two.
   */
  nothing: 'Nothing',

  pauseNothing: 'Nothing shared',
  pauseStarting: 'Starting…',
  pauseChoosing: 'Choosing area',
  window: 'Window',

  full: 'Full',
  compact: 'Compact',

  compactWithCard: 'Compact…',
} as const;
