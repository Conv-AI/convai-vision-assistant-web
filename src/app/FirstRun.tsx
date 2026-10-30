import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Button } from '../kit/controls/Button';
import { Tooltip } from '../kit/controls/Tooltip';
import { Icon, type IconName } from '../kit/icons';
import { Lens } from '../kit/lens/Lens';
import type { LensState } from '../kit/lens/lensLabel';
import type { TalkMode } from '../kit/capsule/capsuleCopy';
import {
  askAccess,
  browserAccess,
  followRead,
  readAccess,
  type AccessBrowser,
  type Device,
} from '../firstrun/access';
import { firstRunCopy as copy } from '../firstrun/copy';
import { FirstRunFlow, type FirstRunStep, type PermissionRow } from '../firstrun/flow';
import { loadGiveUpMs } from '../characters/list';
import type { WindowMode } from '../compact/compact';
import { recordTalkKey } from '../firstrun/talkKey';
import { useModal } from '../kit/dialog/useModal';
import { useAnnouncement } from '../kit/useAnnouncement';
import { useReducedMotion, useWindowWidth } from './hooks';
import { isApple, isTextField } from './keys';
import type { Runtime } from './runtime';

interface FirstRunProps {
  runtime: Runtime;
  /** The run ended with Start, or there was nothing to run it for: the session window comes. */
  onDone: () => void;
  /** The browser, for a test to stand in for. */
  access?: AccessBrowser;
}

export function FirstRun({ runtime, onDone, access = browserAccess }: FirstRunProps) {
  const reducedMotion = useReducedMotion(runtime.settings);
  const [flow, setFlow] = useState<{ flow: FirstRunFlow; name: string } | null>(null);
  const askedMicrophone = useRef(false);
  const finish = useEffectEvent(onDone);

  useEffect(() => {
    let cancelled = false;
    const { characters, recent, firstRun, session, compact } = runtime;

    const giveUp = setTimeout(() => {
      cancelled = true;
      finish();
    }, loadGiveUpMs);
    void Promise.all([
      characters.loadInitial().catch(() => null),
      readAccess(access, 'microphone'),
      readAccess(access, 'camera'),
    ]).then(([list, microphone, camera]) => {
      if (cancelled) return;
      clearTimeout(giveUp);
      const character =
        list?.find((one) => one.id === recent.list[0]) ?? list?.find((one) => one.name !== null);
      if (!character?.name) {
        finish();
        return;
      }
      const run: FirstRunFlow = new FirstRunFlow({
        name: character.name,
        talkMode: firstRun.talkMode,
        talkKey: firstRun.talkKey,
        microphone,
        camera,
        ask: (device) => {
          if (device === 'microphone') askedMicrophone.current = true;
          return askAccess(access, device);
        },
        onTalkMode: (mode) => {
          firstRun.setTalkMode(mode);
          session.setTalkMode(mode);
        },
        onTalkKey: (key) => {
          firstRun.setTalkKey(key);
        },
        compact: compact.supported,
        windowMode: firstRun.windowMode,
        onWindowMode: (mode) => {
          firstRun.setWindowMode(mode);
        },
        onDone: () => {
          firstRun.markDone();
          if (askedMicrophone.current) session.microphoneAskedBefore();
          if (run.accessOf('microphone') === 'allowed') session.microphoneAllowed();

          goToWindow(runtime, run.windowMode);
          finish();
        },
      });
      setFlow({ name: character.name, flow: run });
    });
    return () => {
      cancelled = true;
      clearTimeout(giveUp);
    };
  }, [runtime, access]);

  if (!flow) {
    // The Lens waits where Welcome will show it, so nothing moves when the words come.
    return (
      <div className="va-first-run" aria-busy="true">
        <div className="va-first-run__scroll">
          <div className="va-first-run__column">
            <Lens name="" state="ready" size={72} decorative />
          </div>
        </div>
      </div>
    );
  }
  return (
    <FirstRunPage flow={flow.flow} name={flow.name} access={access} reducedMotion={reducedMotion} />
  );
}

/**
 * Moves the window to the mode the run chose, in the press of its last button: Compact asks the
 * browser for the floating window there and then. Nothing happens where there is no choice.
 */
function goToWindow({ compact, settings }: Runtime, mode: WindowMode): void {
  if (!compact.supported) return;
  if (mode === 'compact') compact.enter(settings.state.textScale);
  else compact.leave();
}

export function FirstRunReplay({
  runtime,
  name,
  onClose,
}: {
  runtime: Runtime;
  name: string;
  onClose: () => void;
}) {
  const box = useRef<HTMLDialogElement>(null);
  useModal(box, onClose);
  const reducedMotion = useReducedMotion(runtime.settings);
  const [flow] = useState(() => {
    const run: FirstRunFlow = new FirstRunFlow({
      name,
      talkMode: runtime.session.state.talkMode,
      talkKey: runtime.shortcuts.keys.talk,
      // Nothing is asked: the replay has no Permissions step.
      microphone: 'allowed',
      camera: 'allowed',
      ask: () => Promise.resolve('allowed'),
      onTalkMode: () => undefined,
      onTalkKey: () => undefined,
      compact: runtime.compact.supported,
      windowMode: runtime.compact.state.mode,
      onDone: () => {
        goToWindow(runtime, run.windowMode);
      },
      replay: true,
    });
    return run;
  });
  // Done ends the flow; the layer closes once it has.
  const done = useSyncExternalStore(
    (onChange) => flow.subscribe(onChange),
    () => flow.isDone,
  );
  useEffect(() => {
    if (done) onClose();
  }, [done, onClose]);
  return (
    <dialog ref={box} className="va-first-run-replay" aria-label={copy.welcomeTitle(name)}>
      <FirstRunPage flow={flow} name={name} access={replayAccess} reducedMotion={reducedMotion} />
    </dialog>
  );
}

/** The replay asks and watches nothing: it has no Permissions step. */
const replayAccess: AccessBrowser = {
  permission: () => Promise.resolve(null),
  watchPermission: () => () => undefined,
  hasDevice: () => Promise.resolve(null),
  watchDevices: () => () => undefined,
  open: () => Promise.resolve(),
  now: () => performance.now(),
};

function useFlow(flow: FirstRunFlow): void {
  useSyncExternalStore(
    (onChange) => flow.subscribe(onChange),
    () => flow.version,
  );
}

function lensOf(flow: FirstRunFlow, demo: LensState): LensState {
  switch (flow.step) {
    case 'welcome':
      return demo;
    case 'how-to-talk':
      return flow.talkMode === 'hands-free' ? 'listening' : 'ready';
    case 'permissions': {
      const microphone = flow.accessOf('microphone');
      return microphone === 'refused' || microphone === 'blocked' ? 'muted' : 'ready';
    }
    default:
      return 'ready';
  }
}

function FirstRunPage({
  flow,
  name,
  access,
  reducedMotion,
}: {
  flow: FirstRunFlow;
  name: string;
  access: AccessBrowser;
  /** Settings' Reduce motion as it resolves now (System follows the browser). */
  reducedMotion: boolean;
}) {
  useFlow(flow);
  const step = flow.step;
  const demo = useWelcomeDemo(step === 'welcome', reducedMotion);
  const heading = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // The talk key's row records on its step; Back and Continue end it with the step.
  const [recording, setRecording] = useState(false);
  const go = useRef<HTMLButtonElement>(null);
  const [more, setMore] = useState<{ above: boolean; below: boolean }>({
    above: false,
    below: false,
  });
  const first = useRef(true);

  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
    scroller.current?.scrollTo({ top: 0 });
  }, [step]);

  useEffect(() => {
    const look = (device: Device) => {
      void readAccess(access, device).then((read) => {
        flow.set(device, followRead(flow.accessOf(device), read));
      });
    };
    const stops = [
      access.watchPermission('microphone', () => {
        look('microphone');
      }),
      access.watchPermission('camera', () => {
        look('camera');
      }),
      access.watchDevices(() => {
        look('microphone');
        look('camera');
      }),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [flow, access]);

  // The column scrolls when it no longer fits; a fade at the foot says there is more (0.47.0-b).
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const measure = () => {
      setMore({
        above: box.scrollTop > 0,
        below: box.scrollTop + box.clientHeight < box.scrollHeight - 1,
      });
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(box);
    if (box.firstElementChild) resize.observe(box.firstElementChild);
    box.addEventListener('scroll', measure);
    return () => {
      resize.disconnect();
      box.removeEventListener('scroll', measure);
    };
  }, [step]);

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (recording || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      if (flow.back()) event.preventDefault();
      return;
    }
    if (event.key !== 'Enter' || event.repeat) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    // A button or a field takes its own Enter; the mode cards' Enter continues.
    if (target?.closest('button, a, [role="button"]') || isTextField(target)) return;
    event.preventDefault();
    flow.next();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      onKey(event);
    };
    window.addEventListener('keydown', listener);
    return () => {
      window.removeEventListener('keydown', listener);
    };
  }, []);

  return (
    <div className="va-first-run">
      {flow.canGoBack && (
        <button
          type="button"
          className="va-first-run__back"
          onClick={() => {
            setRecording(false);
            flow.back();
          }}
        >
          <Icon name="back" size={14} />
          {copy.back}
        </button>
      )}
      {flow.stepNumber > 0 && flow.stepCount > 0 && (
        <div className="va-first-run__dashes" aria-hidden="true">
          {Array.from({ length: flow.stepCount }, (_, i) => (
            <span
              key={i}
              className={
                i < flow.stepNumber
                  ? 'va-first-run__dash va-first-run__dash--on'
                  : 'va-first-run__dash'
              }
            />
          ))}
        </div>
      )}
      <div
        ref={scroller}
        className="va-first-run__scroll"
        data-more={more.below || undefined}
        data-scrolled={more.above || undefined}
      >
        <main className="va-first-run__column" data-step={step}>
          {/* A picture of the turn the step teaches: its states are a demo nobody is in, so it says
              nothing to a screen reader, which has the step's words. */}
          <Lens name={name} state={lensOf(flow, demo.lens)} size={72} decorative />
          {/* The step's words and controls come in together; the Lens stays (kit F6). */}
          <div key={step} className="va-first-run__step">
            <div className="va-first-run__words">
              <h1 ref={heading} tabIndex={-1} className="va-first-run__title">
                {flow.announcement !== flow.title && (
                  <span className="convai-visually-hidden">
                    {copy.step(flow.stepNumber, flow.stepCount, '')}
                  </span>
                )}
                {flow.title}
              </h1>
              <p className="va-first-run__body">{flow.body}</p>
            </div>
            <StepContent
              flow={flow}
              name={name}
              step={step}
              demo={demo}
              recording={recording}
              onRecording={setRecording}
              onRowGone={() => go.current?.focus()}
            />
            <div className="va-first-run__actions">
              <Button
                ref={go}
                kind={flow.buttonIsPrimary ? 'primary' : 'secondary'}
                size="extra-large"
                className="va-first-run__go"
                onClick={() => {
                  setRecording(false);
                  flow.next();
                }}
              >
                {flow.buttonLabel}
              </Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function StepContent({
  flow,
  name,
  step,
  demo,
  recording,
  onRecording,
  onRowGone,
}: {
  flow: FirstRunFlow;
  name: string;
  step: FirstRunStep;
  demo: WelcomeDemo;
  recording: boolean;
  onRecording: (recording: boolean) => void;
  /** A row's focused button went (Allowed, Blocked): the focus goes on to the large button. */
  onRowGone: () => void;
}) {
  switch (step) {
    case 'welcome':
      return <WelcomeTurn demo={demo} />;
    case 'how-to-talk':
      return <ModeCards flow={flow} />;
    case 'talk-key':
      return <TalkKeyStep flow={flow} recording={recording} onRecording={onRecording} />;
    case 'permissions':
      return <PermissionRows flow={flow} onRowGone={onRowGone} />;
    case 'window':
      return <WindowCards flow={flow} name={name} />;
    case 'all-set':
      return <AllSetChips flow={flow} />;
  }
}

interface WelcomeDemo {
  /** 0 nothing yet, 1 the question, 2 thinking, 3 the first line read, 4 the turn held. */
  phase: number;
  lens: LensState;
}

/** The phases' starts in ms: question 0.4 s, thinking 1.2 s, the answer line by line, held at 6 s. */
const demoAt = [0, 400, 1600, 3800, 6000] as const;

/**
 * The turn plays once in 6 s, then holds; under Reduce motion it is the finished turn, still, and
 * it becomes that at once if Reduce motion comes on while it plays.
 */
function useWelcomeDemo(playing: boolean, reducedMotion: boolean): WelcomeDemo {
  const [played, setPhase] = useState(0);
  const phase = reducedMotion ? 4 : played;
  useEffect(() => {
    if (!playing || phase === 4) return;
    const next = phase + 1;
    const timer = setTimeout(
      () => {
        setPhase(next);
      },
      (demoAt[next] ?? 0) - (demoAt[phase] ?? 0),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [playing, phase]);
  const lens: LensState =
    phase === 1 ? 'listening' : phase === 2 ? 'thinking' : phase === 3 ? 'speaking' : 'ready';
  return { phase, lens };
}

function WelcomeTurn({ demo }: { demo: WelcomeDemo }) {
  const [first, second] = copy.welcomeAnswer;

  return (
    <div className="va-first-run__turn" aria-hidden="true">
      <div className="va-first-run__ask" data-shown={demo.phase >= 1 || undefined}>
        {copy.welcomeQuestion}
      </div>
      <div className="va-first-run__answer" data-shown={demo.phase >= 3 || undefined}>
        {first}{' '}
        <span className={demo.phase >= 4 ? undefined : 'va-first-run__unread'}>{second}</span>
      </div>
    </div>
  );
}

const modes: readonly TalkMode[] = ['hands-free', 'push-to-talk'];
const waveBars = [10, 20, 32, 16, 26, 34, 14, 22, 8] as const;

export const stackModesBelow = 720;

function ChoiceCards<T extends string>({
  label,
  values,
  chosen,
  choose,
  name,
  line,
  picture,
  well,
  place = false,
}: {
  label: string;
  values: readonly T[];
  chosen: T;
  choose: (value: T) => void;
  name: (value: T) => string;
  line: (value: T) => string;
  picture: (value: T) => ReactNode;
  /** A class for every card's well besides the kit's. */
  well?: string;

  place?: boolean;
}) {
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const ids = useId();
  const onKeyDown = (event: ReactKeyboardEvent, value: T) => {
    if (event.key === ' ') {
      event.preventDefault();
      choose(value);
      return;
    }
    const keys: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    const step = keys[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const at = values.indexOf(chosen);
    const next = values[(at + step + values.length) % values.length] ?? chosen;
    choose(next);
    cards.current[values.indexOf(next)]?.focus();
  };
  return (
    <div
      className={place ? 'va-first-run__modes va-first-run__modes--place' : 'va-first-run__modes'}
      role="radiogroup"
      aria-label={label}
    >
      {values.map((value, i) => {
        const on = chosen === value;
        return (
          <div
            key={value}
            ref={(card) => {
              cards.current[i] = card;
            }}
            role="radio"
            aria-checked={on}
            // The name is the mode's; its line follows as the description.
            aria-labelledby={`${ids}-${value}-name`}
            aria-describedby={`${ids}-${value}-line`}
            tabIndex={on ? 0 : -1}
            className={
              place ? 'va-first-run__mode va-first-run__mode--place' : 'va-first-run__mode'
            }
            onClick={() => {
              choose(value);
            }}
            onKeyDown={(event) => {
              onKeyDown(event, value);
            }}
          >
            <div
              className={well ? `va-first-run__well ${well}` : 'va-first-run__well'}
              aria-hidden="true"
            >
              {picture(value)}
            </div>
            <div className="va-first-run__mode-words">
              <span className="va-first-run__mode-name">
                <span id={`${ids}-${value}-name`}>{name(value)}</span>
                <span className="va-first-run__radio" aria-hidden="true">
                  <span className="va-first-run__radio-dot" />
                </span>
              </span>
              <span id={`${ids}-${value}-line`} className="va-first-run__mode-line">
                {line(value)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ModeCards({ flow }: { flow: FirstRunFlow }) {
  const stacked = useWindowWidth() < stackModesBelow;
  return (
    <ChoiceCards
      label={copy.talkTitle}
      values={modes}
      chosen={flow.talkMode}
      choose={(mode) => {
        flow.choose(mode);
      }}
      name={(mode) => flow.modeName(mode)}
      line={(mode) => flow.modeLine(mode)}
      picture={(mode) => (
        <>
          {mode === 'push-to-talk' && flow.talkKeyLabel !== '' && (
            <span className="va-first-run__well-key">{flow.talkKeyLabel}</span>
          )}
          <Lens name="" state="listening" size={stacked ? 32 : 56} decorative />
          {mode === 'hands-free' && (
            <span className="va-first-run__wave">
              {waveBars.map((height, bar) => (
                <span
                  key={bar}
                  className="va-first-run__bar"
                  style={{ height: `${String(height)}px` }}
                />
              ))}
            </span>
          )}
        </>
      )}
    />
  );
}

const windowModes: readonly WindowMode[] = ['full', 'compact'];

/** A place on the small screen, in per cent: left, top, width, height. */
type Place = readonly [number, number, number, number];

const windowPictures: Record<WindowMode, { app: Place | null; kira: Place }> = {
  full: { app: null, kira: [6, 8, 88, 84] },
  compact: { app: [5, 10, 90, 80], kira: [56, 72, 36, 14] },
};

function placeStyle([left, top, width, height]: Place): CSSProperties {
  const at = (value: number) => `${String(value)}%`;
  return { left: at(left), top: at(top), width: at(width), height: at(height) };
}

/** A card's picture: the screen, another app's window on it, and the character's window. */
function WindowPicture({ mode }: { mode: WindowMode }) {
  const { app, kira } = windowPictures[mode];
  return (
    <span className="va-stay-picture">
      {app && <span className="va-stay-picture__app" style={placeStyle(app)} />}
      <span
        className={
          mode === 'compact'
            ? 'va-stay-picture__kira va-stay-picture__kira--capsule'
            : 'va-stay-picture__kira'
        }
        style={placeStyle(kira)}
      >
        <span className="va-stay-picture__dot" />
      </span>
    </span>
  );
}

function WindowCards({ flow, name }: { flow: FirstRunFlow; name: string }) {
  return (
    <ChoiceCards
      label={copy.windowTitle(name)}
      values={windowModes}
      chosen={flow.windowMode}
      choose={(mode) => {
        flow.chooseWindow(mode);
      }}
      name={(mode) => flow.windowName(mode)}
      line={(mode) => flow.windowLine(mode)}
      picture={(mode) => <WindowPicture mode={mode} />}
      well="va-first-run__well--stay"
      place
    />
  );
}

function TalkKeyStep({
  flow,
  recording,
  onRecording,
}: {
  flow: FirstRunFlow;
  recording: boolean;
  onRecording: (recording: boolean) => void;
}) {
  const [refused, setRefused] = useState<{ shown: string; line: string } | null>(null);
  const change = useRef<HTMLButtonElement>(null);

  const stop = () => {
    setRefused(null);
    onRecording(false);
    change.current?.focus();
  };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(event.key)) return;
    // Tab leaves the row: the recording ends, the old key stays, and the focus moves on.
    if (event.key === 'Tab') {
      setRefused(null);
      onRecording(false);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    const result = recordTalkKey(
      { key: event.key, chord: event.ctrlKey || event.metaKey || event.altKey },
      flow.talkKey,
      isApple(),
    );
    if (result.kind === 'refuse') {
      setRefused({ shown: result.shown, line: result.line });
      return;
    }
    if (result.kind === 'take') flow.setTalkKey(result.key);
    stop();
  });
  useEffect(() => {
    if (!recording) return;
    const listener = (event: KeyboardEvent) => {
      onKey(event);
    };
    window.addEventListener('keydown', listener, true);
    return () => {
      window.removeEventListener('keydown', listener, true);
    };
  }, [recording]);

  const capClass = [
    'va-first-run__cap',
    recording && 'va-first-run__cap--recording',
    refused && 'va-first-run__cap--refused',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="va-first-run__key">
      <div className="va-first-run__key-hero">
        <span className={capClass} aria-hidden="true">
          {refused ? refused.shown : flow.talkKeyLabel}
        </span>
        <p
          className={
            refused
              ? 'va-first-run__cap-note va-first-run__cap-note--refused'
              : 'va-first-run__cap-note'
          }
          role={refused ? 'alert' : undefined}
        >
          {refused ? refused.line : copy.talkKeyWorks}
        </p>
      </div>
      <div className="va-first-run__card">
        <div className="va-first-run__key-row">
          <div className="va-first-run__row-words">
            <span className="va-first-run__row-name">{copy.talkKeyRow}</span>
            <span id="va-first-run-key-line" className="va-first-run__row-line">
              {recording ? copy.talkKeyRecording : copy.talkKeyRule(isApple())}
            </span>
          </div>
          {!recording && <span className="va-first-run__small-cap">{flow.talkKeyLabel}</span>}
          <Button
            ref={change}
            shape="capsule"
            aria-label={
              recording ? undefined : `${copy.change} ${copy.talkKeyRow}, ${flow.talkKeyLabel}`
            }
            aria-describedby={recording ? 'va-first-run-key-line' : undefined}
            onClick={() => {
              if (recording) stop();
              else onRecording(true);
            }}
          >
            {recording ? copy.cancel : copy.change}
          </Button>
        </div>
      </div>
    </div>
  );
}

const rowIcons: Record<Device, IconName> = { microphone: 'mic', camera: 'cam' };

/** What a row says now, as one sentence for a screen reader: name, purpose, status. */
function rowSentence(row: PermissionRow): string {
  const status = row.allowed ? copy.allowed : (row.stateWord ?? row.action ?? '');
  return `${row.name}: ${row.line} ${status}`.trim();
}

function PermissionRows({ flow, onRowGone }: { flow: FirstRunFlow; onRowGone: () => void }) {
  const focused = useRef<Device | null>(null);
  const rows = flow.rows;
  // A row's button that held the focus is gone once its answer came: the focus goes on.
  useLayoutEffect(() => {
    const device = focused.current;
    if (device === null) return;
    if (rows.some((row) => row.device === device && row.action !== null)) return;
    focused.current = null;
    onRowGone();
  });

  const said = `${flow.title}. ${rows.map(rowSentence).join(' ')}`;
  const [first] = useState(said);
  const spoken = useAnnouncement(said === first ? '' : said);
  return (
    <div className="va-first-run__permissions">
      <span className="convai-visually-hidden" role="status">
        {spoken}
      </span>
      <ul className="va-first-run__card">
        {rows.map((row) => (
          <li key={row.device} className="va-first-run__row">
            <span className="va-first-run__glyph" aria-hidden="true">
              <Icon name={rowIcons[row.device]} />
              {row.warn && <span className="va-first-run__warn" />}
            </span>
            <span className="va-first-run__row-words">
              <span className="va-first-run__row-name">{row.name}</span>
              <span className="va-first-run__row-line">{row.line}</span>
            </span>
            {row.allowed && (
              <span className="va-first-run__allowed">
                <Icon name="check" size={14} className="va-first-run__check" />
                {copy.allowed}
              </span>
            )}
            {row.action !== null && (
              <Button
                kind={row.primary ? 'primary' : 'secondary'}
                shape="capsule"
                loading={flow.askingDevice === row.device}
                aria-label={`${row.action}: ${row.name}`}
                onFocus={() => {
                  focused.current = row.device;
                }}
                onBlur={() => {
                  focused.current = null;
                }}
                onClick={() => {
                  flow.act(row.device);
                }}
              >
                {row.action}
              </Button>
            )}
            {row.stateWord !== null && <span className="va-first-run__state">{row.stateWord}</span>}
          </li>
        ))}
      </ul>
      <p className="va-first-run__note">{flow.note}</p>
    </div>
  );
}

function AllSetChips({ flow }: { flow: FirstRunFlow }) {
  const notes = [flow.note, ...flow.allSetNotes].filter((line) => line !== '');
  return (
    <div className="va-first-run__done">
      <ul className="va-first-run__chips">
        {flow.chips.map((chip) => {
          const body = (
            <span className="va-first-run__chip">
              {chip.on ? (
                <Icon name="check" size={12} className="va-first-run__check" />
              ) : (
                <span className="va-first-run__dot" aria-hidden="true" />
              )}
              {chip.label}
            </span>
          );
          return (
            <li key={chip.label}>
              {chip.tooltip ? (
                // The tooltip is for the pointer; the note under the chips says the same to all.
                <Tooltip text={chip.tooltip}>{body}</Tooltip>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
      {notes.map((line) => (
        <p key={line} className="va-first-run__note va-first-run__note--done">
          {line}
        </p>
      ))}
    </div>
  );
}
