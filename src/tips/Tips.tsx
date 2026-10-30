import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { TalkMode } from '../kit/capsule/capsuleCopy';
import { placeTip, type Box, type TipPlace } from '../kit/tip/place';
import { Tip, TipHalo } from '../kit/tip/Tip';
import { useAnnouncement } from '../kit/useAnnouncement';
import type { SessionState } from '../session/session';
import { TipCoach, type ShownTip, type TipView } from './coach';
import { spokenTitle, tipOrder, tipWords, type TipKeys, type TipTargetId } from './copy';
import { earlierAnswers, tipSignals } from './signals';
import { TipsStore } from './stored';

/** The window as `SessionWindow` sees it; the targets and words are read here. */
export type TipWindow = Omit<TipView, 'targets' | 'worded' | 'captionShown'>;

export interface TipsProps {
  name: string;
  state: SessionState;
  talkMode: TalkMode;
  keys: TipKeys;
  window: TipWindow;
  /** Changes when Show tips again or Try it was pressed: every tip as new, from the first one. */
  replay: number;
}

const leaveMs = 150;

function pageStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function boxOf(element: Element): Box {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
}

/** A target on screen now: in the page and laid out (`data-tip-target` names it). */
function targetOf(id: TipTargetId): HTMLElement | null {
  const element = document.querySelector<HTMLElement>(`[data-tip-target="${id}"]`);
  return element && element.getClientRects().length > 0 ? element : null;
}

/**
 * What a bubble keeps clear of (0.43.0 1; Tip README): the inset preview's picture and the floating
 * transcript.
 */
function keepClear(): Box[] {
  return [...document.querySelectorAll('.va-preview__frame, .va-transcript--float')]
    .filter((element) => element.getClientRects().length > 0)
    .map(boxOf);
}

/** The pictures a bubble may stand over: the camera filling the stage, a preview's picture. */
function pictures(): Box[] {
  return [...document.querySelectorAll('.va-camera__video, .va-preview__frame')]
    .filter((element) => element.getClientRects().length > 0)
    .map(boxOf);
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

interface Drawn {
  tip: ShownTip;
  leaving: boolean;
}

export default function Tips({
  name,
  state,
  talkMode,
  keys,
  window: tipWindow,
  replay,
}: TipsProps) {
  const [coach] = useState(() => new TipCoach(new TipsStore(pageStorage())));
  const shown = useSyncExternalStore(
    (onChange) => coach.subscribe(onChange),
    () => coach.shown,
  );

  // A session of the tips begins when the page reaches the character. What happened is read from
  // each new session state against the one before; the first against a session where nothing has
  // happened yet, so what was done before this loaded counts too.
  const before = useRef<SessionState | null>(null);
  useEffect(() => {
    if (!state.everConnected) return;
    coach.start();
    const signals = before.current
      ? tipSignals(before.current, state)
      : [
          ...earlierAnswers(state).map(() => 'answer-ended' as const),
          ...tipSignals({ ...state, talk: 'ready', talks: 0, stops: 0, items: [] }, state),
        ];
    before.current = state;
    for (const signal of signals) coach.signal(signal);
  }, [coach, state]);

  // Show tips again: every tip as new. A press before this loaded counts too.
  const replayed = useRef(0);
  useEffect(() => {
    if (replay === replayed.current) return;
    replayed.current = replay;
    coach.replay();
  });

  // The window as it is, after each render: targets are read from the page.
  const worded = new Set(tipOrder.filter((id) => tipWords(id, name, talkMode, keys) !== null));
  const view = (): TipView => ({
    ...tipWindow,
    targets: new Set(
      (['lens', 'type', 'transcript', 'more'] as const).filter((id) => targetOf(id) !== null),
    ),
    worded,
    captionShown: document.querySelector('.va-captions') !== null,
  });
  const update = useEffectEvent(() => {
    coach.update(view());
  });
  useLayoutEffect(() => {
    update();
  });

  // Time alone moves the coach on: a bubble's 6 s, tip 2's 1.5 s, the 30 s between bubbles. Looked
  // at after every render, since a signal (an answer's speech starting) can start a wait. A caption
  // goes by its own timer, so while one stands the window is looked at again every half second.
  const [looks, setLooks] = useState(0);
  useEffect(() => {
    const captioned = document.querySelector('.va-captions') !== null;
    const next = coach.nextCheck();
    const wait = captioned ? Math.min(500, next ?? 500) : next;
    if (wait === null) return;
    const timer = window.setTimeout(() => {
      update();
      if (captioned) setLooks(looks + 1);
    }, wait + 1);
    return () => {
      window.clearTimeout(timer);
    };
  });

  // A bubble that goes fades out over 150 ms where it stood.
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  if (shown && drawn?.tip !== shown) setDrawn({ tip: shown, leaving: false });
  if (!shown && drawn && !drawn.leaving) setDrawn({ tip: drawn.tip, leaving: true });
  useEffect(() => {
    if (!drawn?.leaving) return;
    const timer = window.setTimeout(() => {
      setDrawn(null);
    }, leaveMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [drawn]);

  // Esc with nothing else to close, or a press anywhere but the target, sends the bubble away.
  const dismiss = useEffectEvent((event: Event) => {
    const tip = coach.shown;
    if (!tip) return;
    if (event instanceof KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
    } else if (event.target instanceof Node && targetOf(tip.target)?.contains(event.target)) return;
    coach.dismiss();
  });
  useEffect(() => {
    const listener = (event: Event) => {
      dismiss(event);
    };
    window.addEventListener('keydown', listener);
    window.addEventListener('pointerdown', listener, true);
    return () => {
      window.removeEventListener('keydown', listener);
      window.removeEventListener('pointerdown', listener, true);
    };
  }, []);

  // While a bubble shows, the target's own tooltip would stand where it stands: tooltips wait.
  useEffect(() => {
    if (!shown) return;
    document.documentElement.classList.add('convai-tip-shows');
    return () => {
      document.documentElement.classList.remove('convai-tip-shows');
    };
  }, [shown]);

  // The bubble follows its target every frame while drawn (the stage eases when the panel moves).
  const bubble = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{
    place: TipPlace;
    target: Box;
    radius: string;
    overPicture: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    if (!drawn) return;
    let frame = 0;
    const measure = () => {
      const target = targetOf(drawn.tip.target);
      const own = bubble.current;
      if (target && own) {
        const box = boxOf(target);
        const size = { width: own.offsetWidth, height: own.offsetHeight };
        const host = target.closest('.convai-capsule');
        const next = placeTip(
          box,
          size,
          { width: window.innerWidth, height: window.innerHeight },
          keepClear(),
          host ? boxOf(host) : undefined,
        );

        const overPicture = pictures().some((picture) => overlaps({ ...next, ...size }, picture));
        const radius = getComputedStyle(target).borderRadius;
        setPlace((current) =>
          current?.radius === radius &&
          current.overPicture === overPicture &&
          JSON.stringify([current.place, current.target]) === JSON.stringify([next, box])
            ? current
            : { place: next, target: box, radius, overPicture },
        );
      }
      frame = window.requestAnimationFrame(measure);
    };
    measure();
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [drawn]);

  const words = drawn ? tipWords(drawn.tip.id, name, talkMode, keys) : null;
  const said = useAnnouncement(shown && words ? `Tip: ${spokenTitle(words)}. ${words.line}` : '');

  return (
    <>
      {drawn && words && (
        <div className="va-tip" data-tip={drawn.tip.id}>
          {place && <TipHalo box={place.target} radius={place.radius} leaving={drawn.leaving} />}
          <Tip
            {...words}
            ref={bubble}
            side={place?.place.side ?? 'above'}
            tailOffset={place?.place.tailOffset ?? 28}
            overPicture={place?.overPicture ?? false}
            leaving={drawn.leaving}
            style={
              place
                ? { left: place.place.left, top: place.place.top }
                : { left: 0, top: 0, visibility: 'hidden' }
            }
          />
        </div>
      )}
      <span className="convai-visually-hidden" role="status">
        {said}
      </span>
    </>
  );
}
