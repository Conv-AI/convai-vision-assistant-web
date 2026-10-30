import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../kit/controls/Button';
import { IconButton } from '../kit/controls/IconButton';
import { Icon } from '../kit/icons';
import { LensLoader } from '../kit/lens/Lens';
import type { TranscriptItem, Turn } from '../session/turns';
import { turnMeta } from './copy';
import type { TranscriptPlace, TranscriptStyle } from './layout';
import { Portrait } from './Portrait';

/** The styles a person can pick in the panel; Continuum is chosen in Settings, which draws no panel. */
const pickable: { value: TranscriptStyle; label: string }[] = [
  { value: 'moments', label: 'Moments' },
  { value: 'conversation', label: 'Conversation' },
];

interface TranscriptProps {
  name: string;
  /** The character's picture beside its bubbles; null shows its first letter. */
  portrait: string | null;
  items: readonly TranscriptItem[];
  place: Exclude<TranscriptPlace, 'closed'>;
  style: TranscriptStyle;
  width: number;
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  onStyle: (style: TranscriptStyle) => void;
  onClose: () => void;
  onRetry: (id: number) => void;
  /** The Transcript key as its cap shows it ("R"); empty when it has none. */
  transcriptKey: string;
}

export function Transcript({
  name,
  portrait,
  items,
  place,
  style,
  width,
  menuOpen,
  onMenu,
  onStyle,
  onClose,
  onRetry,
  transcriptKey,
}: TranscriptProps) {
  const titleId = useId();
  const list = useRef<HTMLDivElement>(null);
  const last = items.at(-1);
  const lastText = last?.kind === 'turn' ? last.reply : '';
  const lastReplyId = last?.kind === 'turn' ? last.replyId : null;
  // Where the person is: at the end, or scrolled up with the newest reply they had then.
  const [away, setAway] = useState<{ seen: string | null } | null>(null);
  const behind = away !== null && lastReplyId !== null && lastReplyId !== away.seen;

  // Follow the end while the person is there; leave the list alone when they have scrolled up.
  useLayoutEffect(() => {
    const element = list.current;
    if (element && away === null) element.scrollTop = element.scrollHeight;
  }, [items.length, lastText, away]);

  const toEnd = () => {
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
    setAway(null);
  };

  const styleLabel = style === 'conversation' ? 'Conversation' : 'Moments';

  return (
    <section
      className={`va-transcript va-transcript--${place}`}
      style={{ width: place === 'sheet' ? undefined : width }}
      aria-labelledby={titleId}
    >
      <div className="va-transcript__header">
        <h2 id={titleId} className="va-transcript__title">
          Transcript
        </h2>
        <div className="va-menu-anchor">
          <button
            type="button"
            className="va-transcript__style"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => {
              onMenu(!menuOpen);
            }}
          >
            <span className="convai-visually-hidden">Transcript style: </span>
            {styleLabel}
            <Icon name="chevron" size={12} className="va-transcript__chevron" />
          </button>
          {menuOpen && (
            <StyleMenu
              value={style}
              onPick={(value) => {
                onStyle(value);
                onMenu(false);
              }}
              onClose={() => {
                onMenu(false);
              }}
            />
          )}
        </div>
        {place === 'pinned' ? (
          <IconButton
            label="Hide transcript"
            icon="panel"
            kind="tool"
            shape="round"
            shortcut={transcriptKey === '' ? undefined : transcriptKey}
            onClick={onClose}
          />
        ) : (
          <IconButton
            label="Close"
            icon="close"
            kind="tool"
            shape="round"
            shortcut="Esc"
            onClick={onClose}
          />
        )}
      </div>
      {items.length === 0 ? (
        <div className="va-transcript__empty">
          <p className="va-transcript__empty-title">No conversation yet</p>
        </div>
      ) : (
        <div
          ref={list}
          className={`va-transcript__list va-transcript__list--${style}`}
          tabIndex={-1}
          onScroll={(event) => {
            const element = event.currentTarget;
            const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
            if (atEnd) setAway(null);
            else if (away === null) setAway({ seen: lastReplyId });
          }}
        >
          {items.map((item) =>
            item.kind === 'divider' ? (
              <div key={item.id} className="va-transcript__divider" role="separator">
                <span>{item.label}</span>
              </div>
            ) : style === 'conversation' ? (
              <Bubbles
                key={item.id}
                turn={item}
                name={name}
                portrait={portrait}
                onRetry={onRetry}
              />
            ) : (
              <Moment key={item.id} turn={item} name={name} onRetry={onRetry} />
            ),
          )}
        </div>
      )}
      {behind && (
        <button type="button" className="va-transcript__new" onClick={toEnd}>
          <Icon name="arrow-down" size={14} />
          New reply
        </button>
      )}
    </section>
  );
}

function Reply({
  turn,
  name,
  stoppedLine = true,
}: {
  turn: Turn;
  name: string;
  /** False where the turn draws "Stopped" itself, under the whole moment. */
  stoppedLine?: boolean;
}) {
  if (turn.status === 'waiting' && turn.reply === '') {
    return (
      <div className="va-turn__waiting">
        <LensLoader />
        <span className="convai-visually-hidden">{name} is answering</span>
      </div>
    );
  }
  return (
    <>
      {turn.reply !== '' && (
        <p className="va-turn__reply">
          {turn.status === 'stopped' ? `${turn.reply.trimEnd()}…` : turn.reply}
          {turn.status === 'streaming' && <span className="va-turn__caret" aria-hidden="true" />}
        </p>
      )}
      {stoppedLine && turn.status === 'stopped' && <p className="va-turn__stopped">Stopped</p>}
    </>
  );
}

/** Failed turns already said: a turn's failure is said when it happens, not each time it is drawn. */
const said = new WeakSet<Turn>();

/**
 * True while this failure is new: its row is an alert. Drawn again later (the panel reopened, another
 * style picked) it is not said again; asked again and failing again, it is a new turn and said.
 */
function useNewFailure(turn: Turn): boolean {
  const [fresh] = useState(() => !said.has(turn));
  useEffect(() => {
    said.add(turn);
  }, [turn]);
  return fresh;
}

function Failed({
  turn,
  name,
  onRetry,
}: {
  turn: Turn;
  name: string;
  onRetry: (id: number) => void;
}) {
  const fresh = useNewFailure(turn);
  return (
    <div className="va-moment__failed" role={fresh ? 'alert' : undefined}>
      <span className="va-dot va-dot--danger" aria-hidden="true" />
      <span className="va-turn__failed-line">{name} couldn’t answer this one.</span>
      <Button
        shape="capsule"
        onClick={() => {
          onRetry(turn.id);
        }}
      >
        Try again
      </Button>
    </div>
  );
}

function Moment({
  turn,
  name,
  onRetry,
}: {
  turn: Turn;
  name: string;
  onRetry: (id: number) => void;
}) {
  const pictured = turn.question !== '' && turn.seen !== undefined;
  return (
    <article className="va-moment">
      <div className="va-moment__row">
        {pictured && (
          <span className="va-moment__picture" aria-hidden="true">
            {turn.picture !== undefined && <img src={turn.picture} alt="" />}
          </span>
        )}
        <div className="va-moment__body">
          {turn.question !== '' && (
            <div className="va-moment__question">
              <p className="va-moment__meta">{turnMeta(turn)}</p>
              <p className="va-moment__text">
                <span className="convai-visually-hidden">You: </span>
                {turn.question}
              </p>
            </div>
          )}
          {turn.status !== 'failed' && (
            <div className="va-moment__reply">
              <span className="convai-visually-hidden">{name}: </span>
              <Reply turn={turn} name={name} stoppedLine={false} />
            </div>
          )}
        </div>
      </div>

      {turn.status === 'stopped' && <p className="va-moment__stopped">Stopped</p>}
      {turn.status === 'failed' && <Failed turn={turn} name={name} onRetry={onRetry} />}
    </article>
  );
}

function Bubbles({
  turn,
  name,
  portrait,
  onRetry,
}: {
  turn: Turn;
  name: string;
  portrait: string | null;
  onRetry: (id: number) => void;
}) {
  return (
    <article className="va-bubbles">
      {turn.question !== '' && (
        <p className="va-bubble va-bubble--you">
          <span className="convai-visually-hidden">You: </span>
          {turn.question}
        </p>
      )}
      {turn.status === 'failed' ? (
        <FailedBubble turn={turn} name={name} portrait={portrait} onRetry={onRetry} />
      ) : (
        <div className="va-bubbles__reply">
          <Avatar name={name} portrait={portrait} />
          <div className="va-bubble va-bubble--character">
            <span className="convai-visually-hidden">{name}: </span>
            <Reply turn={turn} name={name} />
          </div>
        </div>
      )}
    </article>
  );
}

function Avatar({ name, portrait }: { name: string; portrait: string | null }) {
  return (
    <span className="va-avatar va-avatar--28" aria-hidden="true">
      <Portrait src={portrait}>{name.slice(0, 1).toUpperCase()}</Portrait>
    </span>
  );
}

function FailedBubble({
  turn,
  name,
  portrait,
  onRetry,
}: {
  turn: Turn;
  name: string;
  portrait: string | null;
  onRetry: (id: number) => void;
}) {
  const fresh = useNewFailure(turn);
  return (
    <div className="va-bubbles__failed" role={fresh ? 'alert' : undefined}>
      <div className="va-bubbles__reply">
        <Avatar name={name} portrait={portrait} />
        <p className="va-bubble va-bubble--character va-bubble--failed">
          <span className="convai-visually-hidden">{name}: </span>
          No answer. Something went wrong.
        </p>
      </div>
      <button
        type="button"
        className="va-bubbles__again"
        onClick={() => {
          onRetry(turn.id);
        }}
      >
        Ask again
      </button>
    </div>
  );
}

/** The style picker's menu: ↑↓ move, Return picks, Esc closes (the window's key router owns Esc). */
function StyleMenu({
  value,
  onPick,
  onClose,
}: {
  value: TranscriptStyle;
  onPick: (value: TranscriptStyle) => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, []);
  return (
    <div
      ref={menu}
      className="va-menu"
      role="menu"
      tabIndex={-1}
      aria-label="Transcript style"
      onBlur={(event) => {
        if (!menu.current?.contains(event.relatedTarget)) onClose();
      }}
      onKeyDown={(event) => {
        const rows = [
          ...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []),
        ];
        const at = rows.indexOf(document.activeElement as HTMLElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const next = (at + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
          rows[next]?.focus();
        }
      }}
    >
      {pickable.map((option) => (
        <button
          key={option.value}
          type="button"
          role="menuitemradio"
          aria-checked={option.value === value}
          className="va-menu__row"
          tabIndex={option.value === value ? 0 : -1}
          onClick={() => {
            onPick(option.value);
          }}
        >
          <span>{option.label}</span>
          {option.value === value && <Icon name="check" size={16} />}
        </button>
      ))}
    </div>
  );
}
