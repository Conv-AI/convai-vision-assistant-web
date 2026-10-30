import {
  lazy,
  Suspense,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Capsule } from '../kit/capsule/Capsule';
import { Button } from '../kit/controls/Button';
import { capsuleCopy, type CapsuleState } from '../kit/capsule/capsuleCopy';
import { Island } from '../kit/island/Island';
import type { LensState } from '../kit/lens/lensLabel';
import { useAnnouncement } from '../kit/useAnnouncement';
import { pickerCopy } from '../characters/copy';
import { spokenLanguages } from '../characters/languages';
import type { TalkMode } from '../kit/capsule/capsuleCopy';
import { settingsCopy, shortcutCopy } from '../settings/copy';
import { keyCap } from '../settings/shortcuts';
import type { SectionId } from '../settings/sections';
import type { Character } from '../credentials/characters';
import { capsuleState, fallbackName, stageOverlay, type SessionState } from '../session/session';
import { lastTurn } from '../session/turns';
import { chooseImage, imageAccept, pasteTakes } from '../vision/image';
import { visionKeys } from '../vision/notices';
import type { Choice } from '../vision/vision';
import { CompactAway, CompactWindow } from './CompactWindow';
import { Composer } from './Composer';
import { FirstRunReplay } from './FirstRun';
import { carriesFiles, carriesText, dragHeldMs, filesOf } from './files';
import {
  useCharacterList,
  useCompactState,
  useHeight,
  useIslandBanner,
  useIslandHolds,
  useIslandShows,
  useSessionState,
  useVisionState,
  useWindowWidth,
} from './hooks';
import {
  charactersKeyLabel,
  isApple,
  isElement,
  isTextField,
  pauseKeyLabel,
  pauseKeyShortcuts,
  routeKey,
  settingsKeyLabel,
  type KeyAction,
  type KeyInput,
} from './keys';
import {
  captionMode,
  floatTakes,
  initialTranscript,
  layoutFor,
  pinFrom,
  toggleTranscript,
  transcriptOnResize,
} from './layout';
import { TextScaleContext, measureWith } from './measure';
import { capsuleSpeech, islandTellsKeys, type CapsuleSpeech } from './speech';
import { imageLine, pausedLine, previewLine } from './preview';
import type { Runtime } from './runtime';
import { RegionCrop } from './RegionCrop';
import { Settings } from './Settings';
import { ShareCardDialog } from './ShareCardDialog';
import { SourceChip, SourceMenu } from './SourceChip';
import { chipWords, floatingSource } from './sources';
import {
  CameraStage,
  Captions,
  Continuum,
  DropTarget,
  Launch,
  MicrophoneAsk,
  NothingShared,
  type PauseControl,
  SharePreview,
  StartingSource,
} from './Stage';
import { CompactCard, ModeSwitch } from './ModeSwitch';
import { QuickControls } from './QuickControls';
import { columnsFor, freeRoom, stepFor, widthOn, type PanelContent } from '../quick/layout';
import {
  appTiles,
  packageTiles,
  showsWindowTile,
  switchGivesWay,
  type QuickState,
  type QuickTileId,
} from '../quick/tiles';
import { bandHeight, islandTop } from './preview';
import { lettersFor, prefetchLetters } from './fontPrefetch';
import type { WindowMode } from '../compact/compact';
import { TitleBar } from './TitleBar';
import { Transcript } from './Transcript';

const Tips = lazy(() => import('../tips/Tips'));
const CharacterPicker = lazy(() =>
  import('./CharacterPicker').then(({ CharacterPicker }) => ({ default: CharacterPicker })),
);

/** What the character card in Settings › Talking says under the name: languages, then the link. */
function characterLine(state: SessionState): string {
  const languages = spokenLanguages(state.character?.languages ?? [], navigator.language).map(
    (language) => language.name,
  );
  const link =
    state.phase === 'live'
      ? settingsCopy.connected
      : state.phase === 'offline'
        ? settingsCopy.offline
        : state.phase === 'unavailable' || state.phase === 'failed'
          ? settingsCopy.unavailable
          : settingsCopy.connecting;
  return [...languages, link].join(' · ');
}

function sendReason(state: SessionState): string | undefined {
  switch (state.phase) {
    case 'live':
      return undefined;
    case 'offline':
      return 'Typing returns when you’re back online';
    case 'unavailable':
      return `${state.name} is unavailable right now`;
    default:
      return `Available once ${state.name} is connected`;
  }
}

/** The Lens the Type field shows for the capsule's state. */
function lensOf(state: CapsuleState): LensState {
  return state === 'unavailable' || state === 'no-character' ? 'offline' : state;
}

type PickerChoice = Extract<Choice, { kind: 'display' } | { kind: 'region' }>;

/** While an area is chosen only what needs the person shows; the rest waits. */
const needsThePerson = (n: { level: string }) => n.level === 'problem' || n.level === 'request';

const compactActions = new Set<KeyAction>([
  'talk-press',
  'talk-release',
  'hands-free',
  'mute',
  'pause-vision',
  'stop',
]);

/** A key event as the routing reads it. */
// The last focus came from the pointer: no key other than the window's own was pressed since (the
// tab and the Compact window share it, as they share the keys).
let pointerFocus = false;
const pointerPressed = () => {
  pointerFocus = true;
};

/**
 * Chromium rings the focused control at any key, but the window's own keys move no focus: a control
 * the pointer focused stays without its ring (`data-ring-quiet`) until another key.
 */
function quietRing(event: KeyboardEvent, own: boolean) {
  if (event.type !== 'keydown') return;
  const page = (event.currentTarget as Window).document;
  const focused = page.activeElement;
  // A held key's repeats, and a modifier alone (left or right: location 1 or 2), wait for more.
  if (own) {
    if (pointerFocus && focused !== page.body) focused?.setAttribute('data-ring-quiet', '');
  } else if (!event.repeat && !(event.location % 3)) {
    // Any other key rings again, wherever the focus is or goes.
    pointerFocus = false;
    for (const quiet of page.querySelectorAll('[data-ring-quiet]'))
      quiet.removeAttribute('data-ring-quiet');
  }
}

function keyInput(event: KeyboardEvent): KeyInput {
  return {
    type: event.type === 'keyup' ? 'up' : 'down',
    key: event.key,
    code: event.code,
    repeat: event.repeat,
    chord: event.ctrlKey || event.altKey || event.metaKey,
    alt: event.altKey,
    control: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
    inTextField: isTextField(event.target),
  };
}

function replyAnnouncement(state: SessionState): string {
  const turn = lastTurn(state.items);
  return turn?.status === 'done' && turn.reply !== '' ? `${state.name}: ${turn.reply}` : '';
}

export function SessionWindow({ runtime }: { runtime: Runtime }) {
  const { session, queue } = runtime;
  const state = useSessionState(session);

  const keys = useSyncExternalStore(
    (onChange) => runtime.shortcuts.subscribe(onChange),
    () => runtime.shortcuts.keys,
  );
  const caps = {
    talk: keyCap(keys.talk),
    type: keyCap(keys.type),
    mute: keyCap(keys.mute),
    transcript: keyCap(keys.transcript),
    quick: keyCap(keys.quick),
  };
  const vision = useVisionState(runtime.vision);
  const characters = useCharacterList(runtime.characters);

  const compact = useCompactState(runtime.compact);
  const compactButton = useRef<HTMLButtonElement>(null);
  const failureShows = useIslandShows(queue, visionKeys.camera);
  const bannerShows = useIslandBanner(queue);
  const width = useWindowWidth();
  const [transcript, setTranscript] = useState(() => initialTranscript(window.innerWidth));
  const settings = useSyncExternalStore(
    (onChange) => runtime.settings.subscribe(onChange),
    () => runtime.settings.state,
  );
  const style = settings.transcriptStyle;
  const [menuOpen, setMenuOpen] = useState(false);
  const [sourceMenu, setSourceMenu] = useState(false);

  const [shareCard, setShareCard] = useState<PickerChoice | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const [quickOpen, setQuickOpen] = useState(false);
  const quickEscape = useRef<(() => boolean) | null>(null);
  const [draft, setDraft] = useState('');

  const [pickerOpen, setPickerOpen] = useState(false);
  /** The picker's own Esc: true when one of its layers took it. */
  const pickerEscape = useRef<(() => boolean) | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SectionId>('talking');
  const settingsEscape = useRef<(() => boolean) | null>(null);
  /** A shortcut's row in Settings waits for a key: the window's keys wait too. */
  const [recording, setRecording] = useState(false);
  /** The welcome shown again from Settings › About, over the conversation. */
  const [welcomeOpen, setWelcomeOpen] = useState(false);

  const [tipsReplay, setTipsReplay] = useState(0);
  const [tipsAgain, setTipsAgain] = useState(false);
  const gear = useRef<HTMLButtonElement>(null);

  const [dropping, setDropping] = useState(false);
  const barTool = useRef<HTMLButtonElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const characterChip = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLElement>(null);
  const island = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  const layout = layoutFor(width, transcript.open, style);
  const overlay = stageOverlay(state);
  const capsule = capsuleState(state);

  const stageHeight = useHeight(stage);
  const islandHeight = useHeight(island, overlay === null);
  const loose = layout.place === 'float' || layout.place === 'sheet';

  const announced = useAnnouncement(settings.readAnswers ? replyAnnouncement(state) : '');

  const seenAnnounced = useAnnouncement(
    vision.share === 'live' && !vision.paused && vision.source?.kind === 'image'
      ? `${state.name} now sees ${vision.source.name}`
      : '',
  );
  // Alt V pauses and resumes without moving the focus: a screen reader hears both. A pause ended
  // by choosing another source is told by that source.
  const [resumed, setResumed] = useState(false);
  // Shift with the talk key changes the way of talking without moving the focus: said, politely.
  const [modeSaid, setModeSaid] = useState('');
  const modeAnnounced = useAnnouncement(modeSaid);
  const pausedAnnounced = useAnnouncement(
    vision.paused
      ? `Vision paused. ${state.name} can’t see this.`
      : resumed
        ? `Vision on. ${state.name} can see this again.`
        : '',
  );
  const togglePause = (paused: boolean) => {
    runtime.vision.setPaused(paused);
    setResumed(!paused);
  };
  const pauseKey = pauseKeyLabel(isApple());
  const offered = characters.characters ?? [];

  const characterTooltip =
    offered.length === 1 ? pickerCopy.chipSingle(state.name) : pickerCopy.chip;

  // Where the focus goes once the change that asked for it has rendered: set by a handler, taken
  // by the layout effect below in the same commit, so no key typed meanwhile lands elsewhere.
  const focusNext = useRef<
    | 'list'
    | 'bar'
    | 'chip'
    | 'character'
    | 'type'
    | 'controls'
    | 'lens'
    | 'pause'
    | 'gear'
    | 'change'
    | 'compact'
    | 'more'
    | null
  >(null);
  useLayoutEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const inStage = (selector: string) => stage.current?.querySelector<HTMLElement>(selector);
    const lens = inStage('.convai-capsule__lens');
    switch (target) {
      case 'list':
        document.querySelector<HTMLElement>('.va-transcript__list')?.focus();
        break;
      case 'bar':
        barTool.current?.focus();
        break;
      case 'chip':
        chip.current?.focus();
        break;
      case 'character':
        characterChip.current?.focus();
        break;
      case 'type':
        // The field gives the focus back to the Type tool that opened it.
        (inStage('.convai-capsule__tools button') ?? lens)?.focus();
        break;
      case 'controls':
        controls.current?.focus();
        break;
      case 'lens':
        lens?.focus();
        break;
      case 'pause':
        // Resume goes with the veil: the focus moves to the tool that pauses again.
        (inStage('.convai-capsule__app-tool') ?? lens)?.focus();
        break;
      case 'gear':
        gear.current?.focus();
        break;
      case 'change':
        // The picker opened from Settings gives the focus back to its Change.
        document.querySelector<HTMLElement>('.va-settings__change')?.focus();
        break;
      case 'compact':
        compactButton.current?.focus();
        break;
      case 'more':
        // Quick controls closed by Esc or its key: back to the capsule's More.
        (inStage('.convai-capsule__tools [aria-haspopup="dialog"]') ?? lens)?.focus();
        break;
    }
  });

  // Back from the floating window, the focus waits on the capsule's Lens, where it was there.
  const wasCompact = useRef(false);
  useLayoutEffect(() => {
    const left = wasCompact.current && compact.mode === 'full';
    wasCompact.current = compact.mode === 'compact';
    if (left) stage.current?.querySelector<HTMLElement>('.convai-capsule__lens')?.focus();
  }, [compact.mode]);

  const enterCompact = () => {
    setSourceMenu(false);
    setMenuOpen(false);
    setQuickOpen(false);
    runtime.compact.enter(settings.textScale);
  };

  const closeCompactCard = () => {
    runtime.compact.closeCard();
    focusNext.current = compactButton.current ? 'compact' : 'more';
  };

  const openTranscript = (open: boolean) => {
    setTranscript((current) => toggleTranscript(current, open));
    setMenuOpen(false);

    if (open) focusNext.current = 'list';
    else if (loose) focusNext.current = 'bar';
  };

  const openComposer = () => {
    if (capsule === null || capsule === 'connecting' || capsule === 'no-character') return;
    setQuickOpen(false);
    setComposerOpen(true);
  };

  const closeComposer = () => {
    setComposerOpen(false);
    session.forgetSend();
    focusNext.current = 'type';
  };

  const send = () => {
    if (session.send(draft)) runtime.replies.askOnce();
  };

  const changeDraft = (value: string) => {
    setDraft(value);
    if (value.trim() === '') session.forgetSend();
  };

  const openSourceMenu = (open: boolean) => {
    setSourceMenu(open);
    // Opened, the menu shows the cameras the browser lists now; it never starts one.
    if (open) void runtime.vision.refreshCameras();
  };

  const pickSource = (choice: Choice) => {
    setSourceMenu(false);

    if ((choice.kind === 'display' || choice.kind === 'region') && runtime.shareCard.isDue) {
      runtime.shareCard.countShown();
      setShareCard(choice);
      return;
    }
    // A tab, window or screen opens the browser's picker here, in the press.
    runtime.vision.choose(choice);
    focusNext.current = 'chip';
  };

  const chooseImageFile = () => {
    setSourceMenu(false);
    imageInput.current?.click();
    focusNext.current = 'chip';
  };

  const closeShareCard = (share: boolean) => {
    if (share && shareCard) runtime.vision.choose(shareCard);
    setShareCard(null);
    focusNext.current = 'chip';
  };

  const openPicker = () => {
    if (!state.character) return;
    setSourceMenu(false);
    setMenuOpen(false);
    setQuickOpen(false);
    setPickerOpen(true);
    runtime.characters.load().catch(() => undefined);
  };

  const closePicker = () => {
    setPickerOpen(false);
    focusNext.current = settingsOpen ? 'change' : 'character';
  };

  // Settings opens on the section it was last on; closed, the focus goes back to the gear.
  const openSettings = () => {
    setSourceMenu(false);
    setMenuOpen(false);
    setQuickOpen(false);
    setSettingsOpen(true);
  };

  const closeSettings = () => {
    setSettingsOpen(false);
    setRecording(false);
    setTipsAgain(false);
    focusNext.current = 'gear';
  };

  // Show welcome again: Settings gives way to the welcome; closed, the focus goes back to the gear.
  const showWelcome = () => {
    closeSettings();
    setWelcomeOpen(true);
  };

  const closeWelcome = () => {
    setWelcomeOpen(false);
    focusNext.current = 'gear';
  };

  // How you talk: the first run's store keeps it for the next visit, the session uses it now.
  const setTalkMode = (mode: TalkMode) => {
    runtime.firstRun.setTalkMode(mode);
    session.setTalkMode(mode);
  };

  // The microphone test is heard by nobody else: an open hands-free microphone is muted for it.
  const testMicrophone = (deviceId: string | null) => {
    const hears = state.talkMode === 'hands-free' && !state.muted && state.microphone === 'open';
    if (hears) session.toggleMute();
    void runtime.microphoneTest.start(deviceId).finally(() => {
      if (hears && session.state.muted) session.toggleMute();
    });
  };

  const talkTo = (character: Character) => {
    session.switchTo(character);
    closePicker();
  };

  // The character's own letters are ready before its first answer: fetched once it is live.
  const ownLetters = state.phase === 'live' ? lettersFor(state.character?.languages ?? []) : '';
  useEffect(() => prefetchLetters(ownLetters), [ownLetters]);

  // Choose another, on a source's banner, opens the source menu.
  useEffect(
    () =>
      runtime.vision.onIntent(() => {
        setSourceMenu(true);
        void runtime.vision.refreshCameras();
      }),
    [runtime],
  );

  // While an area is chosen, only what needs the person shows; toasts and tips wait for its end.
  const cropOpen = vision.crop !== null;
  useEffect(() => (cropOpen ? queue.hold(needsThePerson) : undefined), [cropOpen, queue]);

  const takesFiles =
    stageOverlay(state) === null &&
    state.character !== null &&
    shareCard === null &&
    !pickerOpen &&
    vision.crop === null;

  const onPaste = useEffectEvent((event: ClipboardEvent) => {
    const data = event.clipboardData;
    if (!takesFiles || !data) return;
    const files = filesOf(data);
    const takes = pasteTakes({
      files: files.length,
      hasText: carriesText(data),
      inTextField: isTextField(event.target),
    });
    const file = chooseImage(files);
    if (!takes || !file) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    runtime.vision.choose({ kind: 'image', file, pasted: true });
  });

  const dropHeld = useRef<number | undefined>(undefined);
  const onDrag = useEffectEvent((event: DragEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    const target = isElement(event.target) ? event.target : null;
    const takes = takesFiles && body.current?.contains(target) === true;
    if (event.dataTransfer) event.dataTransfer.dropEffect = takes ? 'copy' : 'none';
    window.clearTimeout(dropHeld.current);
    if (event.type === 'drop') {
      setDropping(false);
      const file = takes && event.dataTransfer ? chooseImage(filesOf(event.dataTransfer)) : null;
      if (file) runtime.vision.choose({ kind: 'image', file });
      return;
    }
    if (event.type === 'dragleave') {
      // Leaving one element for another is no leaving; leaving the page has nothing to go to.
      if (event.relatedTarget === null) setDropping(false);
      return;
    }
    setDropping(takes);
    // A drag taken to another window says nothing more: it is let go of once it stops telling.
    dropHeld.current = window.setTimeout(() => {
      setDropping(false);
    }, dragHeldMs);
  });

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      onPaste(event);
    };
    const drag = (event: DragEvent) => {
      onDrag(event);
    };
    const kinds = ['dragenter', 'dragover', 'dragleave', 'drop'] as const;
    document.addEventListener('paste', paste, true);
    for (const kind of kinds) document.addEventListener(kind, drag);
    return () => {
      document.removeEventListener('paste', paste, true);
      for (const kind of kinds) document.removeEventListener(kind, drag);
      window.clearTimeout(dropHeld.current);
    };
  }, []);

  // Type instead, from the ask or a microphone banner, opens the field.
  useEffect(
    () =>
      session.onIntent((intent) => {
        if (intent === 'sent') {
          setDraft('');
          setComposerOpen(false);
          focusNext.current = 'controls';
          return;
        }
        // Type instead: the field takes the focus as it opens.
        setComposerOpen(true);
        field.current?.focus();
      }),
    [session],
  );

  // Crossing 960 moves the transcript between the column and the floating panel.
  useEffect(() => {
    let wide = window.innerWidth >= pinFrom;
    const onResize = () => {
      const isWide = window.innerWidth >= pinFrom;
      if (isWide === wide) return;
      const hasTurns = session.state.items.length > 0;
      setTranscript((current) => transcriptOnResize(current, wide, isWide, hasTurns));
      wide = isWide;
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [session]);

  // In hands free the Lens listens through the microphone; with none given yet it asks for it.
  const listensWithout = state.talkMode === 'hands-free' && state.microphone === 'unknown';
  const microphoneOff =
    state.microphone === 'blocked' ||
    state.microphone === 'busy' ||
    state.microphone === 'none' ||
    listensWithout;
  // The capsule's state is said from here, a region that outlives the capsule (the Type field
  // replaces it), and not while the Island says the same change.
  const islandTells = useIslandHolds(queue, islandTellsKeys);

  const capsuleWords =
    capsule === null || overlay !== null || compact.mode === 'compact'
      ? null
      : capsuleCopy(state.name, capsule, state.talkMode, {
          askingMicrophone: state.microphone === 'asking',
          microphoneOff,
          talkKey: caps.talk,
        }).announce;
  const [capsuleHeld, setCapsuleHeld] = useState<CapsuleSpeech>({ held: '', told: null });
  const capsuleNext = capsuleSpeech(capsuleHeld, capsuleWords, islandTells);
  if (capsuleNext !== capsuleHeld) setCapsuleHeld(capsuleNext);
  const capsuleSaid = useAnnouncement(capsuleNext.held);
  const lensClick = (shown: CapsuleState) => {
    if (shown === 'thinking' || shown === 'speaking') session.stop();
    else if (state.talkMode === 'hands-free' && shown === 'ready' && microphoneOff)
      session.askForMicrophone();
    else if (shown === 'muted' || (state.talkMode === 'hands-free' && shown !== 'held'))
      session.toggleMute();
  };

  const floatRight = layout.place === 'float' ? floatTakes : 0;
  const showCapsuleArea = overlay === null && capsule !== null;

  const onStage = overlay === null && state.character !== null;
  const picture = onStage && vision.stream !== null ? vision.stream : null;

  const camera = picture !== null && vision.source?.kind === 'camera';
  const starting =
    onStage && picture === null && vision.share === 'starting' && vision.showStarting;

  const crop = onStage ? vision.crop : null;

  const pause: PauseControl | null = vision.paused
    ? {
        keyLabel: pauseKey,
        keyShortcuts: pauseKeyShortcuts,
        onResume: () => {
          togglePause(false);
          focusNext.current = 'pause';
        },
      }
    : null;
  const canPause = vision.paused || runtime.vision.canPause();
  // Why it cannot act, truly: a first area is being chosen, a source is on its way, or none is.
  const pauseReason =
    vision.crop !== null
      ? 'Finish choosing the area first'
      : vision.share === 'starting'
        ? 'Available once sharing has started'
        : 'Share something to pause vision';

  const moreOffered =
    showCapsuleArea &&
    !composerOpen &&
    compact.mode === 'full' &&
    state.microphone !== 'asking' &&
    capsule !== 'connecting' &&
    capsule !== 'no-character';
  const floats = runtime.compact.supported;
  const quickState: QuickState = {
    name: state.name,
    talkMode: state.talkMode,
    captions: settings.captions,
    transcriptOpen: transcript.open && !layout.continuum,
    continuum: layout.continuum,
    muted: state.muted,
    microphoneMissing: state.microphone === 'none',
    textScale: settings.textScale,
    typeKey: caps.type,
    paused: vision.paused,
    ...(canPause
      ? {}
      : {
          pauseBlocked: {
            cause:
              vision.crop !== null
                ? 'choosing'
                : vision.share === 'starting'
                  ? 'starting'
                  : 'nothing',
            detail: pauseReason,
          },
        }),
    sourceKind: vision.share === 'none' ? null : (vision.source?.kind ?? null),
    windowTile: showsWindowTile(floats, width),
    windowMode: compact.mode,
  };
  const quickPackage = packageTiles(quickState);
  const quickApp = appTiles(quickState);
  const quickWidth = widthOn(layout.stageWidth - floatRight);
  const capsuleHeight = (layout.capsule === 'compact' ? 56 : 64) * settings.textScale;

  const quickPlan = () => {
    const label = measureWith(`600 ${String(13 * settings.textScale)}px Inter`);
    const value = measureWith(`400 ${String(12 * settings.textScale)}px Inter`);
    const widest = Math.max(
      ...[...quickPackage, ...quickApp].flatMap((tile) => [
        label(tile.label),
        tile.reason === undefined ? value(tile.value) : 0,
      ]),
    );
    const content: PanelContent = {
      textScale: settings.textScale,
      packageTiles: quickPackage.length,
      appTiles: quickApp.length,
      columns: columnsFor(quickWidth, widest),
    };
    // Before the stage is laid out it is shown whole, as the kit does when it finds no place.
    if (stageHeight === 0) return { content, step: 0 as const };
    const free = freeRoom({
      height: stageHeight,
      width: layout.stageWidth,
      capsuleTop: 24 + capsuleHeight,

      islandBottom:
        islandTop(layout.place) + Math.max(bandHeight(settings.textScale), islandHeight),
    });
    return { content, step: stepFor(content, free) };
  };
  const plan = quickOpen && moreOffered ? quickPlan() : null;
  // The panel closes with More (a problem, Compact, the Type field, the ask), and where the stage
  // grew too low for even All settings alone.
  if (quickOpen && (!moreOffered || plan?.step === null)) setQuickOpen(false);
  const quickStep = plan?.step ?? null;
  const quickShown = quickStep !== null;

  const openQuick = () => {
    setSourceMenu(false);
    setMenuOpen(false);
    if (quickPlan().step === null) openSettings();
    else setQuickOpen(true);
  };

  const closeQuick = (backToMore: boolean) => {
    setQuickOpen(false);
    if (backToMore) focusNext.current = 'more';
  };

  const quickTile = (id: QuickTileId) => {
    switch (id) {
      case 'hands-free':
        setTalkMode(state.talkMode === 'hands-free' ? 'push-to-talk' : 'hands-free');
        break;
      case 'captions':
        runtime.settings.set({ captions: !settings.captions });
        break;
      case 'transcript':
        setTranscript((current) => toggleTranscript(current, !current.open));
        break;
      case 'type':
        openComposer();
        break;
      case 'mute':
        session.toggleMute();
        break;
      case 'pause-vision':
        togglePause(!vision.paused);
        break;
      case 'source':
        closeQuick(false);
        openSourceMenu(true);
        break;
      case 'text-size':
      case 'window':
        // Their options and their menu open inside the panel.
        break;
    }
  };

  const quickWindow = (mode: WindowMode) => {
    if (mode === 'full') return;
    closeQuick(false);
    enterCompact();
  };

  const act = useEffectEvent((action: KeyAction, event: KeyboardEvent) => {
    switch (action) {
      case 'talk-press':
        if (state.talkMode === 'push-to-talk' && capsule !== null) session.pressTalk();
        break;
      case 'talk-release':
        session.releaseTalk();
        return;
      case 'hands-free': {
        const next = state.talkMode === 'hands-free' ? 'push-to-talk' : 'hands-free';
        setTalkMode(next);
        setModeSaid(next === 'hands-free' ? shortcutCopy.handsFreeOn : shortcutCopy.handsFreeOff);
        break;
      }
      case 'mute':
        if (state.phase === 'no-character') return;
        session.toggleMute();
        break;
      case 'transcript':
        if (layout.continuum) return;
        openTranscript(!transcript.open);
        break;
      case 'type':
        openComposer();
        break;
      case 'quick':
        if (quickShown) closeQuick(true);
        else if (moreOffered) openQuick();
        else return;
        break;
      case 'close-quick':
        if (!quickEscape.current?.()) closeQuick(true);
        break;
      case 'pause-vision':
        if (!vision.paused && !runtime.vision.canPause()) return;
        // Resume from the pill takes the pill away: the focus goes to the tool, not to the page.
        if (document.activeElement?.closest('.va-paused__pill')) focusNext.current = 'pause';
        togglePause(!vision.paused);
        break;
      case 'close-menu':
        if (sourceMenu) {
          setSourceMenu(false);
          focusNext.current = 'chip';
        }
        if (compact.card) closeCompactCard();
        setMenuOpen(false);
        break;
      case 'close-dialog':
        if (welcomeOpen) closeWelcome();
        else if (pickerOpen) {
          if (!pickerEscape.current?.()) closePicker();
        } else if (settingsOpen) {
          if (!settingsEscape.current?.()) closeSettings();
        } else closeShareCard(false);
        break;
      case 'settings':
        if (settingsOpen) closeSettings();
        else openSettings();
        break;
      case 'characters':
        if (pickerOpen) closePicker();
        else if (state.character) openPicker();
        else return;
        break;
      case 'cancel-crop':
        runtime.vision.cancelCrop();
        focusNext.current = 'chip';
        break;
      case 'close-ask':
        session.dismissAsk();
        focusNext.current = 'lens';
        break;
      case 'close-composer':
        if (state.send === 'sending') break;
        if (draft !== '') changeDraft('');
        else closeComposer();
        break;
      case 'close-transcript':
        openTranscript(false);
        break;
      case 'island':
        // The Island dismisses its own toast on the same key.
        return;
      case 'stop':
        session.stop();
        break;
    }
    event.preventDefault();
  });

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    // An open tooltip takes Esc first (Esc layer 2); it closes itself.
    if (event.key === 'Escape' && document.querySelector('[role="tooltip"]')) return;
    const current = queue.current;
    const action = routeKey(
      keyInput(event),
      {
        menu: menuOpen || sourceMenu || compact.card,
        dialog: shareCard !== null || pickerOpen || settingsOpen || welcomeOpen,
        picker: pickerOpen,
        settings: settingsOpen,
        crop: cropOpen,
        quick: quickShown,
        ask: state.microphone === 'asking',
        composer: composerOpen,
        looseTranscript: loose && transcript.open,
        islandToast:
          current !== null &&
          !current.primary &&
          (current.level === 'status' || current.level === 'problem'),
        answering: session.isAnswering(),
        recording,
      },
      keys,
    );
    quietRing(event, action !== null);
    if (action) act(action, event);
  });

  // The Compact window's keys: the capsule's alone. Esc closes its toast, else stops a reply.
  const onCompactKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape' && event.type === 'keydown' && compact.notice) {
      runtime.compact.closeNotice();
      event.preventDefault();
      return;
    }
    const action = routeKey(
      keyInput(event),
      {
        menu: false,
        dialog: false,
        picker: false,
        settings: false,
        crop: false,
        quick: false,
        ask: false,
        composer: false,
        looseTranscript: false,
        islandToast: false,
        answering: session.isAnswering(),
        recording: false,
      },
      keys,
    );
    const own = action !== null && compactActions.has(action);
    quietRing(event, own);
    if (own) act(action, event);
  });

  const onCompactPaste = useEffectEvent((event: ClipboardEvent) => {
    const data = event.clipboardData;
    if (!data || !chooseImage(filesOf(data))) return;
    event.preventDefault();
    runtime.compact.refuseImage();
  });
  const onCompactDrag = useEffectEvent((event: DragEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    if (event.type === 'dragenter') runtime.compact.refuseImage();
  });

  // The notice stands in the capsule's place: any change of the capsule's state (a talk key, a
  // reply) takes it away at once, so the talk state is never hidden.
  useEffect(() => {
    runtime.compact.closeNotice();
  }, [capsule, runtime]);

  const floating = compact.window;
  useEffect(() => {
    if (!floating) return;
    const key = (event: KeyboardEvent) => {
      onCompactKey(event);
    };
    const paste = (event: ClipboardEvent) => {
      onCompactPaste(event);
    };
    const drag = (event: DragEvent) => {
      onCompactDrag(event);
    };

    const release = () => {
      session.releaseTalk();
    };
    const kinds = ['dragenter', 'dragover', 'drop'] as const;
    floating.addEventListener('keydown', key, true);
    floating.addEventListener('keyup', key, true);
    floating.addEventListener('blur', release);
    floating.addEventListener('pointerdown', pointerPressed, true);
    floating.document.addEventListener('paste', paste, true);
    for (const kind of kinds) floating.document.addEventListener(kind, drag);
    return () => {
      floating.removeEventListener('keydown', key, true);
      floating.removeEventListener('keyup', key, true);
      floating.removeEventListener('blur', release);
      floating.removeEventListener('pointerdown', pointerPressed, true);
      floating.document.removeEventListener('paste', paste, true);
      for (const kind of kinds) floating.document.removeEventListener(kind, drag);
    };
  }, [floating, session]);

  // The window's keys, ahead of the Island's (capture), so Esc closes one layer per press.
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      onKey(event);
    };

    const release = () => {
      session.releaseTalk();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') release();
    };
    window.addEventListener('keydown', listener, true);
    window.addEventListener('keyup', listener, true);
    window.addEventListener('blur', release);
    window.addEventListener('pointerdown', pointerPressed, true);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', listener, true);
      window.removeEventListener('keyup', listener, true);
      window.removeEventListener('blur', release);
      window.removeEventListener('pointerdown', pointerPressed, true);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [session]);

  // The capsule as the tab and the Compact window show it alike.
  const capsuleProps = (shown: CapsuleState) => ({
    name: state.name,
    state: shown,
    mode: state.talkMode,
    level: runtime.level,
    hasTalked: state.talks >= 3,
    askingMicrophone: state.microphone === 'asking',
    microphoneOff,
    talkKey: caps.talk,
    typeKey: caps.type,
    muteKey: caps.mute,
    onLens: () => {
      lensClick(shown);
    },
    onLensPress: () => {
      if (state.talkMode === 'push-to-talk') session.pressTalk();
    },
    onLensRelease: () => {
      session.releaseTalk();
    },
    onAction: () => {
      session.retry();
    },
  });

  const transcriptPanel = (place: 'pinned' | 'float' | 'sheet') => (
    <Transcript
      name={state.name}
      portrait={state.character?.portrait ?? null}
      items={state.items}
      place={place}
      style={style}
      width={layout.panelWidth}
      menuOpen={menuOpen}
      onMenu={setMenuOpen}
      onStyle={(value) => {
        runtime.settings.set({ transcriptStyle: value });
      }}
      onClose={() => {
        openTranscript(false);
      }}
      onRetry={(id) => {
        session.retryTurn(id);
      }}
      transcriptKey={caps.transcript}
    />
  );

  return (
    <TextScaleContext value={settings.textScale}>
      <div className="va-window" data-mirror={settings.mirrorCamera ? undefined : 'off'}>
        <TitleBar
          name={state.character ? state.name : null}
          portrait={state.character?.portrait ?? null}
          characterTooltip={characterTooltip}
          characterKey={charactersKeyLabel(isApple())}
          pickerOpen={pickerOpen}
          onCharacter={() => {
            if (pickerOpen) closePicker();
            else openPicker();
          }}
          characterRef={characterChip}
          width={width}
          source={(room) => (
            <>
              <SourceChip
                vision={vision}
                failureShows={failureShows}
                menuOpen={sourceMenu}
                onMenu={openSourceMenu}
                chipRef={chip}
                room={room}
              />
              {sourceMenu && (
                <SourceMenu
                  name={state.name}
                  vision={vision}
                  canShareDisplay={runtime.vision.canShareDisplay()}
                  anchor={chip}
                  onPick={pickSource}
                  canChangeArea={runtime.vision.canChangeArea()}
                  onChangeArea={() => {
                    setSourceMenu(false);
                    runtime.vision.changeArea();
                  }}
                  onChooseImage={chooseImageFile}
                  onClose={() => {
                    setSourceMenu(false);
                  }}
                />
              )}
            </>
          )}
          transcriptTool={layout.barTranscript}
          transcriptOpen={loose && transcript.open}
          onTranscript={() => {
            openTranscript(!transcript.open);
          }}
          transcriptToolRef={barTool}
          transcriptKey={caps.transcript}
          settingsKey={settingsKeyLabel(isApple())}
          modeSwitch={
            switchGivesWay(width) ? null : (
              <ModeSwitch
                mode={compact.mode}
                cardOpen={compact.card}
                cardSeen={compact.cardSeen}
                explains={!runtime.compact.supported}
                onFull={() => {
                  runtime.compact.leave();
                  runtime.compact.closeCard();
                }}
                onCompact={enterCompact}
                compactRef={compactButton}
              />
            )
          }
          settingsOpen={settingsOpen}
          onSettings={() => {
            if (settingsOpen) closeSettings();
            else openSettings();
          }}
          settingsRef={gear}
        />
        <main ref={body} className="va-body">
          <div
            ref={stage}
            className="va-stage"
            data-place={layout.place}
            style={{ ['--va-free-right' as string]: `${String(floatRight)}px` }}
          >
            <h1 className="convai-visually-hidden">Convai Vision Assistant</h1>
            {picture && camera && <CameraStage stream={picture} pause={pause} />}
            {picture && !camera && !crop && (
              <SharePreview
                stream={picture}
                line={
                  vision.source?.kind === 'image'
                    ? imageLine(vision.source.name, vision.paused)
                    : vision.paused
                      ? pausedLine(state.name)
                      : previewLine(state.name)
                }
                pause={pause}
                place={layout.place}
                floatRight={floatRight}
                stageWidth={layout.stageWidth}
                bannerShows={bannerShows}
              />
            )}
            {crop && (
              <RegionCrop
                key={`${crop.stream.id}:${String(crop.change)}`}
                crop={crop}
                place={layout.place}
                floatRight={floatRight}
                stageWidth={layout.stageWidth}
                stage={stage}
                requestShows={bannerShows}
                onArea={(area) => {
                  runtime.vision.moveArea(area);
                }}
                onShare={() => {
                  runtime.vision.shareArea();
                  focusNext.current = 'chip';
                }}
                onCancel={() => {
                  runtime.vision.cancelCrop();
                  focusNext.current = 'chip';
                }}
              />
            )}
            {starting && !crop && (
              <StartingSource
                slow={vision.slow}
                onCancel={() => {
                  runtime.vision.cancel();
                }}
              />
            )}
            {state.phase === 'no-character' && (
              <div className="va-nothing">
                <p className="va-nothing__title">Create a character to get started</p>
                <p className="va-nothing__line va-nothing__line--account">
                  Create a character in your{' '}
                  <a href="https://convai.com/" target="_blank" rel="noreferrer">
                    Convai account
                  </a>
                  , then reload this page.
                </p>
                <Button
                  kind="secondary"
                  shape="capsule"
                  onClick={() => {
                    window.location.reload();
                  }}
                >
                  Reload characters
                </Button>
              </div>
            )}
            {/* The drop target says what a drop does; the invitation would show through its veil. */}
            {onStage &&
              !layout.continuum &&
              picture === null &&
              !starting &&
              !crop &&
              !dropping && (
                <NothingShared
                  name={state.name}
                  stopped={vision.stopped}
                  underBanner={bannerShows}
                  onChoose={() => {
                    openSourceMenu(true);
                  }}
                />
              )}
            {dropping && takesFiles && (
              <DropTarget name={state.name} replaces={vision.share !== 'none'} />
            )}
            {layout.continuum && overlay === null && (
              <Continuum items={state.items} name={state.name} />
            )}
            {overlay !== null && (
              <Launch
                // Couldn't connect is a new element, so the alert that follows Connecting is said;
                // Boot to Connecting keeps its Lens, which eases from one to the other.
                key={overlay === 'failed' ? 'failed' : 'launch'}
                overlay={overlay}
                name={state.name}
                state={state}
                portrait={state.character?.portrait ?? null}
                line={spokenLanguages(state.character?.languages ?? [], navigator.language)
                  .map((language) => language.name)
                  // A language never starts a line alone: the dot stays with the name after it.
                  .join(` ·${String.fromCharCode(160)}`)}
                onRetry={() => {
                  session.retry();
                }}
              />
            )}
            {overlay === null && (
              <div
                ref={island}
                className="va-stage__island"
                data-place={layout.place}
                data-crop={crop ? true : undefined}
              >
                <Island queue={queue} overPicture={picture !== null || crop !== null} />
              </div>
            )}
            {showCapsuleArea && !composerOpen && state.microphone !== 'asking' && (
              <Captions
                state={state}
                mode={settings.captions ? captionMode(layout) : 'off'}
                width={layout.stageWidth - floatRight}
                backing={settings.captionBacking && camera}
              />
            )}
            {layout.place === 'sheet' && transcriptPanel('sheet')}
            {showCapsuleArea && (
              <div
                ref={controls}
                className="va-stage__controls"
                data-place={layout.place}
                tabIndex={-1}
              >
                {state.microphone === 'asking' && (
                  <MicrophoneAsk
                    name={state.name}
                    portrait={state.character?.portrait ?? null}
                    onAllow={() => {
                      session.allowMicrophone();
                    }}
                    onTypeInstead={() => {
                      session.typeInstead();
                    }}
                  />
                )}
                {composerOpen ? (
                  <Composer
                    name={state.name}
                    lens={lensOf(capsule)}
                    draft={draft}
                    onDraft={changeDraft}
                    canSend={state.phase === 'live'}
                    reason={sendReason(state)}
                    send={state.send}
                    onSend={send}
                    onClose={closeComposer}
                    fieldRef={field}
                  />
                ) : compact.mode === 'compact' ? (
                  <CompactAway
                    name={state.name}
                    onBack={() => {
                      runtime.compact.leave();
                    }}
                  />
                ) : (
                  <Capsule
                    {...capsuleProps(capsule)}
                    speaks={false}
                    compact={layout.capsule === 'compact'}
                    overPicture={camera}
                    onType={openComposer}
                    appTool={{
                      label: 'Pause vision',
                      tooltip: vision.paused ? 'Resume vision' : undefined,
                      icon: 'view-off',
                      shortcut: pauseKey,
                      keyShortcuts: pauseKeyShortcuts,
                      pressed: vision.paused,
                      reason: canPause ? undefined : pauseReason,
                      onClick: () => {
                        togglePause(!vision.paused);
                      },
                    }}
                    onMore={() => {
                      if (quickShown) closeQuick(false);
                      else openQuick();
                    }}
                    moreOpen={quickShown}
                    moreKey={caps.quick}
                  />
                )}
                {plan && quickStep !== null && (
                  <QuickControls
                    name={state.name}
                    portrait={state.character?.portrait ?? null}
                    line={spokenLanguages(state.character?.languages ?? [], navigator.language)
                      .map((language) => language.name)
                      .join(' · ')}
                    packageTiles={quickPackage}
                    appTiles={quickApp}
                    step={quickStep}
                    columns={plan.content.columns}
                    width={quickWidth}
                    textScale={settings.textScale}
                    overPicture={picture !== null}
                    settingsKeys={settingsKeyLabel(isApple())}
                    windowMode={compact.mode}
                    compactExplains={!floats}
                    anchor={controls}
                    escapeRef={quickEscape}
                    onTile={quickTile}
                    onWindow={quickWindow}
                    onTextSize={(textScale) => {
                      runtime.settings.set({ textScale });
                    }}
                    onChange={() => {
                      closeQuick(false);
                      openPicker();
                    }}
                    onSettings={() => {
                      closeQuick(false);
                      openSettings();
                    }}
                    onClose={() => {
                      closeQuick(false);
                    }}
                  />
                )}
              </div>
            )}
            {layout.place === 'float' && transcriptPanel('float')}
          </div>
          {layout.place === 'pinned' && transcriptPanel('pinned')}
        </main>
        {compact.card && (
          <CompactCard
            name={state.name}
            anchor={compactButton}
            overPicture={picture !== null}
            onClose={closeCompactCard}
          />
        )}
        {floating && (
          <CompactWindow
            window={floating}
            notice={compact.notice}
            onOpen={() => {
              runtime.compact.leave();
            }}
            onHoldNotice={(held) => {
              runtime.compact.holdNotice(held);
            }}
          >
            {/* Before the first connect there is no capsule in the tab: the window says Connecting. */}
            <Capsule
              {...capsuleProps(
                capsule ?? (state.phase === 'failed' ? 'unavailable' : 'connecting'),
              )}
              floating={{
                source: floatingSource(chipWords(vision, failureShows)),
                muted: state.muted,
                onMute: () => {
                  session.toggleMute();
                },
              }}
            />
          </CompactWindow>
        )}
        {shareCard && (
          <ShareCardDialog
            name={state.name}
            kind={shareCard.kind === 'region' ? 'tab' : shareCard.prefer}
            onContinue={() => {
              closeShareCard(true);
            }}
            onCancel={() => {
              closeShareCard(false);
            }}
          />
        )}
        {settingsOpen && (
          <Settings
            runtime={runtime}
            base={{
              name: state.name,
              character: state.character
                ? { line: characterLine(state), portrait: state.character.portrait }
                : null,
              talkMode: state.talkMode,
              talkKey: caps.talk,
              settings,
              set: (change) => {
                runtime.settings.set(change);
              },
              setTalkMode,
              openPicker,
              answering: session.isAnswering(),
              showWelcome,
              showTips: () => {
                setTipsReplay((count) => count + 1);
                setTipsAgain(true);
              },
              tipsAgain,
              tryTips: () => {
                setTipsReplay((count) => count + 1);
                closeSettings();
              },
            }}
            section={settingsSection}
            onSection={setSettingsSection}
            windowWidth={width}
            escapeRef={settingsEscape}
            onRecording={setRecording}
            onTest={testMicrophone}
            onClose={closeSettings}
          />
        )}
        {welcomeOpen && (
          <FirstRunReplay runtime={runtime} name={state.name} onClose={closeWelcome} />
        )}
        {pickerOpen && (
          <Suspense fallback={null}>
            <CharacterPicker
              list={characters}
              currentId={state.character?.id ?? null}
              recent={runtime.recent.list}
              fallback={fallbackName}
              windowWidth={width}
              deviceLanguage={navigator.language}
              escapeRef={pickerEscape}
              onTalk={talkTo}
              onRetry={() => {
                runtime.characters.load().catch(() => undefined);
              }}
              onClose={closePicker}
            />
          </Suspense>
        )}
        <Suspense fallback={null}>
          <Tips
            name={state.name}
            state={state}
            talkMode={state.talkMode}
            keys={caps}
            window={{
              blocked:
                !showCapsuleArea ||
                settingsOpen ||
                pickerOpen ||
                welcomeOpen ||
                shareCard !== null ||
                quickShown ||
                menuOpen ||
                sourceMenu ||
                compact.card ||
                compact.mode === 'compact' ||
                composerOpen ||
                cropOpen ||
                dropping ||
                bannerShows ||
                state.microphone === 'asking' ||
                capsule === 'held' ||
                capsule === 'listening',
              capsule: capsule === 'no-character' ? null : capsule,
              answering: session.isAnswering(),

              stageAction: onStage && !layout.continuum && picture === null && !crop && !dropping,
              captions: settings.captions && captionMode(layout) === 'on',
              microphoneOff:
                state.muted ||
                state.microphone === 'blocked' ||
                state.microphone === 'busy' ||
                state.microphone === 'none',
              microphoneWaiting: microphoneOff || state.microphone === 'asking',
              transcriptOpen: transcript.open && !layout.continuum,
              quickOpen: quickShown,
            }}
            replay={tipsReplay}
          />
        </Suspense>
        <span className="convai-visually-hidden" role="status">
          {capsuleSaid}
        </span>
        <span className="convai-visually-hidden" role="status">
          {announced}
        </span>
        <span className="convai-visually-hidden" role="status">
          {seenAnnounced}
        </span>
        <span className="convai-visually-hidden" role="status">
          {pausedAnnounced}
        </span>
        <span className="convai-visually-hidden" role="status">
          {modeAnnounced}
        </span>
        {/* Image…'s chooser: PNG and JPEG alone. Read, then emptied, so the same file can be chosen again. */}
        <input
          ref={imageInput}
          type="file"
          accept={imageAccept}
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            input.value = '';
            if (file) runtime.vision.choose({ kind: 'image', file });
          }}
        />
      </div>
    </TextScaleContext>
  );
}
