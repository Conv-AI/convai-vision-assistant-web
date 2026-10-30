import { useEffect, useLayoutEffect, useRef, type Ref, type RefObject } from 'react';
import { Tooltip } from '../kit/controls/Tooltip';
import { Icon } from '../kit/icons';
import { cameraLabel } from '../vision/camera';
import type { DisplayKind } from '../vision/media';
import type { Choice, VisionState } from '../vision/vision';
import { useHeldStill } from './hooks';
import { chipFit, chipSeparator, chipWords, sourceIcons } from './sources';
import { useMeasure, useTextScale } from './measure';

interface SourceChipProps {
  vision: VisionState;

  failureShows: boolean;
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  chipRef: Ref<HTMLButtonElement>;

  room: number;
}

function StartingMark() {
  return (
    <svg className="va-chip__loader" width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <circle className="va-chip__loader-ring" cx="4" cy="4" r="3.25" />
      <path className="va-chip__loader-arc" d="M7.25 4A3.25 3.25 0 0 0 4 .75" />
      <path className="va-chip__loader-still" d="M4 1.75A2.25 2.25 0 1 0 6.25 4" />
    </svg>
  );
}

export function SourceChip({
  vision,
  failureShows,
  menuOpen,
  onMenu,
  chipRef,
  room,
}: SourceChipProps) {
  const words = chipWords(vision, failureShows);

  const size = 13 * useTextScale();
  const fit = chipFit(
    words,
    room,
    useMeasure(`600 ${String(size)}px Inter`),
    useMeasure(`400 ${String(size)}px Inter`),
  );
  if (words.passive) {
    return (
      <span className="va-chip-anchor">
        <span className="va-chip va-chip--passive va-chip--quiet" role="status">
          <span className="va-chip__kind">{words.kind}</span>
        </span>
      </span>
    );
  }
  return (
    <Tooltip text={words.full} wraps className="va-chip-anchor">
      <button
        ref={chipRef}
        type="button"
        className={words.quiet ? 'va-chip va-chip--quiet' : 'va-chip'}
        data-open={menuOpen || undefined}
        aria-label={`${words.full}${words.state}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => {
          onMenu(!menuOpen);
        }}
      >
        {words.mark !== 'none' && (
          <span className="va-chip__slot" data-mark={words.mark}>
            {words.mark === 'starting' ? <StartingMark /> : <span className="va-chip__dot" />}
          </span>
        )}
        {fit.kind && words.icon && <Icon name={words.icon} />}
        <span className="va-chip__words">
          {fit.kind && <span className="va-chip__kind">{words.kind}</span>}
          {fit.name !== '' && (
            <span className="va-chip__name">
              {fit.kind ? `${chipSeparator}${fit.name}` : fit.name}
            </span>
          )}
        </span>
        <svg
          className="va-chip__chevron"
          width="12"
          height="12"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
    </Tooltip>
  );
}

/** A camera's live picture, mirrored for the person (the frame sent is never mirrored). */
export function CameraPicture({
  stream,
  className,
  still = false,
}: {
  stream: MediaStream;
  className: string;
  /** Holds the frame shown last (Pause vision). */
  still?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useHeldStill(video, still);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = stream;
    return () => {
      element.srcObject = null;
    };
  }, [stream]);
  return <video ref={video} className={className} autoPlay muted playsInline aria-hidden="true" />;
}

const displayRows: { kind: DisplayKind | 'region'; label: string }[] = [
  { kind: 'screen', label: 'Entire screen…' },
  { kind: 'tab', label: 'Browser tab…' },
  { kind: 'window', label: 'Window…' },
  { kind: 'region', label: 'Region…' },
];

/** The menu's rows the arrow keys move through. */
const rowSelector = '[role="menuitemradio"], [role="menuitem"]';

interface SourceMenuProps {
  /** The character's name: the menu is "What Kira sees". */
  name: string;
  vision: VisionState;
  /** The browser has a picker for a tab, a window or a screen: the menu offers them. */
  canShareDisplay: boolean;
  /** The chip that opened the menu: a press on it toggles the menu, so the blur toward it doesn't close it. */
  anchor: RefObject<HTMLElement | null>;
  onPick: (choice: Choice) => void;

  canChangeArea: boolean;
  onChangeArea: () => void;
  /** Image…: opens the browser's file chooser, which it shows only in the press itself. */
  onChooseImage: () => void;
  onClose: () => void;
}

export function SourceMenu({
  name,
  vision,
  canShareDisplay,
  anchor,
  onPick,
  canChangeArea,
  onChangeArea,
  onChooseImage,
  onClose,
}: SourceMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const { cameras, share, source } = vision;
  const inUse = share === 'none' || source?.kind !== 'camera' ? null : source.deviceId;

  const live = !vision.paused;
  // The kind the browser says is shared, whichever row asked for it.
  const sharedKind = share === 'none' ? null : (source?.kind ?? null);
  const nothing = share === 'none';
  const image = sharedKind === 'image';

  useLayoutEffect(() => {
    const rows = menu.current?.querySelectorAll<HTMLElement>(rowSelector);
    const checked = menu.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (checked ?? rows?.[0])?.focus();
  }, []);

  return (
    <div
      ref={menu}
      className="va-source-menu"
      role="menu"
      tabIndex={-1}
      aria-label={`What ${name} sees`}
      onBlur={(event) => {
        const to = event.relatedTarget;
        if (menu.current?.contains(to) || (to !== null && to === anchor.current)) return;
        onClose();
      }}
      onKeyDown={(event) => {
        const rows = [...(menu.current?.querySelectorAll<HTMLElement>(rowSelector) ?? [])];
        const at = rows.indexOf(document.activeElement as HTMLElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const next = (at + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
          rows[next]?.focus();
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          rows[event.key === 'Home' ? 0 : rows.length - 1]?.focus();
        }
      }}
    >
      {cameras.length > 0 && (
        <>
          <div role="group" aria-labelledby="va-source-menu-camera">
            <p id="va-source-menu-camera" className="va-source-menu__heading">
              Camera
            </p>
            {cameras.map((camera, i) => {
              const on = camera.id === inUse;
              return (
                <button
                  key={camera.id || `camera-${String(i)}`}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  className="va-source-menu__row va-source-menu__row--camera"
                  onClick={() => {
                    onPick({ kind: 'camera', deviceId: camera.id === '' ? null : camera.id });
                  }}
                >
                  <span className="va-source-menu__picture" aria-hidden="true">
                    {on && live && vision.stream ? (
                      <CameraPicture stream={vision.stream} className="va-source-menu__video" />
                    ) : (
                      <Icon name="source-camera" />
                    )}
                  </span>
                  <span className="va-source-menu__name">
                    {cameraLabel(camera, i, cameras.length)}
                  </span>
                  {on && <Icon name="check" className="va-source-menu__check" />}
                </button>
              );
            })}
          </div>
          <div className="va-source-menu__rule" role="separator" />
        </>
      )}
      {cameras.length === 0 && (
        // Without a camera the menu says so, rather than offer Nothing alone with no reason.
        <>
          <p className="va-source-menu__heading">Camera</p>
          <p className="va-source-menu__note">No camera found</p>
          <div className="va-source-menu__rule" role="separator" />
        </>
      )}
      {canShareDisplay && (
        <>
          <div role="group" aria-labelledby="va-source-menu-screen">
            <p id="va-source-menu-screen" className="va-source-menu__heading">
              Screen
            </p>
            {displayRows.map((row) => {
              const on = row.kind === sharedKind;

              const note = on && row.kind === 'region' ? (source?.name ?? '') : '';
              return (
                <button
                  key={row.kind}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  className="va-source-menu__row"
                  onClick={() => {
                    onPick(
                      row.kind === 'region'
                        ? { kind: 'region' }
                        : { kind: 'display', prefer: row.kind },
                    );
                  }}
                >
                  <span className="va-source-menu__glyph" aria-hidden="true">
                    <Icon name={sourceIcons[row.kind]} />
                  </span>
                  <span className="va-source-menu__name">{row.label}</span>
                  {note !== '' && <span className="va-source-menu__size">{note}</span>}
                  {on && <Icon name="check" className="va-source-menu__check" />}
                </button>
              );
            })}
            {canChangeArea && (
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="va-source-menu__row va-source-menu__row--indented"
                onClick={onChangeArea}
              >
                <span className="va-source-menu__name">Change area…</span>
              </button>
            )}
          </div>
          <div className="va-source-menu__rule" role="separator" />
        </>
      )}
      <button
        type="button"
        role="menuitemradio"
        aria-checked={image}
        tabIndex={image ? 0 : -1}
        className="va-source-menu__row"
        onClick={onChooseImage}
      >
        <span className="va-source-menu__glyph" aria-hidden="true">
          <Icon name={sourceIcons.image} />
        </span>
        <span className="va-source-menu__name">Image…</span>
        <span className="va-source-menu__aside">or drop a file</span>
        {image && <Icon name="check" className="va-source-menu__check" />}
      </button>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={nothing}
        tabIndex={nothing ? 0 : -1}
        className="va-source-menu__row"
        onClick={() => {
          onPick({ kind: 'nothing' });
        }}
      >
        <span className="va-source-menu__glyph" aria-hidden="true">
          <Icon name="view-off" />
        </span>
        <span className="va-source-menu__name">Nothing · voice only</span>
        {nothing && <Icon name="check" className="va-source-menu__check" />}
      </button>
    </div>
  );
}
