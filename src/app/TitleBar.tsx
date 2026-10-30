import { useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Tooltip } from '../kit/controls/Tooltip';
import { IconButton } from '../kit/controls/IconButton';
import { sourcePlace, type SourcePlace } from './bar';
import { Portrait } from './Portrait';
import { chipMaxWidth } from './sources';

interface TitleBarProps {
  /** Null until the character is known: the chip waits rather than show a stand-in. */
  name: string | null;
  /** The character's picture in the chip; null shows its first letter. */
  portrait: string | null;

  characterTooltip: string;
  /** The key that opens the picker, as the person reads it ("Ctrl K", "⌘ K"). */
  characterKey: string;
  /** The picker is open: the chip shows pressed. */
  pickerOpen: boolean;
  onCharacter: () => void;
  characterRef: Ref<HTMLButtonElement>;

  source: (room: number) => ReactNode;
  /** The window's width, for the chip's room before the bar is measured. */
  width: number;

  transcriptTool: boolean;
  /** The floating panel or the sheet is open: the tool shows pressed. */
  transcriptOpen: boolean;
  onTranscript: () => void;
  transcriptToolRef: Ref<HTMLButtonElement>;
  /** The Transcript key as its cap shows it ("R"); empty when it has none. */
  transcriptKey: string;
  /** The key that opens Settings as the person reads it ("Ctrl ,", "⌘ ,"). */
  settingsKey: string;

  modeSwitch: ReactNode;
  /** Settings is open: the gear shows pressed. */
  settingsOpen: boolean;
  onSettings: () => void;
  settingsRef: Ref<HTMLButtonElement>;
}

export function TitleBar({
  name,
  portrait,
  characterTooltip,
  characterKey,
  pickerOpen,
  onCharacter,
  characterRef,
  source,
  width,
  transcriptTool,
  transcriptOpen,
  onTranscript,
  transcriptToolRef,
  transcriptKey,
  settingsKey,
  modeSwitch,
  settingsOpen,
  onSettings,
  settingsRef,
}: TitleBarProps) {
  const bar = useRef<HTMLElement>(null);
  const middle = useRef<HTMLDivElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  // Null until measured: the chip then stands centred in the room the window gives it.
  const [place, setPlace] = useState<SourcePlace | null>(null);

  // The character chip never shrinks; the source chip takes the room beside it (VAWindow › Title
  // bar). Every part that can change size is watched: the bar, the name, the tools, the chip.
  useLayoutEffect(() => {
    const header = bar.current;
    const right = tools.current;
    const centre = middle.current;
    if (!header || !right || !centre) return;
    const measure = () => {
      const origin = header.getBoundingClientRect().left;
      const character = header.querySelector('.va-bar__character');
      const next = sourcePlace({
        width: header.clientWidth,
        characterEnd: character
          ? character.getBoundingClientRect().right - origin
          : parseFloat(getComputedStyle(header).paddingLeft),
        toolsStart: right.getBoundingClientRect().left - origin,
        chip: centre.getBoundingClientRect().width,
      });
      setPlace((last) =>
        last?.left === next.left && last.room === next.room && last.menuShift === next.menuShift
          ? last
          : next,
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    observer.observe(right);
    observer.observe(centre);
    const character = header.querySelector('.va-bar__character');
    if (character) observer.observe(character);
    return () => {
      observer.disconnect();
    };
  }, [name]);

  return (
    <header ref={bar} className="va-bar">
      {name !== null && (
        <Tooltip
          text={characterTooltip}
          shortcut={characterKey}
          className="va-bar__character-anchor"
        >
          <button
            ref={characterRef}
            type="button"
            className="va-bar__character"
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            aria-keyshortcuts="Control+K Meta+K"
            onClick={onCharacter}
          >
            <span className="va-avatar" aria-hidden="true">
              <Portrait src={portrait}>{name.slice(0, 1).toUpperCase()}</Portrait>
            </span>
            <span className="va-bar__name">{name}</span>
            <svg
              className="va-bar__chevron"
              width="12"
              height="12"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
            {/* The name is the chip's words; what a press opens is read after it. */}
            <span className="convai-visually-hidden">, {characterTooltip}</span>
          </button>
        </Tooltip>
      )}
      <div
        ref={middle}
        className="va-bar__source"
        data-placed={place ? '' : undefined}
        style={
          place
            ? {
                left: place.left,
                ['--va-source-menu-shift' as string]: `${String(place.menuShift)}px`,
              }
            : undefined
        }
      >
        {source(place?.room ?? chipMaxWidth(width))}
      </div>
      <div ref={tools} className="va-bar__tools">
        {transcriptTool && (
          <IconButton
            ref={transcriptToolRef}
            label="Transcript"
            data-tip-target="transcript"
            icon="transcript"
            kind="secondary"
            shape="round"
            shortcut={transcriptKey === '' ? undefined : transcriptKey}
            pressed={transcriptOpen}
            onClick={onTranscript}
          />
        )}
        {modeSwitch}

        <IconButton
          ref={settingsRef}
          label="Settings"
          icon="settings"
          kind="secondary"
          shape="round"
          shortcut={settingsKey}
          aria-keyshortcuts="Control+, Meta+,"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          onClick={onSettings}
        />
      </div>
    </header>
  );
}
