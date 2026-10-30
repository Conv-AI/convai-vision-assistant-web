import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export const tooltipDelayMs = 600;
/** The gap to the control, counted from its focus ring while one shows . */
export const tooltipGap = 8;
const viewportMargin = 8;

interface TooltipProps {
  /** What the tooltip says: an icon button's name, or the full text of a cut label. */
  text: string;
  /** A key that does the same, shown after the name in text.tertiary. */
  shortcut?: string;

  wraps?: boolean;
  /** A class for the anchor that wraps the control, for its place in a row. */
  className?: string;
  children: ReactNode;
}

/** Keys that move the focus by themselves, in the page or inside a group of controls. */
const movingKeys = new Set([
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);
const watched = new WeakSet<Document>();
const lastKey = new WeakMap<Document, string>();

/**
 * Notes, per document, the key held down there; letting it go or a press of the pointer forgets it.
 * Tab moves the focus while it is down. Forgetting on release matters: the app's own Esc handler may
 * give a focus back before this listener hears that Esc, and must not find the last Tab still there.
 */
function watchKeys(host: Document) {
  if (watched.has(host)) return;
  watched.add(host);
  const forget = () => {
    lastKey.delete(host);
  };
  host.addEventListener(
    'keydown',
    (event) => {
      lastKey.set(host, event.key);
    },
    true,
  );
  host.addEventListener('keyup', forget, true);
  host.addEventListener('pointerdown', forget, true);
}

/**
 * True when the person moved the focus with keys (Tab, arrows, Home, End, Page keys). A focus the app
 * gives back (a dialog or panel closing, a field closing) follows another key, Esc or Enter, and opens
 * no tooltip: one shown there would take the next Esc.
 */
function focusMovedByKeys(host: Document): boolean {
  return movingKeys.has(lastKey.get(host) ?? '');
}

/** How far past its control a focus ring is drawn: its width and its gap (3 + 2 under high contrast). */
function ringReach(control: Element): number {
  const style = getComputedStyle(control);
  return (
    (Number.parseFloat(style.outlineWidth) || 0) + (Number.parseFloat(style.outlineOffset) || 0)
  );
}

/** True while some text inside `element` is wider than its box. */
function isCut(element: HTMLElement): boolean {
  return [element, ...element.querySelectorAll<HTMLElement>('*')].some(
    (e) => e.scrollWidth > e.clientWidth + 0.5,
  );
}

interface Place {
  left: number;
  top: number;
}

export function Tooltip({ text, shortcut, wraps = false, className, children }: TooltipProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  /** The document the tooltip shows in while open: its control's. */
  const [open, setOpen] = useState<Document | null>(null);
  const [place, setPlace] = useState<Place | 'none' | null>(null);
  const id = useId();

  const clear = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  const show = useCallback(
    (delay: number) => {
      window.clearTimeout(timer.current);
      const control = anchor.current;
      if (!control || (wraps && !isCut(control))) return;
      const host = control.ownerDocument;
      if (delay <= 0) setOpen(host);
      else
        timer.current = window.setTimeout(() => {
          setOpen(host);
        }, delay);
    },
    [wraps],
  );
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setOpen(null);
    setPlace(null);
  }, []);

  useEffect(() => clear, []);

  useEffect(() => {
    if (anchor.current) watchKeys(anchor.current.ownerDocument);
  }, []);

  useEffect(() => {
    const view = open?.defaultView;
    if (!view) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        hide();
      }
    };
    view.addEventListener('keydown', onKey, true);
    return () => {
      view.removeEventListener('keydown', onKey, true);
    };
  }, [open, hide]);

  useLayoutEffect(() => {
    const view = open?.defaultView;
    if (!view || !anchor.current || !tip.current) return;
    const control = anchor.current.getBoundingClientRect();
    const box = tip.current.getBoundingClientRect();
    const focused = anchor.current.querySelector(':focus-visible');
    const gap = tooltipGap + (focused ? ringReach(focused) : 0);
    const above = control.top - gap - box.height;
    const below = control.bottom + gap;
    if (above < viewportMargin && below + box.height > view.innerHeight - viewportMargin) {
      setPlace('none');
      return;
    }
    const top = above >= viewportMargin ? above : below;
    const centered = control.left + control.width / 2 - box.width / 2;
    const left = Math.min(
      Math.max(viewportMargin, centered),
      view.innerWidth - viewportMargin - box.width,
    );
    setPlace({ left, top });
  }, [open, text]);

  return (
    <span
      ref={anchor}
      className={className ? `convai-tooltip-anchor ${className}` : 'convai-tooltip-anchor'}
      onPointerEnter={() => {
        show(tooltipDelayMs);
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(event) => {
        if (event.target.matches(':focus-visible') && focusMovedByKeys(event.target.ownerDocument))
          show(wraps ? tooltipDelayMs : 0);
      }}
      onBlur={hide}
    >
      {children}
      {open &&
        place !== 'none' &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role="tooltip"
            aria-hidden="true"
            className={wraps ? 'convai-tooltip convai-tooltip--text' : 'convai-tooltip'}
            style={
              place
                ? { left: place.left, top: place.top }
                : { left: 0, top: 0, visibility: 'hidden' }
            }
          >
            <span className="convai-tooltip__name">{text}</span>
            {shortcut && <span className="convai-tooltip__shortcut">{shortcut}</span>}
          </div>,
          open.body,
        )}
    </span>
  );
}
