export type TalkMode = 'push-to-talk' | 'hands-free';

export type CapsuleState =
  | 'ready'
  | 'listening'
  | 'held'
  | 'thinking'
  | 'speaking'
  | 'muted'
  | 'connecting'
  | 'offline'
  | 'unavailable'
  /** The account has no characters; the stage explains how to create one. */
  | 'no-character';

export interface CapsuleCopy {
  label: string;
  hint: string;

  hintKeys: string[];
  /** What a screen reader announces when the capsule enters the state. */
  announce: string;
  /** Offline and unavailable replace the tools but More with one action. */
  action?: string;

  actionKind?: 'primary' | 'secondary';
}

export interface CapsuleCopyOptions {
  hasTalked?: boolean;
  /** With captions and the transcript both off, Speaking says the words are off . */
  wordsOff?: boolean;

  askingMicrophone?: boolean;

  microphoneOff?: boolean;

  talkKey?: string;
  /** The Type key as its cap shows it; / unless changed; empty for none. */
  typeKey?: string;
  /** The Mute key as its cap shows it; M unless changed; empty for none. */
  muteKey?: string;
}

/** A hint's part: its words, and the key it names (empty for none). */
type HintPart = readonly [words: string, key: string];

/** A hint's parts that are there, joined as the capsule writes them, with the keys they name. */
function hintOf(...parts: HintPart[]): Pick<CapsuleCopy, 'hint' | 'hintKeys'> {
  const there = parts.filter(([words]) => words !== '');
  return {
    hint: there.map(([words]) => words).join(' · '),
    hintKeys: there.map(([, key]) => key).filter((key) => key !== ''),
  };
}

export function capsuleCopy(
  name: string,
  state: CapsuleState,
  mode: TalkMode,
  options: CapsuleCopyOptions = {},
): CapsuleCopy {
  const key = options.talkKey ?? 'T';
  const typeKey = options.typeKey ?? '/';
  const muteKey = options.muteKey ?? 'M';
  // A shortcut left without a key is not offered: the hint names what still works.
  const toType: HintPart = typeKey === '' ? ['', ''] : [`${typeKey} to type`, typeKey];
  const talk: HintPart = key === '' ? ['Click and hold to talk', ''] : [`Hold ${key} to talk`, key];
  switch (state) {
    case 'ready':
      if (options.microphoneOff)
        return {
          label: `Ask ${name}`,

          ...(typeKey === ''
            ? hintOf(['Microphone off', ''])
            : hintOf([`Press ${typeKey} to type`, typeKey])),
          announce: `${name}, ready. The microphone is off; you can type.`,
        };
      if (options.askingMicrophone)
        return {
          label: `Ask ${name}`,
          ...hintOf(['Waiting for the microphone', '']),
          announce: `${name} is asking for the microphone`,
        };
      return mode === 'push-to-talk'
        ? {
            label: `Ask ${name}`,
            ...(options.hasTalked ? hintOf(toType) : hintOf(talk, toType)),
            announce:
              key === ''
                ? `${name}, ready. Click and hold to talk.`
                : `${name}, ready. Hold ${key} to talk.`,
          }
        : {
            label: `Ask ${name}`,
            ...(options.hasTalked ? hintOf(toType) : hintOf(['Just start talking', ''], toType)),
            announce: `${name}, ready. Listening for your voice.`,
          };
    case 'listening':
      return {
        label: 'Listening…',
        ...hintOf(['Pause when you’re done', '']),
        announce: `${name}, listening`,
      };
    case 'held':
      return {
        label: 'Listening…',
        ...hintOf(key === '' ? ['Release to send', ''] : [`Release ${key} to send`, key]),
        announce: `${name}, listening while you hold`,
      };
    case 'thinking':
      return {
        label: 'Thinking…',
        ...hintOf(['Esc to cancel', 'Esc']),
        announce: `${name}, thinking`,
      };
    case 'speaking':
      return {
        label: `${name} is speaking`,
        ...hintOf(['Esc to stop', 'Esc'], options.wordsOff ? ['Words are off', ''] : ['', '']),
        announce: `${name}, speaking`,
      };
    case 'muted':
      return {
        label: `Muted · ${name} can’t hear you`,
        ...hintOf(
          muteKey === '' ? ['Click to unmute', ''] : [`${muteKey} to unmute`, muteKey],
          toType,
        ),
        announce: `${name}, muted`,
      };
    case 'connecting':
      return {
        label: `Connecting to ${name}…`,
        ...hintOf(['You can keep working', '']),
        announce: `Connecting to ${name}`,
      };

    case 'offline':
      return {
        label: 'You’re offline',
        ...hintOf(['Reconnects on its own', '']),
        announce: `${name}, offline. Reconnect, button.`,
        action: 'Reconnect',
        actionKind: 'secondary',
      };
    case 'unavailable':
      return {
        label: `${name} is unavailable right now`,
        ...hintOf(['Check your connection and Convai account', '']),
        announce: `${name} is unavailable right now. Try again, button.`,
        action: 'Try again',
        actionKind: 'primary',
      };
    case 'no-character':
      // No hint: the line that points at Settings comes with Settings.
      return {
        label: 'No characters available',
        ...hintOf(),
        announce: 'No characters available',
      };
  }
}

/**
 * The Compact capsule's own short words, which never cut . The long sentence
 * stays its tooltip.
 */
export function compactLabel(name: string, state: CapsuleState): string {
  switch (state) {
    case 'ready':
      return `Ask ${name}`;
    case 'listening':
    case 'held':
      return 'Listening…';
    case 'thinking':
      return 'Thinking…';
    case 'speaking':
      return 'Speaking';
    case 'muted':
      return 'Muted';
    case 'connecting':
      return 'Connecting…';
    case 'offline':
      return 'Offline';
    case 'unavailable':
      return 'Unavailable';
    case 'no-character':
      return 'No character';
  }
}

export interface LensAction {
  label: string;
  key: string;
}

/**
 * What a click on the Lens does now: its button's name, and the key its tooltip shows (none for an
 * empty key). In hands free with no microphone to listen through, the press requests access.
 */
export function lensAction(
  state: CapsuleState,
  mode: TalkMode,
  options: { talkKey?: string; muteKey?: string; microphoneOff?: boolean } = {},
): LensAction | undefined {
  const muteKey = options.muteKey ?? 'M';
  switch (state) {
    case 'ready':
      if (mode === 'push-to-talk') return { label: 'Hold to talk', key: options.talkKey ?? 'T' };
      return options.microphoneOff
        ? { label: 'Allow the microphone', key: '' }
        : { label: 'Mute', key: muteKey };
    case 'listening':
      return mode === 'hands-free' ? { label: 'Mute', key: muteKey } : undefined;
    case 'muted':
      return { label: 'Unmute', key: muteKey };
    case 'thinking':
      return { label: 'Cancel', key: 'Esc' };
    case 'speaking':
      return { label: 'Stop', key: 'Esc' };
    default:
      return undefined;
  }
}

/** A hint cut into its words and the keys it names, in order, for drawing the keys as caps. */
export type HintPiece = { words: string } | { key: string };

export function hintPieces(hint: string, keys: readonly string[]): HintPiece[] {
  const pieces: HintPiece[] = [];
  let from = 0;
  for (const key of keys) {
    // An empty key names nothing (and would be found everywhere).
    if (key === '') continue;
    // The key stands as a word of its own: at the start or after a space, and before a space.
    let at = hint.indexOf(key, from);
    while (
      at !== -1 &&
      ((at > 0 && hint[at - 1] !== ' ') ||
        (at + key.length < hint.length && hint[at + key.length] !== ' '))
    )
      at = hint.indexOf(key, at + 1);
    if (at === -1) continue;
    if (at > from) pieces.push({ words: hint.slice(from, at) });
    pieces.push({ key });
    from = at + key.length;
  }
  if (from < hint.length) pieces.push({ words: hint.slice(from) });
  return pieces;
}
