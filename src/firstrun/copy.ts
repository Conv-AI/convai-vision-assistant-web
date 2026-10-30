export const firstRunCopy = {
  back: 'Back',
  step: (step: number, count: number, title: string) =>
    `Step ${String(step)} of ${String(count)}, ${title}`,

  welcomeTitle: (name: string) => `Show ${name} what you see`,
  welcomeBody: 'Share your camera, a window or your screen, and ask out loud.',
  welcomeQuestion: 'What’s this mug made of?',
  welcomeAnswer: [
    'Glazed stoneware, by the look of the foot.',
    'It should be fine in the dishwasher.',
  ],
  getStarted: 'Get started',
  /** The last button of the welcome shown again from Settings (kit FirstRunFlow, replay). */
  done: 'Done',

  talkTitle: 'How do you want to talk?',

  talkBody: 'You can switch any time in Quick controls.',
  handsFree: 'Hands free',
  handsFreeLine: (name: string) => `Just talk. ${name} listens whenever you speak.`,
  pushToTalk: 'Push to talk',
  pushToTalkLine: (name: string, key: string) =>
    key === ''
      ? `Press and hold while you talk. Let go and ${name} answers.`
      : `Hold ${key} while you talk. Let go and ${name} answers.`,
  continueWith: (mode: string) => `Continue with ${mode}`,

  talkKeyTitle: 'Your talk key',
  talkKeyBody: (name: string) => `Hold it while you talk. Let go and ${name} answers.`,
  talkKeyWorks: 'Works while this page is in front and you’re not typing.',
  talkKeyRow: 'Talk key',
  /** What the web takes as a talk key: a page cannot hold the F-keys the browser keeps. */
  talkKeyRule: (apple: boolean) =>
    apple
      ? 'Any letter or number, without ⌘, ⌥ or Ctrl'
      : 'Any letter or number, without Ctrl or Alt',

  talkKeyRecording: 'Press the key you want…',
  /** A press with a modifier, refused in place. */
  talkKeyChord: (apple: boolean) =>
    apple ? 'Pick a key without ⌘, ⌥ or Ctrl.' : 'Pick a key without Ctrl or Alt.',
  change: 'Change',
  cancel: 'Cancel',

  accessTitle: (name: string) => `Let ${name} hear and see`,

  accessBodyCameraWaits:
    'Only the microphone is needed to start. The rest can wait until you first share.',
  accessBody: 'Only the microphone is needed to start.',
  accessNote: (name: string) => `${name} sees only what you share.`,
  refusedTitle: 'Talk or type, your choice',
  refusedBody: 'Allow the microphone to just talk, or type your questions.',
  refusedNote: 'Try again to allow the microphone, or allow it in your browser’s site settings.',

  blockedBody: 'You can type now. To talk, allow the microphone in your browser’s site settings.',
  /** On the web the site settings open over this page: it follows them at once. */
  blockedNote: 'This page updates as soon as you allow it.',
  missingBody: 'No microphone found. Connect one to talk, or type your questions.',
  busyBody: 'Another app is using your microphone. Close it, then try again.',

  microphone: 'Microphone',
  microphonePurpose: 'So you can just talk. You can type instead.',
  microphoneRefused: (name: string) => `Off. ${name} can’t hear you`,
  microphoneInUse: 'Microphone in use by another app',
  noMicrophone: 'No microphone',
  camera: 'Camera',
  cameraPurpose: (name: string) => `To show ${name} things in front of you. Optional.`,
  cameraBlocked: 'Optional. Blocked in your browser’s site settings.',
  cameraMissing: 'Not connected',

  blockedReason: 'Vision Assistant needs your microphone',
  blocked: 'Blocked',
  allow: 'Allow',
  allowed: 'Allowed',
  tryAgain: 'Try again',
  continue: 'Continue',
  typeInstead: 'Type instead',

  windowTitle: (name: string) => `Where should ${name} stay?`,

  windowBody: 'Switch any time from the title bar.',
  fullWindow: 'Full window',
  fullWindowLine: 'A big stage for your camera, with the conversation beside it.',
  compact: 'Compact',
  compactLine: 'A small capsule that floats over any app.',

  allSetTitle: 'You’re all set',
  allSetPushToTalk: (name: string, key: string) =>
    `Hold ${key} and ask ${name} about what you share.`,
  /** Nothing listens before Start: "is listening" would not be true yet. */
  allSetHandsFree: (name: string) => `${name} is ready. Start when you are.`,
  allSetTyping: (name: string) => `Press / to type to ${name}.`,
  allSetBecause: (reason: string, line: string) => `${reason}. ${line}`,
  modeWithKey: (mode: string, key: string) => `${mode} · ${key}`,
  typing: 'Typing',
  microphoneOff: 'Microphone off',
  microphoneBusy: 'Microphone in use',
  cameraWhenShared: 'Camera when you share',
  /** All set past a microphone not asked yet: it is asked for when first used. */
  microphoneWhenTalking: 'Microphone when you talk',
  cameraBlockedChip: 'Camera blocked',
  cameraBlockedTooltip: 'Blocked in your browser’s site settings',
  cameraBlockedNote: (name: string) =>
    `Allow the camera in your browser’s site settings to let ${name} see.`,
  askedLater: (name: string, key: string) =>
    `${name} asks for the microphone the first time you hold ${key}.`,
  askedLaterHandsFree: (name: string) =>
    `${name} asks for the microphone when you press the microphone button.`,
  blockedLaterNote: 'To talk later, allow the microphone in your browser’s site settings.',
  start: 'Start',
} as const;
