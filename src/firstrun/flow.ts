import type { WindowMode } from '../compact/compact';
import type { TalkMode } from '../kit/capsule/capsuleCopy';
import type { Access, Device } from './access';
import { firstRunCopy as copy } from './copy';
import { talkKeyLabel, type TalkKey } from './talkKey';

export type FirstRunStep =
  'welcome' | 'how-to-talk' | 'talk-key' | 'permissions' | 'window' | 'all-set';

/** One row of the Permissions step. */
export interface PermissionRow {
  device: Device;
  name: string;
  /** Why it is asked, or where it stands once refused. */
  line: string;
  /** The row's button ("Allow", "Try again"), or null for a row with none. */
  action: string | null;
  /** The row's button is the page's one primary action (white); every other row's is secondary. */
  primary: boolean;
  /** Allowed: the green check and "Allowed". */
  allowed: boolean;
  /** The quiet word at the end of a row with no button that is not allowed ("Blocked"). */
  stateWord: string | null;
  /** The warning dot on the row's glyph: the microphone, needed and not given. */
  warn: boolean;
}

/** One chip of All set: one per decision. Off ones are choices, with a neutral dot, never red. */
export interface AllSetChip {
  label: string;
  on: boolean;
  /** Where to mend it, for a chip that is only read. */
  tooltip?: string;
}

export interface FirstRunOptions {
  /** The character's name, in every line that speaks of them. */
  name: string;

  talkMode: TalkMode | null;
  talkKey: TalkKey;
  microphone: Access;
  camera: Access;
  /** Asks the browser for `device`: one prompt for one press. */
  ask: (device: Device) => Promise<Access>;
  /** How to talk was left by its button: the choice is the person's from here on. */
  onTalkMode: (mode: TalkMode) => void;
  /** The talk key was changed on its step. */
  onTalkKey: (key: TalkKey) => void;
  /**
   * The browser can float Compact's window: "Where should Kira stay?" has two modes to offer.
   * Without, the full window is the only one and the step is not shown.
   */
  compact?: boolean;
  /** The mode chosen before (a first run), or the one the window is in now (a replay). */
  windowMode?: WindowMode | null;
  /** "Where should Kira stay?" was left by its button: the mode chosen goes on with the run. */
  onWindowMode?: (mode: WindowMode) => void;
  /**
   * Start (or the replay's Done): the run is over and the conversation begins. Called in the
   * button's press, so the window chosen may be opened from it.
   */
  onDone: () => void;

  replay?: boolean;
}

export class FirstRunFlow {
  private readonly options: FirstRunOptions;
  private readonly listeners = new Set<() => void>();
  private steps: FirstRunStep[] = [];
  private index = 0;
  private mode: TalkMode;
  private window: WindowMode;
  private key: TalkKey;
  private access: Record<Device, Access>;
  private asking: Device | null = null;
  /** What the microphone stood at when it last changed, to notice access coming back. */
  private neededBefore: Access;
  private ended = false;
  private changes = 0;

  constructor(options: FirstRunOptions) {
    this.options = options;
    this.mode = options.talkMode ?? 'hands-free';
    this.window = options.windowMode ?? 'full';
    this.key = options.talkKey;
    this.access = { microphone: options.microphone, camera: options.camera };
    this.neededBefore = options.microphone;
    this.steps = this.lay();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Changes on every change, for `useSyncExternalStore`. */
  get version(): number {
    return this.changes;
  }

  get step(): FirstRunStep {
    return this.steps[this.index] ?? 'welcome';
  }

  get stepNumber(): number {
    return Math.min(this.index, this.counted);
  }

  get stepCount(): number {
    return this.counted > 1 ? this.counted : 0;
  }

  private get counted(): number {
    return this.steps.filter((step) => step !== 'welcome' && step !== 'all-set').length;
  }

  /** True for the welcome shown again from Settings. */
  get isReplay(): boolean {
    return this.options.replay === true;
  }

  get isDone(): boolean {
    return this.ended;
  }

  /** Back leads somewhere on every step between Welcome and All set. */
  get canGoBack(): boolean {
    return !this.ended && this.index > 0 && this.step !== 'all-set';
  }

  get talkMode(): TalkMode {
    return this.mode;
  }

  get talkKey(): TalkKey {
    return this.key;
  }

  /** The mode chosen on "Where should Kira stay?", or the one it starts at. */
  get windowMode(): WindowMode {
    return this.window;
  }

  get talkKeyLabel(): string {
    return talkKeyLabel(this.key);
  }

  accessOf(device: Device): Access {
    return this.access[device];
  }

  /** The device whose prompt is open, or null. */
  get askingDevice(): Device | null {
    return this.asking;
  }

  // The run --------------------------------------------------------------------------------------

  next(): void {
    if (this.ended) return;
    if (this.step === 'how-to-talk' && !this.options.replay) this.options.onTalkMode(this.mode);
    if (this.step === 'window' && !this.options.replay) this.options.onWindowMode?.(this.window);
    this.advance();
  }

  back(): boolean {
    if (!this.canGoBack) return false;
    this.index--;
    this.changed();
    return true;
  }

  /** Chooses a way of talking on How to talk; the talk key's step is there for push to talk. */
  choose(mode: TalkMode): void {
    if (this.ended || mode === this.mode) return;
    this.mode = mode;
    this.recount();
    this.changed();
  }

  /** Chooses where the character stays, on its step; nothing opens before Start. */
  chooseWindow(mode: WindowMode): void {
    if (this.ended || mode === this.window) return;
    this.window = mode;
    this.changed();
  }

  /** The talk key changed on its step. */
  setTalkKey(key: TalkKey): void {
    if (key === this.key) return;
    this.key = key;
    this.options.onTalkKey(key);
    this.changed();
  }

  /** A row's button: asks the browser, once. A blocked row has no button: nothing happens. */
  act(device: Device): void {
    if (this.ended || this.asking !== null) return;
    if (this.actionOf(device) === null) return;
    this.asking = device;
    this.changed();
    void this.options.ask(device).then(
      (access) => {
        this.asking = null;
        this.set(device, access);
      },
      () => {
        this.asking = null;
        this.changed();
      },
    );
  }

  set(device: Device, access: Access): void {
    if (this.ended) return;
    // A closed camera prompt asks again with Allow: the camera is optional, so it is not a refusal.
    const now = device === 'camera' && access === 'refused' ? 'not-asked' : access;
    if (this.access[device] === now) {
      this.changed();
      return;
    }
    this.access[device] = now;
    const cameBack =
      device === 'microphone' &&
      this.step === 'permissions' &&
      this.neededBefore === 'blocked' &&
      now === 'allowed' &&
      this.access.camera !== 'not-asked';
    if (device === 'microphone') this.neededBefore = now;
    this.recount();
    if (cameBack) this.next();
    else this.changed();
  }

  private advance(): void {
    if (this.index < this.steps.length - 1) {
      this.index++;
      this.changed();
      return;
    }
    this.ended = true;
    this.changed();
    this.options.onDone();
  }

  /** The run as it stands now: the fixed order, each step on or off by its own rule. */
  private lay(): FirstRunStep[] {
    const steps: FirstRunStep[] = ['welcome', 'how-to-talk'];
    if (!this.options.replay) {
      if (this.mode === 'push-to-talk') steps.push('talk-key');
      if (this.asksSomething()) steps.push('permissions');
    }

    if (this.options.compact) steps.push('window');
    if (!this.options.replay) steps.push('all-set');
    return steps;
  }

  /** The steps after the one that shows follow what was chosen; the ones up to it stay. */
  private recount(): void {
    const kept = this.steps.slice(0, this.index + 1);
    const here = order.indexOf(this.step);
    this.steps = [...kept, ...this.lay().filter((step) => order.indexOf(step) > here)];
  }

  /** The Permissions step is there while something is left to ask. */
  private asksSomething(): boolean {
    const { microphone, camera } = this.access;
    return (microphone !== 'allowed' && microphone !== 'missing') || camera === 'not-asked';
  }

  // Permissions ----------------------------------------------------------------------------------

  get rows(): PermissionRow[] {
    return [this.microphoneRow(), this.cameraRow()];
  }

  private actionOf(device: Device): string | null {
    switch (this.access[device]) {
      case 'not-asked':
        return copy.allow;
      case 'refused':
      case 'busy':
        return copy.tryAgain;
      default:
        return null;
    }
  }

  private microphoneRow(): PermissionRow {
    const access = this.access.microphone;
    const action = this.actionOf('microphone');
    return {
      device: 'microphone',
      name: copy.microphone,
      line:
        access === 'refused'
          ? copy.microphoneRefused(this.options.name)
          : access === 'blocked'
            ? copy.blockedReason
            : access === 'busy'
              ? copy.microphoneInUse
              : copy.microphonePurpose,
      action,
      // The microphone's button is the page's primary while it is needed and not given.
      primary: action !== null,
      allowed: access === 'allowed',
      stateWord:
        access === 'blocked' ? copy.blocked : access === 'missing' ? copy.noMicrophone : null,
      warn: access === 'refused' || access === 'blocked' || access === 'busy',
    };
  }

  private cameraRow(): PermissionRow {
    const access = this.access.camera;
    const { name } = this.options;
    return {
      device: 'camera',
      name: copy.camera,
      line: access === 'blocked' ? copy.cameraBlocked : copy.cameraPurpose(name),
      action: this.actionOf('camera'),
      primary: false,
      allowed: access === 'allowed',
      stateWord:
        access === 'blocked' ? copy.blocked : access === 'missing' ? copy.cameraMissing : null,
      warn: false,
    };
  }

  // What a step says -----------------------------------------------------------------------------

  get buttonIsPrimary(): boolean {
    if (this.step !== 'permissions' || this.access.microphone === 'not-asked') return true;
    return !this.rows.some((row) => row.primary);
  }

  get buttonLabel(): string {
    if (this.options.replay && this.index === this.steps.length - 1) return copy.done;
    switch (this.step) {
      case 'welcome':
        return copy.getStarted;
      case 'how-to-talk':
        return copy.continueWith(modeName(this.mode));
      case 'talk-key':
      case 'window':
        return copy.continue;
      case 'permissions':
        // Once the microphone was answered and cannot be used, typing is the way on.
        return this.access.microphone === 'allowed' || this.access.microphone === 'not-asked'
          ? copy.continue
          : copy.typeInstead;
      case 'all-set':
        return copy.start;
    }
  }

  get title(): string {
    const { name } = this.options;
    switch (this.step) {
      case 'welcome':
        return copy.welcomeTitle(name);
      case 'how-to-talk':
        return copy.talkTitle;
      case 'talk-key':
        return copy.talkKeyTitle;
      case 'permissions':
        return this.access.microphone === 'refused' || this.access.microphone === 'blocked'
          ? copy.refusedTitle
          : copy.accessTitle(name);
      case 'window':
        return copy.windowTitle(name);
      case 'all-set':
        return copy.allSetTitle;
    }
  }

  get body(): string {
    const { name } = this.options;
    switch (this.step) {
      case 'welcome':
        return copy.welcomeBody;
      case 'how-to-talk':
        return copy.talkBody;
      case 'talk-key':
        return copy.talkKeyBody(name);
      case 'permissions':
        if (this.access.microphone === 'refused') return copy.refusedBody;
        if (this.access.microphone === 'blocked') return copy.blockedBody;
        if (this.access.microphone === 'missing') return copy.missingBody;
        if (this.access.microphone === 'busy') return copy.busyBody;
        // The camera can wait while it will be asked when first shared.
        return this.access.camera === 'not-asked' ? copy.accessBodyCameraWaits : copy.accessBody;
      case 'window':
        return copy.windowBody;
      case 'all-set':
        return this.allSetLine();
    }
  }

  /** The quiet line under the rows on Permissions, under the chips on All set; else empty. */
  get note(): string {
    const microphone = this.access.microphone;
    if (this.step === 'permissions') {
      if (microphone === 'refused') return copy.refusedNote;
      if (microphone === 'blocked') return copy.blockedNote;
      return copy.accessNote(this.options.name);
    }
    if (this.step !== 'all-set') return '';
    if (microphone === 'not-asked')
      return this.mode === 'hands-free'
        ? copy.askedLaterHandsFree(this.options.name)
        : copy.askedLater(this.options.name, this.talkKeyLabel);
    if (microphone === 'refused' || microphone === 'blocked') return copy.blockedLaterNote;
    return '';
  }

  /** All set's lines for what the browser keeps from the app, after the note. */
  get allSetNotes(): string[] {
    return this.step === 'all-set' && this.access.camera === 'blocked'
      ? [copy.cameraBlockedNote(this.options.name)]
      : [];
  }

  /** A mode's name ("Hands free"). */
  modeName(mode: TalkMode): string {
    return modeName(mode);
  }

  /** The line under a mode's name on its card. */
  modeLine(mode: TalkMode): string {
    const { name } = this.options;
    return mode === 'hands-free'
      ? copy.handsFreeLine(name)
      : copy.pushToTalkLine(name, this.talkKeyLabel);
  }

  /** A window mode's name ("Compact"), on its card and its chip. */
  windowName(mode: WindowMode): string {
    return mode === 'compact' ? copy.compact : copy.fullWindow;
  }

  /** The line under a window mode's name on its card. */
  windowLine(mode: WindowMode): string {
    return mode === 'compact' ? copy.compactLine : copy.fullWindowLine;
  }

  /** What a screen reader hears when the step shows: "Step 1 of 3, How do you want to talk?". */
  get announcement(): string {
    return this.stepNumber === 0 || this.stepCount === 0 || this.step === 'all-set'
      ? this.title
      : copy.step(this.stepNumber, this.stepCount, this.title);
  }

  /**
   * All set's chips: the way of talking, the microphone, the camera where it was decided, and the
   * window mode where it was chosen.
   */
  get chips(): AllSetChip[] {
    const microphone = this.access.microphone;

    const voice = microphone === 'allowed' || microphone === 'not-asked';
    const chips: AllSetChip[] = [];
    if (voice)
      chips.push({
        label:
          this.mode === 'push-to-talk'
            ? copy.modeWithKey(modeName(this.mode), this.talkKeyLabel)
            : modeName(this.mode),
        on: true,
      });
    else chips.push({ label: copy.typing, on: true });
    chips.push({
      label:
        microphone === 'not-asked'
          ? copy.microphoneWhenTalking
          : voice
            ? copy.microphone
            : microphone === 'missing'
              ? copy.noMicrophone
              : microphone === 'busy'
                ? copy.microphoneBusy
                : copy.microphoneOff,
      on: microphone === 'allowed',
    });
    const camera = this.access.camera;
    if (camera === 'allowed') chips.push({ label: copy.camera, on: true });
    else if (camera === 'not-asked') chips.push({ label: copy.cameraWhenShared, on: false });
    else if (camera === 'blocked')
      chips.push({ label: copy.cameraBlockedChip, on: false, tooltip: copy.cameraBlockedTooltip });

    if (this.steps.includes('window'))
      chips.push({ label: this.windowName(this.window), on: true });
    return chips;
  }

  /** The line under "You're all set" follows the choices. */
  private allSetLine(): string {
    const { name } = this.options;
    const microphone = this.access.microphone;
    if (microphone !== 'allowed' && microphone !== 'not-asked') {
      const line = copy.allSetTyping(name);
      if (microphone === 'missing') return copy.allSetBecause(copy.noMicrophone, line);
      if (microphone === 'busy') return copy.allSetBecause(copy.microphoneInUse, line);
      return line;
    }
    return this.mode === 'hands-free'
      ? copy.allSetHandsFree(name)
      : copy.allSetPushToTalk(name, this.talkKeyLabel);
  }

  private changed(): void {
    this.changes++;
    for (const listener of [...this.listeners]) listener();
  }
}

const order: readonly FirstRunStep[] = [
  'welcome',
  'how-to-talk',
  'talk-key',
  'permissions',
  'window',
  'all-set',
];

function modeName(mode: TalkMode): string {
  return mode === 'hands-free' ? copy.handsFree : copy.pushToTalk;
}
