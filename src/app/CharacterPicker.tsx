import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { pickerCopy } from '../characters/copy';
import {
  columnsFor,
  dotWindow,
  dotsFor,
  galleryFor,
  gridsOf,
  initialOf,
  sectionsFrom,
  moveInGrid,
  stageOrder,
  type Card,
  type Gallery,
  type GridPlace,
} from '../characters/gallery';
import { spokenLanguages } from '../characters/languages';
import type { CharacterListState } from '../characters/list';
import type { Character } from '../credentials/characters';
import { CharacterArtwork } from './CharacterArtwork';
import { Button } from '../kit/controls/Button';
import { IconButton } from '../kit/controls/IconButton';
import { Tooltip } from '../kit/controls/Tooltip';
import { useModal } from '../kit/dialog/useModal';
import { Icon } from '../kit/icons';
import { Lens } from '../kit/lens/Lens';
import { Portrait } from './Portrait';

interface CharacterPickerProps {
  list: CharacterListState;
  currentId: string | null;
  /** The characters talked to on this device, newest first. */
  recent: readonly string[];
  /** The name a card shows when the server had none. */
  fallback: string;
  windowWidth: number;
  /** The device's language, listed first on a stage. */
  deviceLanguage: string;
  /**
   * Set by the picker to its own Esc: true when Esc went to one of its layers (the stage back to the
   * gallery, the search cleared); false when the picker itself is to close.
   */
  escapeRef: RefObject<(() => boolean) | null>;
  onTalk: (character: Character) => void;
  onRetry: () => void;
  onClose: () => void;
}

/** What takes the focus next: asked by a handler, given once the change has rendered. */
interface FocusAsk {
  to: 'card' | 'stage' | 'search';
  /** Counts the asks, so the same target asked again is a new ask. */
  n: number;
}

function cardKey(grid: number, card: Card): string {
  return `${String(grid)}:${card.character.id}`;
}

/** The place of the card for `id` in the gallery's grids, or null. */
function placeOf(gallery: Gallery, id: string | null): GridPlace | null {
  const grids = gridsOf(gallery);
  for (let grid = 0; grid < grids.length; grid++) {
    const index = grids[grid]?.findIndex((card) => card.character.id === id) ?? -1;
    if (index >= 0) return { grid, index };
  }
  return null;
}

export function CharacterPicker({
  list,
  currentId,
  recent,
  fallback,
  windowWidth,
  deviceLanguage,
  escapeRef,
  onTalk,
  onRetry,
  onClose,
}: CharacterPickerProps) {
  const titleId = useId();
  const gridId = useId();
  const box = useRef<HTMLDialogElement>(null);
  const cards = useRef(new Map<string, HTMLButtonElement>());
  const search = useRef<HTMLInputElement>(null);
  const talk = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState('');
  const [stageId, setStageId] = useState<string | null>(null);
  /** Where the arrows hold the focus; null until it moved, so it starts on the current card. */
  const [place, setPlace] = useState<GridPlace | null>(null);
  const [focusAsk, setFocusAsk] = useState<FocusAsk>({ to: 'card', n: 0 });
  const ask = (to: FocusAsk['to']) => {
    setFocusAsk((last) => ({ to, n: last.n + 1 }));
  };

  useModal(box, onClose);

  const characters = list.characters;
  const single = characters?.length === 1;
  const gallery = galleryFor(characters ?? [], currentId, recent, query, fallback);
  const grids = gridsOf(gallery);
  const columns = columnsFor(windowWidth);
  const order = stageOrder(gallery);
  const shownId = single ? (characters[0]?.id ?? null) : stageId;
  const shown = shownId === null ? null : (characters?.find((one) => one.id === shownId) ?? null);
  // The place the arrows hold, kept inside the grids as they change under a search.
  const wanted = place ?? placeOf(gallery, currentId) ?? { grid: 0, index: 0 };
  const held = grids[wanted.grid]?.[wanted.index] ? wanted : { grid: 0, index: 0 };

  const openStage = (character: Character) => {
    setStageId(character.id);
    ask('stage');
  };

  const backToGallery = () => {
    const at = placeOf(gallery, stageId);
    setStageId(null);
    if (at) setPlace(at);
    ask('card');
  };

  useEffect(() => {
    escapeRef.current = () => {
      if (shown && !single) {
        backToGallery();
        return true;
      }
      if (!shown && query !== '') {
        setQuery('');
        setPlace(null);
        ask('search');
        return true;
      }
      return false;
    };
    return () => {
      escapeRef.current = null;
    };
  });

  const giveFocus = useEffectEvent(() => {
    if (shown) {
      (talk.current ?? closeButton.current)?.focus();
      return;
    }
    if (list.failed) {
      retry.current?.focus();
      return;
    }
    if (focusAsk.to === 'search') {
      search.current?.focus();
      return;
    }
    const first = grids[held.grid]?.[held.index];
    if (first) cards.current.get(cardKey(held.grid, first))?.focus();
    else search.current?.focus();
  });
  const loaded = characters !== null;
  useLayoutEffect(() => {
    if (loaded) giveFocus();
  }, [focusAsk, loaded]);
  // In the gallery the cards and the failure take each other's place: the focus follows.
  const failedChanged = useEffectEvent(() => {
    if (!shown) giveFocus();
  });
  useLayoutEffect(() => {
    if (loaded) failedChanged();
  }, [loaded, list.failed]);

  const onStageKey = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (single || !shown || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    const index = order.findIndex((card) => card.character.id === shown.id);
    const next = order[index + (event.key === 'ArrowRight' ? 1 : -1)];
    if (index < 0 || !next) return;
    event.preventDefault();
    setStageId(next.character.id);
    // On the dot row the focus stays there (a slider); elsewhere it goes to the stage's action, or
    // Close where the current character's stage has none.
    if (!(event.target instanceof Element && event.target.closest('.va-character__dots')))
      ask('stage');
  });
  useEffect(() => {
    const dialog = box.current;
    const listener = (event: globalThis.KeyboardEvent) => {
      onStageKey(event);
    };
    dialog?.addEventListener('keydown', listener);
    return () => dialog?.removeEventListener('keydown', listener);
  }, []);

  const onCardKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const sizes = grids.map((grid) => grid.length);
    const next = moveInGrid(held, event.key, sizes, columns);
    if (next === held) return;
    event.preventDefault();
    setPlace(next);
    const card = grids[next.grid]?.[next.index];
    if (card) cards.current.get(cardKey(next.grid, card))?.focus();
  };

  const languageLine = (character: Character) =>
    spokenLanguages(character.languages, deviceLanguage)
      .map((language) => language.name)
      // A line never starts with a dot: it stays with the name before it.
      .join(`${String.fromCharCode(160)}· `);

  const cardItem = (one: Card, grid: number, index: number) => (
    <li key={one.character.id} className="va-picker__cell">
      {gallery.kind === 'sections' && grid === grids.length - 1 && (
        <span className="va-picker__caption">{one.caption}</span>
      )}
      {/* A name cut on its card shows whole in the tooltip (C11). */}
      <Tooltip text={one.name} wraps className="va-card__anchor">
        <button
          ref={(element) => {
            if (element) cards.current.set(cardKey(grid, one), element);
            else cards.current.delete(cardKey(grid, one));
          }}
          type="button"
          className="va-card"
          tabIndex={held.grid === grid && held.index === index ? 0 : -1}
          data-current={one.current || undefined}
          onKeyDown={onCardKey}
          onFocus={() => {
            if (held.grid !== grid || held.index !== index) setPlace({ grid, index });
          }}
          onClick={() => {
            openStage(one.character);
          }}
        >
          <span className="va-card__picture" aria-hidden="true">
            <CharacterArtwork character={one.character} initial={initialOf(one.name)} />
          </span>
          <span className="va-card__words">
            <span className="va-card__name">{one.name}</span>
            {one.character.languages.length > 0 && (
              <span className="va-card__line">{languageLine(one.character)}</span>
            )}
          </span>
          {one.current && (
            <span className="va-card__badge">
              <Lens name={one.name} state="ready" size={16} decorative />
              {pickerCopy.talkingNow}
            </span>
          )}
        </button>
      </Tooltip>
    </li>
  );

  // The arrow keys move the focus between the cards; Tab leaves the grid in one stop.
  const grid = (items: Card[], index: number) => (
    <ul id={index === 0 ? gridId : undefined} className="va-picker__grid">
      {items.map((one, i) => cardItem(one, index, i))}
    </ul>
  );

  const faces =
    gallery.kind === 'grid' && gallery.faces.length > 0 && !list.failed ? (
      <div className="va-picker__faces" role="group" aria-label={pickerCopy.recent}>
        <span className="va-picker__faces-label" aria-hidden="true">
          {pickerCopy.recent}
        </span>
        {gallery.faces.map((face) => (
          <Tooltip key={face.character.id} text={face.name}>
            <button
              type="button"
              className="va-face"
              aria-label={face.name}
              onClick={() => {
                openStage(face.character);
              }}
            >
              <span className="va-face__picture" aria-hidden="true">
                <Portrait src={face.character.portrait}>{initialOf(face.name)}</Portrait>
              </span>
            </button>
          </Tooltip>
        ))}
      </div>
    ) : null;

  let content;
  switch (gallery.kind) {
    case 'grid':
      content = grid(gallery.cards, 0);
      break;
    case 'results':
      content = (
        <>
          <p className="va-picker__count convai-visually-hidden" role="status">
            {gallery.cards.length > 0 ? pickerCopy.results(gallery.cards.length) : ''}
          </p>
          {gallery.cards.length > 0 ? (
            grid(gallery.cards, 0)
          ) : (
            <div className="va-picker__message" role="status">
              <p className="va-picker__message-title">{pickerCopy.noMatch(query.trim())}</p>
              <p className="va-picker__message-line">{pickerCopy.noMatchLine}</p>
            </div>
          )}
        </>
      );
      break;
    case 'sections':
      content = (
        <>
          {gallery.recent.length > 0 && (
            <section className="va-picker__section" aria-label={pickerCopy.recent}>
              <h3 className="va-picker__section-label" aria-hidden="true">
                {pickerCopy.recent}
              </h3>
              {grid(gallery.recent, 0)}
            </section>
          )}
          <section className="va-picker__section" aria-label={pickerCopy.all}>
            <h3 className="va-picker__section-label" aria-hidden="true">
              {pickerCopy.all}
            </h3>
            {grid(gallery.all, gallery.recent.length > 0 ? 1 : 0)}
          </section>
        </>
      );
      break;
  }

  const galleryView = (
    <>
      <header className="va-picker__head">
        <h2 id={titleId} className="va-picker__title">
          {pickerCopy.title}
        </h2>
        {characters !== null && (
          <div className="va-search" data-disabled={list.failed || undefined}>
            <Icon name="search" size={14} />
            <input
              ref={search}
              className="va-search__field"
              type="text"
              role="searchbox"
              aria-label={pickerCopy.searchName}
              aria-controls={gridId}
              placeholder={pickerCopy.search(characters.length)}
              autoComplete="off"
              spellCheck={false}

              disabled={list.failed}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPlace(null);
              }}
              onKeyDown={(event) => {
                // Down goes from the search into the cards.
                const first = grids[0]?.[0];
                if (event.key !== 'ArrowDown' || !first) return;
                event.preventDefault();
                setPlace({ grid: 0, index: 0 });
                cards.current.get(cardKey(0, first))?.focus();
              }}
            />
          </div>
        )}
        <IconButton
          className="va-picker__close"
          label={pickerCopy.close}
          icon="close"
          shape="round"
          onClick={onClose}
        />
      </header>
      {faces}
      <div className="va-picker__body">
        {list.failed ? (
          <div className="va-picker__message va-picker__message--row" role="alert">
            <div className="va-picker__message-words">
              <p className="va-picker__message-title">{pickerCopy.failed}</p>
              <p className="va-picker__message-line">{pickerCopy.failedLine}</p>
            </div>
            <Button ref={retry} shape="capsule" onClick={onRetry}>
              {pickerCopy.retry}
            </Button>
          </div>
        ) : (
          content
        )}
      </div>
    </>
  );

  const stageView = (character: Character) => {
    const name = character.name ?? fallback;
    const current = character.id === currentId;
    const languages = spokenLanguages(character.languages, deviceLanguage);
    const index = order.findIndex((one) => one.character.id === character.id);
    const dots =
      !single && index >= 0 && order.length > 1
        ? dotWindow(index, order.length, dotsFor(windowWidth))
        : null;
    // The dot row keeps the focus as it steps (a slider), wherever it was moved from.
    const show = (next: Character) => {
      setStageId(next.id);
    };
    return (
      <div className="va-character">
        <div className="va-character__portrait">
          <span className="va-character__picture" aria-hidden="true">
            <CharacterArtwork character={character} initial={initialOf(name)} preview />
          </span>
          {!single && (
            <IconButton
              className="va-character__back"
              label={pickerCopy.back}
              icon="back"
              shape="round"
              onClick={backToGallery}
            />
          )}
          {dots && (
            <div
              className="va-character__dots"
              role="slider"
              tabIndex={0}
              aria-label={pickerCopy.dots}
              aria-valuemin={1}
              aria-valuemax={order.length}
              aria-valuenow={index + 1}
              aria-valuetext={pickerCopy.dotsValue(name, index + 1, order.length)}
              onKeyDown={(event) => {
                const end =
                  event.key === 'Home' ? order[0] : event.key === 'End' ? order.at(-1) : null;
                if (!end) return;
                event.preventDefault();
                show(end.character);
              }}
            >
              {order.slice(dots.start, dots.end).map((one) => (
                <span
                  key={one.character.id}
                  className="va-character__dot"
                  data-shown={one.character.id === character.id || undefined}
                  onPointerDown={() => {
                    show(one.character);
                  }}
                />
              ))}
            </div>
          )}
        </div>
        <div className="va-character__details">
          <div className="va-character__close">
            <IconButton
              ref={closeButton}
              className="va-picker__close"
              label={pickerCopy.close}
              icon="close"
              shape="round"
              onClick={onClose}
            />
          </div>
          <h2 id={titleId} className="va-character__name">
            {name}
          </h2>
          {languages.length > 0 && (
            <div className="va-character__group">
              <span className="va-character__label" id={`${titleId}-speaks`}>
                {pickerCopy.speaks}
              </span>
              <ul className="va-character__languages" aria-labelledby={`${titleId}-speaks`}>
                {languages.map((language) => (
                  <li key={language.lang} lang="en" className="va-character__language">
                    {language.name}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!single && (
            <div className="va-character__action">
              {current ? (
                <p className="va-character__now">
                  <Lens name={name} state="ready" size={16} decorative />
                  {pickerCopy.talkingNow}
                </p>
              ) : (
                <Button
                  ref={talk}
                  kind="primary"
                  size="large"
                  shape="capsule"
                  className="va-character__talk"
                  onClick={() => {
                    onTalk(character);
                  }}
                >
                  {pickerCopy.talk(name)}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <dialog
      ref={box}
      className="va-picker"
      data-view={shown ? 'stage' : 'gallery'}

      data-many={(characters?.length ?? 0) >= sectionsFrom || undefined}
      data-failed={list.failed || undefined}
      aria-modal="true"
      aria-labelledby={titleId}
      style={{ ['--va-picker-columns' as string]: String(columns) }}
    >
      {shown ? stageView(shown) : galleryView}
    </dialog>
  );
}
