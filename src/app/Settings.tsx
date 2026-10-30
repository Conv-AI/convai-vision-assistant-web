import {
  createContext,
  use,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Button } from '../kit/controls/Button';
import { IconButton } from '../kit/controls/IconButton';
import { Segmented } from '../kit/controls/Segmented';
import { Select } from '../kit/controls/Select';
import { Slider } from '../kit/controls/Slider';
import { Switch } from '../kit/controls/Switch';
import { Dialog } from '../kit/dialog/Dialog';
import { useModal } from '../kit/dialog/useModal';
import { EscapeContext, EscapeStack, useEscapeLayer } from '../kit/escape';
import { Icon } from '../kit/icons';
import { useAnnouncement } from '../kit/useAnnouncement';
import { settingsCopy as copy, shortcutCopy } from '../settings/copy';
import { microphoneOptions, noMicrophone, shownMicrophone } from '../settings/microphones';
import { countRows, findRows, isQuery, resultLabel } from '../settings/search';
import {
  howToUsePage,
  settingsSections,
  type Group,
  type Row,
  type Section,
  type SectionId,
  type SettingsContext,
} from '../settings/sections';
import { defaultKeys, keyCap, recordShortcut, type ChangeableId } from '../settings/shortcuts';
import { cameraLabel } from '../vision/camera';
import { useVisionState } from './hooks';
import { isApple } from './keys';
import { Portrait } from './Portrait';
import type { Runtime } from './runtime';

export const narrowBelow = 720;

/** How long a row that "Show in …" led to stays lit before it fades. */
export const highlightHoldMs = 600;
export const highlightFadeMs = 1000;

export const searchDebounceMs = 150;

/** How long a copy button says "Copied" before it reads as before. */
export const copiedMs = 2000;

type SettingsBase = Omit<
  SettingsContext,
  | 'askClear'
  | 'microphones'
  | 'microphone'
  | 'setMicrophone'
  | 'microphoneFailed'
  | 'microphonesNamed'
  | 'test'
  | 'startTest'
  | 'apple'
  | 'keys'
  | 'changeTalkKey'
  | 'askResetAll'
  | 'openSection'
  | 'openPage'
  | 'cameras'
  | 'camera'
  | 'setCamera'
  | 'camerasNamed'
  | 'version'
  | 'compactSupported'
  | 'copied'
  | 'copyVersion'
  | 'supportDetails'
  | 'copyDetails'
>;

interface SettingsProps {
  runtime: Runtime;
  base: SettingsBase;
  section: SectionId;
  onSection: (section: SectionId) => void;
  windowWidth: number;
  /** Settings' own Esc: true when one of its layers took it; false leaves the closing to the window. */
  escapeRef: RefObject<(() => boolean) | null>;
  /** A shortcut's row waits for a key (true) or stopped waiting: the window's keys wait meanwhile. */
  onRecording: (recording: boolean) => void;
  /** Called with true to start the microphone test in a way the conversation does not hear. */
  onTest: (deviceId: string | null) => void;
  onClose: () => void;
}

/** A pushed page as it shows: How to use, the licenses, or one license's text. */
type ShownPage = { id: 'howto' } | { id: 'licenses' } | { id: 'license'; name: string };

interface Recording {
  id: ChangeableId;

  refusal?: string;
  /** The key pressed is another shortcut's: the row asks whether to take it. */
  conflict?: { key: string; other: ChangeableId };
}

type LicenseList = (typeof import('virtual:licenses'))['default'];
type Licenses =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'failed' }
  | { phase: 'ready'; list: LicenseList };

/** The full names of the shortcuts that can be changed. */
const shortcutNames: Record<ChangeableId, string> = {
  talk: shortcutCopy.talk,
  type: shortcutCopy.type,
  mute: shortcutCopy.mute,
  transcript: shortcutCopy.transcript,
  quick: shortcutCopy.quick,
};

const noBreak = String.fromCharCode(160);

/** A key cap as a screen reader says it: "/" is Slash, "," Comma. */
const spokenCap = (cap: string) => shortcutCopy.spokenKeys[cap] ?? cap;

/** What a shortcut's row needs of Settings' recording. */
interface Recorder {
  recording: Recording | null;
  start: (id: ChangeableId) => void;
  cancel: () => void;
  /** "Use M for Talk": the key is moved over. */
  take: () => void;
  reset: (id: ChangeableId) => void;
}

const RecorderContext = createContext<Recorder | null>(null);

export function Settings({
  runtime,
  base,
  section,
  onSection,
  windowWidth,
  escapeRef,
  onRecording,
  onTest,
  onClose,
}: SettingsProps) {
  const id = useId();
  const box = useRef<HTMLDialogElement>(null);
  const nav = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(page);
  const [escapes] = useState(() => new EscapeStack());
  const narrow = windowWidth < narrowBelow;
  const apple = isApple();

  // The search: what is typed, and what was searched once typing paused.
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  // Esc cleared the words: the next Esc leaves the field.
  const cleared = useRef(false);
  // While results show, the sidebar's ring stays on the section that was open (kit round 7, 16).
  const [ring, setRing] = useState<SectionId>(section);
  const [lit, setLit] = useState<{ section: SectionId; row: string } | null>(null);
  const [asking, setAsking] = useState<'clear' | 'reset-all' | null>(null);
  const [microphoneFailed, setMicrophoneFailed] = useState(false);
  const [shownPage, setShownPage] = useState<ShownPage | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [copied, setCopied] = useState<{ row: string; ok: boolean } | null>(null);
  const [licenses, setLicenses] = useState<Licenses>({ phase: 'idle' });
  // What a screen reader hears of a change that moves no focus: a key saved, a copy.
  const [notice, setNotice] = useState('');
  // Where the focus goes once the change that asked for it has rendered: a selector in Settings.
  const [focusRequest, setFocusRequest] = useState<{ target: string } | null>(null);
  const focusOn = (target: string) => {
    setFocusRequest({ target });
  };

  useModal(box, onClose);

  const devices = useSyncExternalStore(
    (onChange) => runtime.devices.subscribe(onChange),
    () => runtime.devices.state,
  );
  const test = useSyncExternalStore(
    (onChange) => runtime.microphoneTest.subscribe(onChange),
    () => runtime.microphoneTest.state,
  );
  const keys = useSyncExternalStore(
    (onChange) => runtime.shortcuts.subscribe(onChange),
    () => runtime.shortcuts.keys,
  );
  const vision = useVisionState(runtime.vision);
  // Closed, a test under way stops: nothing records or plays behind the window.
  useEffect(
    () => () => {
      runtime.microphoneTest.cancel();
    },
    [runtime],
  );
  // Opened, the cameras are listed again; that never starts one.
  useEffect(() => {
    void runtime.vision.refreshCameras();
  }, [runtime]);

  const microphones =
    devices === null ? null : noMicrophone(devices) ? [] : microphoneOptions(devices);
  const microphone = shownMicrophone(base.settings.microphone, microphones ?? []);

  const setMicrophone = (value: string) => {
    const before = base.settings.microphone;
    const chosen = value === '' ? null : value;
    setMicrophoneFailed(false);
    base.set({ microphone: chosen });
    runtime.transport.setMicrophoneDevice(chosen).catch(() => {
      // The device could not be used: the select returns to what works, and says so.
      base.set({ microphone: before });
      setMicrophoneFailed(true);
    });
  };

  // The cameras: by name once the browser names them, else the one a share would open.
  const camerasNamed = vision.cameras.every((camera) => camera.id !== '');
  const cameras = camerasNamed
    ? vision.cameras.map((camera, index) => ({
        value: camera.id,
        label: cameraLabel(camera, index, vision.cameras.length),
      }))
    : [{ value: '', label: copy.defaultCamera }];
  const sharedCamera =
    vision.share !== 'none' && vision.source?.kind === 'camera' ? vision.source.deviceId : null;
  const camera =
    sharedCamera ??
    cameras.find((option) => option.value === base.settings.camera)?.value ??
    cameras[0]?.value ??
    '';
  const setCamera = (value: string) => {
    const chosen = value === '' ? null : value;
    base.set({ camera: chosen });
    // A camera shared now is switched; otherwise the next camera share opens it.
    if (sharedCamera !== null) runtime.vision.choose({ kind: 'camera', deviceId: chosen });
  };

  const copyText = (row: string, text: string) => {
    const done = (ok: boolean) => {
      setCopied({ row, ok });
      setNotice(ok ? copy.copied : copy.copyFailed);
    };

    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard) {
      done(false);
      return;
    }
    clipboard.writeText(text).then(
      () => {
        done(true);
      },
      () => {
        done(false);
      },
    );
  };
  // "Copied" reads as before after a moment; a failure stays until the next try.
  useEffect(() => {
    if (!copied?.ok) return;
    const back = setTimeout(() => {
      setCopied(null);
    }, copiedMs);
    return () => {
      clearTimeout(back);
    };
  }, [copied]);

  // Recording a shortcut's key ------------------------------------------------------------------

  const record = (next: Recording | null) => {
    setRecording(next);
    onRecording(next !== null);
  };
  const stopRecording = (focus = true) => {
    if (focus && recording) focusOn(`[data-row="shortcut-${recording.id}"] .va-settings__hit`);
    record(null);
  };
  const saidSaved = (target: ChangeableId) => {
    setNotice(shortcutCopy.saved(shortcutNames[target], keyCap(runtime.shortcuts.keys[target])));
  };
  const recorder: Recorder = {
    recording,
    start: (target) => {
      record({ id: target });
    },
    cancel: () => {
      stopRecording();
    },
    take: () => {
      const conflict = recording?.conflict;
      if (!recording || !conflict) return;
      runtime.shortcuts.move(recording.id, conflict.key);
      saidSaved(recording.id);
      stopRecording();
    },
    reset: (target) => {
      const result = runtime.shortcuts.reset(target);
      if (result.kind === 'conflict') {
        record({ id: target, conflict: { key: defaultKeys[target], other: result.other } });
        focusOn(`[data-row="shortcut-${target}"] .va-settings__take`);
        return;
      }
      saidSaved(target);
      focusOn(`[data-row="shortcut-${target}"] .va-settings__hit`);
    },
  };

  const listening = recording !== null && recording.conflict === undefined;
  const onRecordKey = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.key === 'Escape' || !recording) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    const result = recordShortcut(
      {
        key: event.key,
        code: event.code,
        shift: event.shiftKey,
        control: event.ctrlKey || event.metaKey,
        alt: event.altKey,
      },
      apple,
    );
    switch (result.kind) {
      case 'cancel':
      case 'wait':
        return;
      case 'refuse':
        record({ id: recording.id, refusal: result.line });
        // Said each time, the same refusal again too (a no-break space makes it new to the region).
        setNotice((said) => (said === result.line ? `${result.line}${noBreak}` : result.line));
        return;
      case 'key': {
        const bound = runtime.shortcuts.bind(recording.id, result.key);
        if (bound.kind === 'conflict') {
          record({ id: recording.id, conflict: { key: result.key, other: bound.other } });
          focusOn(`[data-row="shortcut-${recording.id}"] .va-settings__take`);
          return;
        }
        saidSaved(recording.id);
        stopRecording();
      }
    }
  });
  useEffect(() => {
    if (!listening) return;
    const dialog = box.current;
    const onKey = (event: globalThis.KeyboardEvent) => {
      onRecordKey(event);
    };
    // Space presses a button when it comes up: kept too, so it is refused, not a click.
    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key === ' ' || event.key === 'Enter') event.preventDefault();
    };
    dialog?.addEventListener('keydown', onKey, true);
    dialog?.addEventListener('keyup', onKeyUp, true);
    return () => {
      dialog?.removeEventListener('keydown', onKey, true);
      dialog?.removeEventListener('keyup', onKeyUp, true);
    };
  }, [listening]);
  // Esc ends the recording, or answers the question with Cancel, before anything else closes.
  const onRecordingEscape = useEffectEvent(() => {
    stopRecording();
  });
  const recordingOpen = recording !== null;
  useEffect(
    () =>
      recordingOpen
        ? escapes.push(() => {
            onRecordingEscape();
          })
        : undefined,
    [recordingOpen, escapes],
  );

  // Pushed pages --------------------------------------------------------------------------------

  const loadLicenses = () => {
    setLicenses({ phase: 'loading' });
    import('virtual:licenses').then(
      (module) => {
        setLicenses({ phase: 'ready', list: module.default });
      },
      () => {
        setLicenses({ phase: 'failed' });
      },
    );
  };
  const push = (next: ShownPage) => {
    if (next.id === 'licenses' && licenses.phase !== 'ready' && licenses.phase !== 'loading')
      loadLicenses();
    setShownPage(next);
    focusOn('.va-settings__back');
  };
  const back = () => {
    if (!shownPage) return;
    const from = shownPage;
    const to: ShownPage | null = from.id === 'license' ? { id: 'licenses' } : null;
    setShownPage(to);
    // Back, the focus returns to the row that opened the page.
    focusOn(
      from.id === 'license'
        ? `[data-row="license-${from.name}"] button`
        : `[data-row="${from.id}"] button`,
    );
  };
  const onPageEscape = useEffectEvent(() => {
    back();
  });
  const pageOpen = shownPage !== null;
  useEffect(
    () =>
      pageOpen
        ? escapes.push(() => {
            onPageEscape();
          })
        : undefined,
    [pageOpen, escapes],
  );

  // Typing searches after a pause, from the second character; fewer show the section again at once.
  const words = typed.trim();
  const type = (text: string) => {
    setTyped(text);
    if (!isQuery(text.trim())) setQuery('');
  };
  useEffect(() => {
    if (!isQuery(words)) return;
    const pause = setTimeout(() => {
      setQuery(words);
    }, searchDebounceMs);
    return () => {
      clearTimeout(pause);
    };
  }, [words]);
  const searching = query !== '';

  const endSearch = () => {
    type('');
  };

  const open = (next: SectionId) => {
    endSearch();
    setRing(next);
    onSection(next);
    setShownPage(null);
  };

  const supportDetails = [
    `${copy.appName} ${__APP_VERSION__}`,
    `Browser: ${navigator.userAgent}`,
    `Character: ${runtime.session.state.character?.id ?? 'none'}`,
  ].join(String.fromCharCode(10));

  const context: SettingsContext = {
    ...base,
    askClear: () => {
      setAsking('clear');
    },
    microphones,
    microphone,
    setMicrophone,
    microphoneFailed,
    microphonesNamed: devices?.some((device) => device.label !== '') ?? true,
    test,
    startTest: () => {
      onTest(base.settings.microphone);
    },
    apple,
    keys,
    changeTalkKey: () => {
      open('shortcuts');
      record({ id: 'talk' });
      focusOn('[data-row="shortcut-talk"] .va-settings__hit');
    },
    askResetAll: () => {
      setAsking('reset-all');
    },
    openSection: (target) => {
      open(target);
      focusOn(`[data-section="${target}"]`);
    },
    openPage: (target) => {
      // From a search's results the page opens over its section.
      if (searching || section !== 'about') open('about');
      push({ id: target });
    },
    cameras: vision.cameras.length === 0 ? [] : cameras,
    camera,
    setCamera,
    camerasNamed: vision.cameras.length === 0 || camerasNamed,
    version: __APP_VERSION__,
    compactSupported: runtime.compact.supported,
    copied,
    copyVersion: () => {
      copyText('version', copy.versionLine(__APP_VERSION__));
    },
    supportDetails,
    copyDetails: () => {
      copyText('support', supportDetails);
    },
  };
  const sections = settingsSections(context);
  const shown = sections.find((one) => one.id === section) ?? sections[0];

  const results = searching ? findRows(sections, query) : [];
  const found = countRows(results);
  const said = useAnnouncement(searching ? copy.resultsSaid(found, query) : notice);

  useLayoutEffect(() => {
    const current = box.current?.querySelector<HTMLElement>('[data-section][tabindex="0"]');
    (current ?? field.current)?.focus();
  }, []);

  // A focus asked for by a change: taken once that change has rendered.
  useLayoutEffect(() => {
    if (!focusRequest) return;
    box.current?.querySelector<HTMLElement>(focusRequest.target)?.focus();
  }, [focusRequest]);

  // Another section or page starts at its top.
  const pageKey =
    shownPage === null
      ? ''
      : shownPage.id === 'license'
        ? `license:${shownPage.name}`
        : shownPage.id;
  useLayoutEffect(() => {
    page.current?.scrollTo({ top: 0 });
  }, [section, pageKey]);

  // A row "Show in …" or a link led to: in view, focused, lit for a moment. Once, when it is led to:
  // a search that ends while it is still lit leaves the focus where the person put it.
  useLayoutEffect(() => {
    if (!lit) return;
    const row = page.current?.querySelector<HTMLElement>(`[data-row="${lit.row}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
    const control = row.querySelector<HTMLElement>(
      'button, [role="slider"], [role="radio"][tabindex="0"], input',
    );
    control?.focus();
  }, [lit]);
  useEffect(() => {
    if (!lit) return;
    const done = setTimeout(() => {
      setLit(null);
    }, highlightHoldMs + highlightFadeMs);
    return () => {
      clearTimeout(done);
    };
  }, [lit]);

  const showIn = (target: SectionId, row: string) => {
    open(target);
    setLit({ section: target, row });
  };

  // Esc, in order: an open menu, question, recording or page, the search's words, the field itself.
  const onEscape = useEffectEvent((): boolean => {
    if (escapes.closeTop()) return true;
    if (document.activeElement === field.current) {
      if (typed !== '') {
        endSearch();
        cleared.current = true;
        return true;
      }
      if (cleared.current) {
        cleared.current = false;
        (nav.current?.querySelector<HTMLElement>('[tabindex="0"]') ?? box.current)?.focus();
        return true;
      }
    }
    return false;
  });
  useLayoutEffect(() => {
    escapeRef.current = () => onEscape();
    return () => {
      escapeRef.current = null;
    };
  }, [escapeRef]);

  useEffect(() => {
    const dialog = box.current;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.code === 'KeyF') {
        event.preventDefault();
        field.current?.focus();
        field.current?.select();
      }
    };
    dialog?.addEventListener('keydown', onKey);
    return () => dialog?.removeEventListener('keydown', onKey);
  }, []);

  const onNavKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const ids = sections.map((one) => one.id);
    const at = ids.indexOf(ring);
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    let next: SectionId | undefined;
    if (step !== 0) next = ids[(at + step + ids.length) % ids.length];
    else if (event.key === 'Home') next = ids[0];
    else if (event.key === 'End') next = ids.at(-1);
    if (!next) return;
    event.preventDefault();
    setRing(next);
    // Arrows move the ring; while a section shows, the section follows it.
    if (!searching) {
      onSection(next);
      setShownPage(null);
    }
    nav.current?.querySelector<HTMLElement>(`[data-section="${next}"]`)?.focus();
  };

  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') cleared.current = false;

    if (event.key === 'ArrowDown') {
      const first = page.current?.querySelector<HTMLElement>(
        '.va-settings__rows button, .va-settings__rows [role="slider"], .va-settings__rows [tabindex="0"]',
      );
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const search = (
    <div className="va-settings__search" data-filled={typed !== '' || undefined}>
      <Icon name="search" size={14} className="va-settings__search-glyph" />
      <input
        ref={field}
        type="search"
        className="va-settings__search-field"
        placeholder={copy.search}
        aria-label={copy.search}
        value={typed}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          type(event.target.value);
        }}
        onFocus={() => {
          cleared.current = false;
        }}
        onKeyDown={onFieldKey}
      />
      {typed !== '' && (
        <button
          type="button"
          className="va-settings__search-clear"
          aria-label={copy.clearSearch}
          onClick={() => {
            endSearch();
            field.current?.focus();
          }}
        >
          {/* The kit's 8 cross at stroke 2.4 (Part - Settings), smaller than the shared icons go. */}
          <svg width="8" height="8" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
          </svg>
        </button>
      )}
    </div>
  );

  const navigation = narrow ? (
    <div className="va-settings__narrow-nav">
      {search}
      <Select
        label={copy.sections}
        options={sections.map((one) => ({ value: one.id, label: one.title }))}
        value={searching ? '' : (shown?.id ?? '')}
        placeholder={copy.resultsTitle(query)}
        onChange={(value) => {
          open(value as SectionId);
        }}
      />
    </div>
  ) : (
    <div className="va-settings__nav">
      {search}
      <div
        ref={nav}
        className="va-settings__sections"
        role="tablist"
        aria-label={copy.sections}
        aria-orientation="vertical"
      >
        {sections.map((one) => {
          const current = !searching && one.id === shown?.id;
          return (
            <SidebarItem key={one.id} section={one}>
              <button
                type="button"
                role="tab"
                data-section={one.id}
                className="va-settings__section"
                aria-selected={current}
                aria-controls={`${id}-page`}
                tabIndex={one.id === ring ? 0 : -1}
                onClick={() => {
                  open(one.id);
                }}
                onKeyDown={onNavKey}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={one.icon} />
                </svg>
                {one.title}
              </button>
            </SidebarItem>
          );
        })}
      </div>
    </div>
  );

  // The page that shows over About, when one was pushed and nothing is searched.
  const pushed = !searching && shown?.id === 'about' ? shownPage : null;
  const howTo = pushed?.id === 'howto' ? howToUsePage(context) : null;
  const pageTitle =
    pushed === null
      ? null
      : pushed.id === 'howto'
        ? copy.howToUse
        : pushed.id === 'licenses'
          ? copy.licenses
          : pushed.name;

  const title = searching
    ? found > 0
      ? copy.resultsTitle(query)
      : copy.searchTitle
    : (pageTitle ?? shown?.title ?? copy.title);

  let content: ReactNode;
  if (searching) {
    content =
      found > 0 ? (
        <>
          <p className="va-settings__intro">{copy.resultsLine(found)}</p>
          {results.map((result) => (
            <GroupView
              key={`${result.section.id}:${result.group.label}`}
              group={{
                label: resultLabel(result.section.title, result.group.label),
                rows: result.rows,
                action: {
                  label: copy.showIn(result.section.title),
                  run: () => {
                    showIn(result.section.id, result.rows[0]?.id ?? '');
                  },
                },
              }}
              lit={null}
            />
          ))}
        </>
      ) : (
        <div className="va-settings__empty">
          <p className="va-settings__empty-title">{copy.noResults(query)}</p>
          <p className="va-settings__empty-line">
            {narrow ? copy.noResultsNarrow : copy.noResultsLine}
          </p>
        </div>
      );
  } else if (howTo) {
    content = howTo.groups.map((group, index) => (
      <GroupView key={index} group={group} lit={null} />
    ));
  } else if (pushed?.id === 'licenses') {
    content = (
      <LicensesView
        licenses={licenses}
        onRetry={loadLicenses}
        onOpen={(name) => {
          push({ id: 'license', name });
        }}
      />
    );
  } else if (pushed?.id === 'license') {
    const found =
      licenses.phase === 'ready' ? licenses.list.find((one) => one.name === pushed.name) : null;
    content = found ? (
      <LicenseText
        license={found}
        copied={copied?.row === 'license' ? copied.ok : null}
        onCopy={() => {
          copyText('license', found.text ?? copy.noLicenseText(found.license));
        }}
      />
    ) : null;
  } else if (shown) {
    content = <SectionView section={shown} lit={lit?.section === shown.id ? lit.row : null} />;
  }

  const backLabel = copy.backTo(pushed?.id === 'license' ? copy.licenses : copy.about);

  return (
    <EscapeContext value={escapes}>
      <RecorderContext value={recorder}>
        <dialog
          ref={box}
          className="va-settings"
          data-narrow={narrow || undefined}
          aria-labelledby={`${id}-title`}
        >
          {navigation}
          <div className="va-settings__main">
            <div
              className="va-settings__header"
              data-back={pushed ? true : undefined}
              data-line={edges.top || undefined}
            >
              {pushed && (
                <IconButton
                  label={backLabel}
                  icon="back"
                  kind="tool"
                  className="va-settings__back"
                  onClick={back}
                />
              )}
              <h2 id={`${id}-title`} className="va-settings__title">
                {title}
              </h2>
              <IconButton label={copy.close} icon="close" onClick={onClose} />
            </div>
            <div
              ref={page}
              id={`${id}-page`}
              className="va-settings__page"
              role={narrow ? undefined : 'tabpanel'}
              aria-labelledby={`${id}-title`}
            >
              <div className="va-settings__content">{content}</div>
            </div>
            <span
              className="va-settings__fade va-settings__fade--top"
              data-on={edges.top || undefined}
              aria-hidden="true"
            />
            <span
              className="va-settings__fade va-settings__fade--bottom"
              data-on={edges.bottom || undefined}
              aria-hidden="true"
            />
          </div>
          <span className="convai-visually-hidden" role="status">
            {said}
          </span>
          {asking === 'clear' && (
            <ClearQuestion
              onKeep={() => {
                setAsking(null);
              }}
              onClear={() => {
                setAsking(null);
                runtime.session.clearConversation();
              }}
            />
          )}
          {asking === 'reset-all' && (
            <ResetAllQuestion
              onKeep={() => {
                setAsking(null);
              }}
              onReset={() => {
                setAsking(null);
                runtime.shortcuts.resetAll();
                setNotice(shortcutCopy.resetAllBody);
              }}
            />
          )}
          {/* Said once as it happens; the row keeps the line under its label. */}
          {microphoneFailed && (
            <span className="convai-visually-hidden" role="alert">
              {copy.microphoneFailed}
            </span>
          )}
        </dialog>
      </RecorderContext>
    </EscapeContext>
  );
}

/**
 * Whether the page has scrolled from its top and whether more lies below: the header's hairline
 * and the two fades (kit `.cv-set__head--line`, `.cv-set__fade`). Read on scroll and whenever the
 * page or its content changes size.
 */
function useScrollEdges(page: RefObject<HTMLDivElement | null>): { top: boolean; bottom: boolean } {
  const [edges, setEdges] = useState({ top: false, bottom: false });
  useEffect(() => {
    const element = page.current;
    if (!element) return;
    const read = () => {
      const top = element.scrollTop > 0;
      const bottom = element.scrollTop + element.clientHeight < element.scrollHeight - 1;
      setEdges((was) => (was.top === top && was.bottom === bottom ? was : { top, bottom }));
    };
    // A browser without ResizeObserver (jsdom) reads on scroll alone.
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    sizes?.observe(element);
    if (element.firstElementChild) sizes?.observe(element.firstElementChild);
    element.addEventListener('scroll', read, { passive: true });
    return () => {
      sizes?.disconnect();
      element.removeEventListener('scroll', read);
    };
  }, [page]);
  return edges;
}

/**
 * One section in the sidebar, with the label or the gap the Part draws above it. Those are drawing
 * only: hidden from screen readers, so the tab list holds tabs alone.
 */
function SidebarItem({ section, children }: { section: Section; children: ReactNode }) {
  return (
    <>
      {section.gapBefore && <span className="va-settings__nav-gap" aria-hidden="true" />}
      {section.labelBefore && (
        <span className="va-settings__nav-label" aria-hidden="true">
          {section.labelBefore}
        </span>
      )}
      {children}
    </>
  );
}

function SectionView({ section, lit }: { section: Section; lit: string | null }) {
  return (
    <>
      {section.intro && <p className="va-settings__intro">{section.intro}</p>}
      {section.card && (
        <div className="va-settings__group">
          <div className="va-settings__rows">
            <div className="va-settings__row va-settings__row--card">
              <span className="va-settings__portrait" aria-hidden="true">
                <Portrait src={section.card.portrait}>
                  {section.card.name.slice(0, 1).toUpperCase()}
                </Portrait>
              </span>
              <span className="va-settings__words">
                <span className="va-settings__label va-settings__label--strong">
                  {section.card.name}
                </span>
                <span className="va-settings__line">{section.card.line}</span>
              </span>
              <Button className="va-settings__change" onClick={section.card.change}>
                {copy.change}
              </Button>
            </div>
          </div>
        </div>
      )}
      {section.groups.map((group, index) => (
        <GroupView key={`${String(index)}:${group.label}`} group={group} lit={lit} />
      ))}
    </>
  );
}

interface GroupViewProps {
  group: Group;
  /** The id of the row "Show in …" led to, lit for a moment. */
  lit: string | null;
}

function GroupView({ group, lit }: GroupViewProps) {
  const { label, rows, action, note } = group;
  return (
    <div className="va-settings__group">
      {(label !== '' || action) && (
        <div className="va-settings__group-label">
          <span className="va-settings__group-name">{label}</span>
          {action && (
            <button type="button" className="va-settings__show-in" onClick={action.run}>
              {action.label}
            </button>
          )}
        </div>
      )}
      <div className="va-settings__rows">
        {rows.map((row) => (
          <RowView key={row.id} row={row} lit={row.id === lit} />
        ))}
      </div>
      {note && <p className="va-settings__note">{note}</p>}
    </div>
  );
}

/** Key caps as Settings draws them: 24 high, 12 / 600. */
function Caps({ keys }: { keys: readonly string[] }) {
  return keys.map((key) => (
    <kbd key={key} className="va-settings__key">
      {key}
    </kbd>
  ));
}

/** The chevron of a row that opens something . */
function Chevron() {
  return (
    <svg
      className="va-settings__chevron"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}

function RowView({ row, lit }: { row: Row; lit: boolean }) {
  const id = useId();
  const labelId = `${id}-label`;
  const lineId = `${id}-line`;
  const reason = row.kind === 'button' ? row.reason : undefined;
  const reasonId = `${id}-reason`;
  const described =
    [row.description ? lineId : '', reason ? reasonId : ''].filter(Boolean).join(' ') || undefined;

  if (row.kind === 'shortcut') return <ShortcutRow row={row} lit={lit} />;

  const words = (
    <span className="va-settings__words">
      <span
        id={labelId}
        className={
          row.strong ? 'va-settings__label va-settings__label--strong' : 'va-settings__label'
        }
      >
        {row.label}
      </span>
      {/* A space between the parts, so a name made of them reads as words. */}{' '}
      {row.description && (
        <span
          id={lineId}
          className={
            row.warning ? 'va-settings__line va-settings__line--warning' : 'va-settings__line'
          }
        >
          {row.description}
        </span>
      )}
      {reason && (
        <span id={reasonId} className="va-settings__line">
          {reason}
        </span>
      )}
      {row.problem && (
        <span className="va-settings__line va-settings__line--warning" role="alert">
          {row.problem}
        </span>
      )}
    </span>
  );

  if (row.kind === 'link') {
    // The whole row is the button: what it opens is its name.
    return (
      <div
        className="va-settings__row-box"
        data-row={row.id}
        data-lit={lit || undefined}
        data-kind="link"
      >
        <button
          type="button"
          className="va-settings__row va-settings__row--link"
          onClick={row.open}
        >
          {words}{' '}
          {row.keys && (
            <span className="va-settings__keys">
              <Caps keys={row.keys} />
            </span>
          )}
          {row.value && <span className="va-settings__value">{row.value}</span>}
          <Chevron />
        </button>
      </div>
    );
  }

  let lead: ReactNode = null;
  let control: ReactNode = null;
  let under: ReactNode = null;
  switch (row.kind) {
    case 'switch':
      control = (
        <Switch on={row.on} onChange={row.set} labelledBy={labelId} describedBy={described} />
      );
      break;
    case 'segmented':
      control = (
        <Segmented
          options={row.options}
          value={row.value}
          onChange={row.set}
          labelledBy={labelId}
          describedBy={described}
        />
      );
      break;
    case 'select':
      control = (
        <Select
          options={row.options}
          value={row.value}
          onChange={row.set}
          labelledBy={labelId}
          describedBy={described}
          disabled={row.options.length === 0}
        />
      );
      break;
    case 'slider':
      control = (
        <Slider
          value={row.value}
          min={row.min}
          max={row.max}
          step={row.step}
          onChange={row.set}
          format={row.format}
          labelledBy={labelId}
          describedBy={described}
          ends={
            row.growingEnds
              ? [
                  <span key="small" className="va-settings__end va-settings__end--small">
                    A
                  </span>,
                  <span key="large" className="va-settings__end va-settings__end--large">
                    A
                  </span>,
                ]
              : undefined
          }
        />
      );
      if (row.sample) {
        under = (
          <p className="va-settings__sample convai-text--caption" aria-hidden="true">
            {row.sample}
          </p>
        );
      }
      break;
    case 'button':
      control = (
        <Button
          kind={row.primary ? 'primary' : undefined}
          danger={row.danger}
          disabled={reason !== undefined}
          reasonId={reason ? reasonId : undefined}
          aria-describedby={reason ? undefined : described}
          aria-live={row.busy ? 'polite' : undefined}
          onClick={(event) => {
            event.stopPropagation();
            if (!row.busy) row.run();
          }}
        >
          {row.busy && <span className="va-settings__busy" aria-hidden="true" />}
          {row.action}
        </Button>
      );
      break;
    case 'keys':
      control = (
        <span className="va-settings__keys">
          {row.hold && <span className="va-settings__hold">{copy.hold}</span>}
          <Caps keys={row.keys} />
        </span>
      );
      break;
    case 'cards':
      under = <StyleCards row={row} labelledBy={labelId} />;
      break;
    case 'info':
      lead = (
        <span className="va-settings__tile" aria-hidden="true">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={row.icon} />
          </svg>
        </span>
      );
      break;
    case 'step':
      lead = (
        <span className="va-settings__number" aria-hidden="true">
          {row.number}
        </span>
      );
      control = row.keys.length > 0 && (
        <span className="va-settings__keys">
          <Caps keys={row.keys} />
        </span>
      );
      break;
    case 'note':
      control = row.value !== undefined && <span className="va-settings__value">{row.value}</span>;
      break;
  }

  return (
    <div
      className="va-settings__row-box"
      data-row={row.id}
      data-lit={lit || undefined}
      data-kind={row.kind}
    >
      <Line className="va-settings__row" presses={row.kind === 'switch'}>
        {lead}
        {words}
        {control}
      </Line>
      {under && <div className="va-settings__under">{under}</div>}
      {row.detail && (
        <div className="va-settings__under">
          <pre className="va-settings__license">{row.detail}</pre>
        </div>
      )}
    </div>
  );
}

function ShortcutRow({ row, lit }: { row: Extract<Row, { kind: 'shortcut' }>; lit: boolean }) {
  const recorder = use(RecorderContext);
  const id = useId();
  const nameId = `${id}-name`;
  const lineId = `${id}-line`;
  const underId = `${id}-under`;
  const changes = row.changes;
  const recording =
    changes !== null && recorder?.recording?.id === changes ? recorder.recording : null;
  const conflict = recording?.conflict;
  const listening = recording !== null && conflict === undefined;

  const description = listening ? shortcutCopy.recordingLine : row.description;
  const conflictLine =
    conflict &&
    shortcutCopy.conflict(
      keyCap(conflict.key),
      row.label,
      shortcutNames[conflict.other],
      shortcutCopy.short[conflict.other],
    );
  const underLine = conflictLine ?? recording?.refusal;
  const note = row.changed
    ? row.caps.length === 0
      ? shortcutCopy.notSetChanged
      : shortcutCopy.changed
    : row.caps.length === 0
      ? shortcutCopy.notSet
      : null;

  // Leaving the row while it waits (a click elsewhere, Tab is kept) ends the wait.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!recording) return;
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    recorder?.cancel();
  };

  const caps = listening ? (
    <span className="va-settings__recording">{shortcutCopy.recordingPrompt}</span>
  ) : conflict ? (
    <span className="va-settings__keys" data-conflict>
      <Caps keys={[keyCap(conflict.key)]} />
    </span>
  ) : (
    <span className="va-settings__keys">
      {note && <span className="va-settings__hold">{note}</span>}
      {row.hold && row.caps.length > 0 && (
        <span className="va-settings__hold">{shortcutCopy.hold}</span>
      )}
      <Caps keys={row.caps} />
    </span>
  );

  return (
    <div
      className="va-settings__row-box"
      data-row={row.id}
      data-lit={lit || undefined}
      data-kind="shortcut"
      data-recording={recording ? true : undefined}
      onBlur={onBlur}
    >
      <div className="va-settings__row">
        {changes !== null && recorder && (
          // The whole row is the button; its name is said apart from the words drawn.
          <button
            type="button"
            className="va-settings__hit"
            aria-labelledby={nameId}
            aria-describedby={
              [description ? lineId : '', underLine ? underId : ''].filter(Boolean).join(' ') ||
              undefined
            }
            aria-pressed={listening}
            onClick={() => {
              if (listening) recorder.cancel();
              else recorder.start(changes);
            }}
          />
        )}
        <span id={nameId} className="convai-visually-hidden">
          {changes !== null
            ? shortcutCopy.changeSpoken(row.label, row.caps.map(spokenCap).join(' '))
            : `${row.label}, ${row.caps.map(spokenCap).join(' plus ')}`}
        </span>
        <span className="va-settings__words" aria-hidden="true">
          <span className="va-settings__label">{row.label}</span>
          {description && (
            <span id={lineId} className="va-settings__line">
              {description}
            </span>
          )}
        </span>
        {/* A row that cannot be changed says its line too; one that can has it as its description. */}
        {changes === null && description && (
          <span className="convai-visually-hidden">{description}</span>
        )}
        <span className="va-settings__shortcut-keys" aria-hidden="true">
          {caps}
          {row.locked && <Icon name="lock" size={14} className="va-settings__lock" />}
        </span>
        {row.changed && !recording && changes !== null && recorder && (
          <Button
            className="va-settings__reset"
            aria-label={`${shortcutCopy.reset} ${row.label}`}
            onClick={() => {
              recorder.reset(changes);
            }}
          >
            {shortcutCopy.reset}
          </Button>
        )}
      </div>
      {underLine && (
        <div className="va-settings__under">
          <p id={underId} className="va-settings__line va-settings__line--strong">
            {underLine}
          </p>
          {conflict && recorder && (
            <div className="va-settings__answers" role="group" aria-describedby={underId}>
              <Button
                kind="primary"
                size="small"
                className="va-settings__take"
                aria-describedby={underId}
                onClick={recorder.take}
              >
                {shortcutCopy.useKey(keyCap(conflict.key), shortcutCopy.short[changes ?? 'talk'])}
              </Button>
              <Button size="small" onClick={recorder.cancel}>
                {shortcutCopy.cancel}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LicensesView({
  licenses,
  onRetry,
  onOpen,
}: {
  licenses: Licenses;
  onRetry: () => void;
  onOpen: (name: string) => void;
}) {
  if (licenses.phase === 'ready')
    return (
      <GroupView
        group={{
          label: '',
          rows: licenses.list.map((one) => ({
            id: `license-${one.name}`,
            kind: 'link',
            label: one.name,
            value: one.license,
            open: () => {
              onOpen(one.name);
            },
          })),
          note: copy.licensesNote,
        }}
        lit={null}
      />
    );
  if (licenses.phase === 'failed')
    return (
      <div className="va-settings__empty" role="alert">
        <p className="va-settings__empty-line">{copy.licensesFailed}</p>
        <Button onClick={onRetry}>{copy.tryAgain}</Button>
      </div>
    );
  return (
    <p className="va-settings__intro" role="status">
      {copy.licensesLoading}
    </p>
  );
}

function LicenseText({
  license,
  copied,
  onCopy,
}: {
  license: LicenseList[number];
  /** True once copied, false when the copy failed, null before. */
  copied: boolean | null;
  onCopy: () => void;
}) {
  return (
    <>
      <div className="va-settings__license-head">
        <p className="va-settings__intro">
          {license.version} · {license.license}
        </p>
        <Button onClick={onCopy}>{copied === true ? copy.copied : copy.copyLicense}</Button>
      </div>
      {copied === false && (
        <p className="va-settings__line va-settings__line--warning" role="alert">
          {copy.licenseCopyFailed}
        </p>
      )}
      <pre className="va-settings__license">
        {license.text ?? copy.noLicenseText(license.license)}
      </pre>
    </>
  );
}

/** A row's line: a label when a press anywhere on it is its switch's. */
function Line({
  className,
  presses,
  children,
}: {
  className: string;
  presses: boolean;
  children: ReactNode;
}) {
  return presses ? (
    // The switch inside is the label's control; it keeps its own name (aria-labelledby).

    <label className={className} data-presses>
      {children}
    </label>
  ) : (
    <div className={className}>{children}</div>
  );
}

function StyleCards({
  row,
  labelledBy,
}: {
  row: Extract<Row, { kind: 'cards' }>;
  labelledBy: string;
}) {
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.max(
    0,
    row.options.findIndex((option) => option.value === row.value),
  );
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (at + step + row.options.length) % row.options.length;
    const option = row.options[next];
    if (!option) return;
    row.set(option.value);
    cards.current[next]?.focus();
  };
  return (
    <div className="va-settings__cards" role="radiogroup" aria-labelledby={labelledBy}>
      {row.options.map((option, index) => (
        <button
          key={option.value}
          ref={(element) => {
            cards.current[index] = element;
          }}
          type="button"
          role="radio"
          aria-checked={index === at}
          tabIndex={index === at ? 0 : -1}
          className="va-settings__card"
          data-style={option.value}
          onClick={() => {
            row.set(option.value);
          }}
          onKeyDown={onKeyDown}
        >
          <span className="va-settings__card-picture" aria-hidden="true">
            <span className="va-settings__card-line" />
            <span className="va-settings__card-line" />
            <span className="va-settings__card-line" />
            <span className="va-settings__card-line" />
          </span>
          <span className="va-settings__card-words">
            <span className="va-settings__card-title">{option.label}</span>
            <span className="va-settings__card-text">{option.line}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function ClearQuestion({ onKeep, onClear }: { onKeep: () => void; onClear: () => void }) {
  useEscapeLayer(true, onKeep);
  return (
    <Dialog
      title={copy.clearAsk}
      body={[copy.clearAskLine]}
      confirm={copy.clearKeep}
      cancel={copy.clearKeep}
      danger={{ label: copy.clearButton, run: onClear }}
      onConfirm={onKeep}
      onCancel={onKeep}
    />
  );
}

/** Reset all shortcuts asks once, its safe answer the focused one (kit ShortcutsSection). */
function ResetAllQuestion({ onKeep, onReset }: { onKeep: () => void; onReset: () => void }) {
  useEscapeLayer(true, onKeep);
  return (
    <Dialog
      title={shortcutCopy.resetAllTitle}
      body={[shortcutCopy.resetAllBody]}
      confirm={shortcutCopy.resetAllKeep}
      cancel={shortcutCopy.resetAllKeep}
      danger={{ label: shortcutCopy.resetAllAction, run: onReset }}
      onConfirm={onKeep}
      onCancel={onKeep}
    />
  );
}

export type { SettingsBase };
