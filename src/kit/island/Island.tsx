import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Button } from '../controls/Button';
import { Icon } from '../icons';
import { LensLoader } from '../lens/Lens';
import {
  bindLastWords,
  bindWords,
  fitSteps,
  formOf,
  type Notification,
  type ToastFit,
} from './notification';
import type { NotificationQueue } from './queue';

interface IslandProps {
  queue: NotificationQueue;

  overPicture?: boolean;

  overLighter?: boolean;

  keys?: boolean;
}

/** The queue's clock moves on this often while the Island is mounted. */
const tickMs = 100;

/**
 * Redraws on every change to what the queue shows. The snapshot is the queue's own count, so a change
 * made while React swaps subscriptions (a hold lifted in an effect's cleanup in the commit that
 * redraws the Island) is still drawn.
 */
function useQueue(queue: NotificationQueue) {
  const subscribe = useCallback((onChange: () => void) => queue.subscribe(onChange), [queue]);
  return useSyncExternalStore(subscribe, () => queue.version);
}

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLInputElement &&
        !['button', 'checkbox', 'radio'].includes(target.type)))
  );
}

export function Island({
  queue,
  overPicture = false,
  overLighter = false,
  keys = true,
}: IslandProps) {
  useQueue(queue);
  const current = queue.current;
  const dotted = queue.dotted;
  const surface = useRef<HTMLDivElement>(null);
  const cameFrom = useRef<HTMLElement | null>(null);
  const hovered = useRef(false);
  const focused = useRef(false);

  const updatePause = () => {
    queue.pause(hovered.current || focused.current);
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      queue.tick();
    }, tickMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [queue]);

  // When the content that held the focus leaves (put away, acted on, replaced), the focus goes back
  // to where it came from, not to the page.
  const shownKey = current?.key ?? (queue.dotTop ? 'dot' : '');
  useLayoutEffect(() => {
    const element = surface.current;
    if (!element || !focused.current) return;
    const active = document.activeElement;
    if (element.contains(active)) return;
    focused.current = false;
    updatePause();
    // Only a focus that fell to the page goes back; one the action moved on (to a menu it opened)
    // stays where the action put it.
    const fell = active === null || active === document.body;
    if (fell && cameFrom.current?.isConnected) cameFrom.current.focus();
    cameFrom.current = null;
  });

  useEffect(() => {
    if (!keys) return;
    const onKey = (event: KeyboardEvent) => {
      const inIsland = surface.current?.contains(document.activeElement) ?? false;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        // A text field keeps its own undo.
        if (!isTextField(event.target) && queue.invokeUndo()) event.preventDefault();
        return;
      }
      if (event.key === 'F6' && surface.current) {
        const first = surface.current.querySelector<HTMLElement>('button:not([tabindex="-1"])');
        if (first) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const n = queue.current;
      if (!n) return;
      const noAction = !n.primary;
      if (inIsland || (noAction && (n.level === 'status' || n.level === 'problem'))) {
        event.preventDefault();
        queue.putAway();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [queue, keys]);

  const top = queue.dotTop;
  return (
    <div
      className={[
        'convai-island',
        overPicture && 'convai-island--over-picture',
        overLighter && 'convai-island--over-lighter',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div
        ref={surface}
        className="convai-island__surface"
        onPointerEnter={() => {
          hovered.current = true;
          updatePause();
        }}
        onPointerLeave={() => {
          hovered.current = false;
          updatePause();
        }}
        onFocus={(event) => {
          if (!focused.current && event.relatedTarget instanceof HTMLElement) {
            cameFrom.current = event.relatedTarget;
          }
          focused.current = true;
          updatePause();
        }}
        onBlur={(event) => {
          if (
            event.relatedTarget instanceof Node &&
            surface.current?.contains(event.relatedTarget)
          ) {
            return;
          }
          focused.current = false;
          cameFrom.current = null;
          updatePause();
        }}
        data-form={current ? formOf(current) : top ? 'dot' : 'none'}
        hidden={!current && !top}
      >
        <div key={shownKey} className="convai-island__content">
          {current ? (
            <Shown n={current} queue={queue} />
          ) : top ? (
            <button
              type="button"
              className="convai-island__dot"
              aria-label={`${top.title}${dotted.length > 1 ? `, ${String(dotted.length - 1)} more` : ''}. Expand.`}
              onClick={() => {
                queue.expand();
              }}
            >
              <Icon name={top.icon ?? 'warning'} />
              <span
                className={[
                  'convai-island__badge',
                  top.mark === 'warn' && 'convai-island__badge--warn',
                ]
                  .filter(Boolean)
                  .join(' ')}
              />
              {dotted.length > 1 && (
                <span className="convai-island__badge convai-island__badge--second" />
              )}
            </button>
          ) : null}
        </div>
      </div>
      <Announcer n={current} queue={queue} />
    </div>
  );
}

const spoken = (n: Notification) =>
  [n.title, n.detail?.replace(/^\s*·\s*/, ''), n.body].filter(Boolean).join('. ');

/**
 * Status and Undo politely, each time they show; a Problem or Request assertively once, and not
 * again when it comes back from the dot or updates in place, until it is resolved.
 */
function Announcer({ n, queue }: { n: Notification | null; queue: NotificationQueue }) {
  const told = useRef(new Set<string>());
  const [alert, setAlert] = useState({ key: '', text: '' });
  const urgent = n?.level === 'problem' || n?.level === 'request';

  // The alert region changes only when a new Problem or Request arrives, or when the one it read is
  // resolved: a region whose text comes back would be read again.
  useEffect(() => {
    for (const key of told.current) if (!queue.contains(key)) told.current.delete(key);
    if (n && urgent && !told.current.has(n.key)) {
      told.current.add(n.key);
      setAlert({ key: n.key, text: spoken(n) });
    } else if (alert.key && !told.current.has(alert.key)) {
      setAlert({ key: '', text: '' });
    }
  }, [n, urgent, queue, alert.key]);

  return (
    <>
      <span className="convai-visually-hidden" role="status">
        {n && !urgent ? spoken(n) : ''}
      </span>
      <span className="convai-visually-hidden" role="alert">
        {alert.text}
      </span>
    </>
  );
}

function Shown({ n, queue }: { n: Notification; queue: NotificationQueue }) {
  const form = formOf(n);
  return form === 'banner' || form === 'banner-two-actions' ? (
    <Banner n={n} queue={queue} />
  ) : (
    // New words start again from the whole toast, as another width or text size does.
    <Toast key={[n.title, n.detail, n.brief].join('|')} n={n} queue={queue} />
  );
}

function Toast({ n, queue }: { n: Notification; queue: NotificationQueue }) {
  const row = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<ToastFit>('whole');
  // Each new measure starts again from the whole toast, even when it already stood whole: the words
  // may have grown under it (a text size, the font arriving).
  const [pass, setPass] = useState(0);
  const again = () => {
    setFit('whole');
    setPass((count) => count + 1);
  };

  useEffect(() => {
    const host = row.current?.closest('.convai-island');
    if (!host) return;
    let width = host.clientWidth;
    const resized = new ResizeObserver(() => {
      if (host.clientWidth === width) return;
      width = host.clientWidth;
      again();
    });
    resized.observe(host);
    const root = host.closest('.convai-theme') ?? document.documentElement;
    const restyled = new MutationObserver(() => {
      again();
    });
    restyled.observe(root, { attributes: true, attributeFilter: ['class', 'style'] });
    // Words measured in a fallback font change width when the font arrives: measure again then.
    const fontsArrived = () => {
      again();
    };
    document.fonts.addEventListener('loadingdone', fontsArrived);
    return () => {
      resized.disconnect();
      restyled.disconnect();
      document.fonts.removeEventListener('loadingdone', fontsArrived);
    };
  }, []);

  useLayoutEffect(() => {
    const line = row.current?.querySelector('.convai-island__line');
    if (!line || fit === 'two-lines') return;
    if (line.scrollWidth > line.clientWidth + 0.5) {
      const steps = fitSteps(n);
      setFit(steps[steps.indexOf(fit) + 1] ?? 'two-lines');
    }
  }, [fit, n, pass]);

  const words =
    fit === 'brief' || (fit === 'two-lines' && n.brief) ? (n.brief ?? n.title) : n.title;
  const action = n.primary;
  return (
    <div
      ref={row}
      className={[
        'convai-island__toast',
        action && 'convai-island__toast--action',
        n.working && 'convai-island__toast--loader',
        n.mark === 'warn' && 'convai-island__toast--warn',
        fit === 'two-lines' && 'convai-island__toast--two-lines',
      ]
        .filter(Boolean)
        .join(' ')}
      data-fit={fit}
    >
      {n.working ? (
        <LensLoader />
      ) : n.icon ? (
        <Icon name={n.icon} className="convai-island__icon" />
      ) : action ? null : (
        <span
          className={['convai-island__mark', n.mark === 'warn' && 'convai-island__mark--warn']
            .filter(Boolean)
            .join(' ')}
        />
      )}
      <span className="convai-island__line">
        <span className="convai-island__text">
          {fit === 'two-lines' ? bindLastWords(words) : words}
        </span>
        {n.detail && fit !== 'brief' && !(fit === 'two-lines' && n.brief) && (
          <span className="convai-island__detail">{n.detail}</span>
        )}
      </span>
      {action && (
        <Button
          size="small"
          shape="capsule"
          icon={n.level === 'undo' ? 'undo' : undefined}
          className="convai-island__action"
          onClick={() => {
            queue.invoke(action);
          }}
        >
          {action.label}
        </Button>
      )}
      {fit === 'whole' && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="convai-island__close convai-island__close--toast"
          onClick={() => {
            queue.putAway();
          }}
        >
          <Icon name="close-small" size={12} />
        </button>
      )}
    </div>
  );
}

function Banner({ n, queue }: { n: Notification; queue: NotificationQueue }) {
  const { primary, secondary } = n;
  return (
    <div className="convai-island__banner">
      <div className="convai-island__banner-text">
        {/* The close's 44 press area takes the corner: only the lines beside it are shortened. */}
        <span className="convai-island__float" aria-hidden="true" />
        <span className="convai-island__title">{bindWords(n.title)}</span>
        {n.body && <span className="convai-island__body">{bindWords(n.body)}</span>}
      </div>
      <div
        className={[
          'convai-island__banner-actions',
          secondary && 'convai-island__banner-actions--two',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {primary && (
          <Button
            kind="primary"
            shape="capsule"
            onClick={() => {
              queue.invoke(primary);
            }}
          >
            {primary.label}
          </Button>
        )}
        {secondary && (
          <Button
            shape="capsule"
            onClick={() => {
              queue.invoke(secondary);
            }}
          >
            {secondary.label}
          </Button>
        )}
      </div>
      <button
        type="button"
        className="convai-island__close"
        aria-label="Close"
        onClick={() => {
          queue.putAway();
        }}
      >
        <Icon name="close-small" size={12} />
      </button>
    </div>
  );
}
