import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import type { WindowMode } from '../compact/compact';
import { Button } from '../kit/controls/Button';
import { IconButton } from '../kit/controls/IconButton';
import { KeyCap } from '../kit/controls/KeyCap';
import { Slider } from '../kit/controls/Slider';
import { Tooltip } from '../kit/controls/Tooltip';
import { Icon } from '../kit/icons';
import { maxTextScale, minTextScale } from '../kit/preferences';
import { quickCopy as copy } from '../quick/copy';
import {
  appLabelHeight,
  characterHeight,
  moveInTiles,
  settingsHeight,
  tileHeight,
  tileRows,
  type Arrow,
  type Step,
} from '../quick/layout';
import type { QuickTile, QuickTileId } from '../quick/tiles';
import { percent, settingsCopy } from '../settings/copy';
import { isElement } from './keys';
import { Portrait } from './Portrait';

interface QuickControlsProps {
  name: string;
  portrait: string | null;
  /** Under the name: the languages the character speaks (as Settings › Talking's card). */
  line: string;
  packageTiles: readonly QuickTile[];
  appTiles: readonly QuickTile[];

  step: Step;
  columns: number;
  width: number;
  textScale: number;

  overPicture: boolean;
  /** Settings' chord as All settings writes it ("Ctrl ,"). */
  settingsKeys: string;

  windowMode: WindowMode;
  compactExplains: boolean;
  /** What a press outside the panel leaves to its own owner: the capsule, whose More closes it. */
  anchor: RefObject<HTMLElement | null>;
  /** The panel's own Esc steps (the Window menu, then the options page): true when one took it. */
  escapeRef: RefObject<(() => boolean) | null>;
  onTile: (id: QuickTileId) => void;
  onWindow: (mode: WindowMode) => void;
  onTextSize: (value: number) => void;
  onChange: () => void;
  onSettings: () => void;
  /** A press outside: the panel closes and the press still reaches what it was on. */
  onClose: () => void;
}

const arrows: Readonly<Record<string, Arrow>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

const menuGap = 8;

export function QuickControls({
  name,
  portrait,
  line,
  packageTiles,
  appTiles,
  step,
  columns,
  width,
  textScale,
  overPicture,
  settingsKeys,
  windowMode,
  compactExplains,
  anchor,
  escapeRef,
  onTile,
  onWindow,
  onTextSize,
  onChange,
  onSettings,
  onClose,
}: QuickControlsProps) {
  const panel = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [options, setOptions] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const titleId = useId();
  const detailId = useId();
  const optionsTitleId = useId();

  const shownPackage = step >= 3 ? [] : step >= 1 ? packageTiles.slice(0, columns) : packageTiles;
  const shownApp = step >= 3 ? [] : appTiles;
  const tiles = [...shownPackage, ...shownApp];
  const rows = tileRows(shownPackage.length, shownApp.length, columns);

  const [lastTile, setLastTile] = useState<QuickTileId | null>(null);
  const tabStop = tiles.some((tile) => tile.id === lastTile) ? lastTile : tiles[0]?.id;

  // Where the focus goes once the change that asked for it has rendered (as SessionWindow does).
  const focusNext = useRef<'slider' | QuickTileId | null>(null);
  useLayoutEffect(() => {
    const target = focusNext.current;
    if (target === null) return;
    focusNext.current = null;
    const selector = target === 'slider' ? '[role="slider"]' : `[data-tile="${target}"]`;
    panel.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  // The panel's own Esc: the Window menu first, then the options page; else the window closes it.
  useEffect(() => {
    escapeRef.current = () => {
      if (menuOpen) {
        setMenuOpen(false);
        focusNext.current = 'window';
        return true;
      }
      if (options) {
        closeOptions();
        return true;
      }
      return false;
    };
    return () => {
      escapeRef.current = null;
    };
  });

  useLayoutEffect(() => {
    first()?.focus();
  }, []);

  // A row given up while it held the focus: the focus goes to the first tile, never to the page.
  const hadFocus = useRef(false);
  useLayoutEffect(() => {
    if (hadFocus.current && !panel.current?.contains(document.activeElement)) first()?.focus();
  }, [step, columns]);

  // A press outside closes the panel and still reaches what it was on; the capsule's own presses
  // are the capsule's (More closes the panel itself). Inside, a press beside the menu closes it.
  const onPress = useEffectEvent((event: PointerEvent) => {
    const target = event.target as Node | null;
    // A press on the Window tile is the tile's own: it closes the menu itself.
    if (menuOpen && !menu.current?.contains(target)) {
      if (!(isElement(target) && target.closest('[data-tile="window"]'))) setMenuOpen(false);
    }
    if (panel.current?.contains(target) || anchor.current?.contains(target)) return;
    onClose();
  });
  useEffect(() => {
    const press = (event: PointerEvent) => {
      onPress(event);
    };
    document.addEventListener('pointerdown', press, true);
    return () => {
      document.removeEventListener('pointerdown', press, true);
    };
  }, []);

  useLayoutEffect(() => {
    const element = menu.current;
    const tile = panel.current?.querySelector<HTMLElement>('[data-tile="window"]');
    const surface = panel.current;
    if (!menuOpen || !element || !tile || !surface) return;
    const box = surface.getBoundingClientRect();
    const own = tile.getBoundingClientRect();
    // Offsets count from inside the panel's 1 px edge.
    const edge = surface.clientLeft;
    element.style.right = `${String(box.right - edge - own.right)}px`;
    element.style.bottom = `${String(box.bottom - edge - own.top + menuGap)}px`;
    element.style.visibility = 'visible';
    (
      element.querySelector<HTMLElement>('[aria-checked="true"]') ??
      element.querySelector<HTMLElement>('[role^="menuitem"]')
    )?.focus();
  }, [menuOpen, textScale, compactExplains]);

  function first(): HTMLElement | null | undefined {
    return panel.current?.querySelector<HTMLElement>('[data-tile], .va-quick__settings');
  }

  function openOptions() {
    setMenuOpen(false);
    setOptions(true);
    focusNext.current = 'slider';
  }

  function closeOptions() {
    setOptions(false);
    focusNext.current = 'text-size';
  }

  const press = (tile: QuickTile) => {
    if (tile.reason !== undefined) return;
    if (tile.options) openOptions();
    else if (tile.menu) setMenuOpen((open) => !open);
    else onTile(tile.id);
  };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const arrow = arrows[event.key];
    if (!arrow) return;
    if (options) {
      if (arrow === 'left' && !(isElement(event.target) && event.target.closest('[role="slider"]')))
        closeOptions();
      return;
    }
    if (menuOpen) return;
    const buttons = [...(panel.current?.querySelectorAll<HTMLElement>('[data-tile]') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();

    if (arrow === 'right' && tiles[at]?.options && tiles[at].reason === undefined) {
      openOptions();
      return;
    }
    buttons[moveInTiles(rows, at, arrow)]?.focus();
  });
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const key = (event: KeyboardEvent) => {
      onKey(event);
    };
    element.addEventListener('keydown', key);
    return () => {
      element.removeEventListener('keydown', key);
    };
  }, []);

  // Every height comes from the layout the steps were decided by (src/quick/layout.ts).
  const sizes = {
    '--va-quick-width': `${String(width)}px`,
    '--va-quick-tile': `${String(tileHeight(textScale))}px`,
    '--va-quick-character': `${String(characterHeight(textScale))}px`,
    '--va-quick-label': `${String(appLabelHeight(textScale))}px`,
    '--va-quick-settings': `${String(settingsHeight(textScale))}px`,
    '--va-quick-columns': String(columns),
  } as CSSProperties;

  const tileButton = (tile: QuickTile) => {
    const dimmed = tile.reason !== undefined;
    const on = tile.on === true && !dimmed;
    const button = (
      <button
        key={tile.id}
        type="button"
        className="va-quick__tile"
        data-tile={tile.id}
        data-on={on || undefined}
        tabIndex={tile.id === tabStop ? 0 : -1}
        onFocus={() => {
          setLastTile(tile.id);
        }}
        aria-pressed={tile.on === null ? undefined : on}
        aria-disabled={dimmed || undefined}
        aria-haspopup={tile.menu ? 'menu' : undefined}
        aria-expanded={tile.menu ? menuOpen : undefined}
        aria-keyshortcuts={tile.keyCap}
        aria-describedby={tile.detail === undefined ? undefined : `${detailId}-${tile.id}`}
        onClick={() => {
          press(tile);
        }}
        onContextMenu={(event) => {
          event.preventDefault();

          if (tile.options && !dimmed) openOptions();
        }}
      >
        <span className="va-quick__tile-top">
          <Icon name={tile.icon} size={20} />
          {(tile.options === true || tile.menu === true) && (
            <span
              className={
                tile.menu ? 'va-quick__chevron va-quick__chevron--menu' : 'va-quick__chevron'
              }
              aria-hidden="true"
            >
              <Icon name={tile.menu ? 'chevron-down' : 'chevron'} size={12} />
            </span>
          )}
        </span>
        <span className="va-quick__words">
          <span className="va-quick__label">{tile.label}</span>{' '}
          {/* A toggle's On or Off is its pressed state; a reason or a value is heard with the name. */}
          {tile.keyCap === undefined ? (
            <span
              className="va-quick__value"
              aria-hidden={tile.on !== null && !dimmed ? true : undefined}
            >
              {tile.value}
            </span>
          ) : (
            // A key is a cap, not words; the tile names it with aria-keyshortcuts.
            <span className="va-quick__value va-quick__value--key">
              <KeyCap inButton>{tile.keyCap}</KeyCap>
            </span>
          )}
        </span>
      </button>
    );

    return tile.reason === undefined ? (
      button
    ) : (
      <Tooltip
        key={tile.id}
        text={tile.detail ?? tile.reason}
        wraps={tile.detail === undefined}
        className="va-quick__tile-anchor"
      >
        {button}
        {/* Beside the button, not in it: its description, never part of its name. */}
        {tile.detail !== undefined && (
          <span id={`${detailId}-${tile.id}`} className="convai-visually-hidden">
            {tile.detail}
          </span>
        )}
      </Tooltip>
    );
  };

  const grid = (list: readonly QuickTile[], label?: string) => {
    const lines: QuickTile[][] = [];
    for (let i = 0; i < list.length; i += columns) lines.push(list.slice(i, i + columns));
    return (
      <div className="va-quick__tiles" {...(label ? { role: 'group', 'aria-label': label } : {})}>
        {lines.map((row, i) => (
          <div key={i} className="va-quick__row">
            {row.map(tileButton)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div
      ref={panel}
      className={overPicture ? 'va-quick va-quick--over-picture' : 'va-quick'}
      role="dialog"
      aria-labelledby={titleId}
      data-step={step}
      style={sizes}
      onFocus={() => {
        hadFocus.current = true;
      }}
      onBlur={(event) => {
        const to = event.relatedTarget;
        if (panel.current?.contains(to)) return;
        hadFocus.current = false;
        // Tab past its last control (or Shift Tab past its first) closes it: left open, it would
        // stand over what has the focus now (WCAG 2.4.11). The capsule's controls keep it, as their
        // presses do; a focus lost to nothing (the window left) keeps it too.
        if (to !== null && !anchor.current?.contains(to)) onClose();
      }}
    >
      <h2 id={titleId} className="convai-visually-hidden">
        {copy.title}
      </h2>
      {options ? (
        <div className="va-quick__page">
          <div className="va-quick__options-header">
            <IconButton label={copy.back} icon="back" kind="secondary" onClick={closeOptions} />
            <h3 id={optionsTitleId} className="va-quick__options-title">
              {copy.textSize}
            </h3>
          </div>
          <div className="va-quick__options-card">
            {/* The line at the size being chosen, as Settings shows it; the slider says the value. */}
            <p className="va-quick__sample" aria-hidden="true">
              {settingsCopy.textSample}
            </p>
            <Slider
              value={textScale}
              min={minTextScale}
              max={maxTextScale}
              step={0.05}
              onChange={onTextSize}
              format={percent}
              labelledBy={optionsTitleId}
              ends={[
                <span key="small" className="va-quick__end va-quick__end--small">
                  A
                </span>,
                <span key="large" className="va-quick__end va-quick__end--large">
                  A
                </span>,
              ]}
            />
          </div>
        </div>
      ) : (
        <div className="va-quick__page">
          {step < 2 && (
            <div className="va-quick__character">
              <span className="va-avatar va-avatar--40" aria-hidden="true">
                <Portrait src={portrait}>{name.slice(0, 1).toUpperCase()}</Portrait>
              </span>
              <span className="va-quick__who">
                <span className="va-quick__name">{name}</span>
                {line !== '' && <span className="va-quick__line">{line}</span>}
              </span>
              <Button kind="secondary" size="standard" onClick={onChange}>
                {copy.change}
              </Button>
            </div>
          )}
          <div className="va-quick__grid">
            {shownPackage.length > 0 && grid(shownPackage)}
            {shownApp.length > 0 && (
              <>
                <p className="va-quick__app-label" aria-hidden="true">
                  {copy.fromApp}
                </p>
                {grid(shownApp, copy.fromApp)}
              </>
            )}
          </div>
          {step < 3 && <div className="va-quick__rule" role="separator" />}
          <button
            type="button"
            className="va-quick__settings"
            // Ctrl and ⌘ both open Settings on every system, as the title bar's gear names them.
            aria-keyshortcuts="Control+, Meta+,"
            onClick={onSettings}
          >
            <Icon name="settings" />
            <span className="va-quick__settings-label">{copy.allSettings}</span>
            <span className="va-quick__settings-keys" aria-hidden="true">
              {settingsKeys}
            </span>
          </button>
          {menuOpen && (
            <div
              ref={menu}
              className="va-quick__menu"
              role="menu"
              tabIndex={-1}
              aria-label={copy.window}
              onKeyDown={(event) => {
                const items = [
                  ...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []),
                ];
                const at = items.indexOf(document.activeElement as HTMLElement);
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  event.stopPropagation();
                  const next =
                    (at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
                  items[next]?.focus();
                }
              }}
            >
              {(
                [
                  ['full', copy.full],
                  ['compact', compactExplains ? copy.compactWithCard : copy.compact],
                ] as const
              ).map(([mode, words]) => {
                // Compact only explains here: it opens the card and is never the mode in force.
                const checked = mode === windowMode && !(mode === 'compact' && compactExplains);
                return (
                  <button
                    key={mode}
                    type="button"
                    role={compactExplains && mode === 'compact' ? 'menuitem' : 'menuitemradio'}
                    aria-checked={compactExplains && mode === 'compact' ? undefined : checked}
                    tabIndex={checked ? 0 : -1}
                    className="va-quick__menu-row"
                    onClick={() => {
                      setMenuOpen(false);
                      onWindow(mode);
                    }}
                  >
                    <span className="va-quick__menu-check" aria-hidden="true">
                      {checked && <Icon name="check" />}
                    </span>
                    <span className="va-quick__menu-words">{words}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
