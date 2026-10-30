import { useLayoutEffect, useRef, type Ref, type RefObject } from 'react';
import { cardLine, compactCopy } from '../compact/copy';
import type { WindowMode } from '../compact/compact';
import { Button } from '../kit/controls/Button';
import { Tooltip } from '../kit/controls/Tooltip';
import { cardPlace } from './cardPlace';

interface ModeSwitchProps {
  mode: WindowMode;
  /** The card stands under the switch: Compact shows expanded. */
  cardOpen: boolean;

  cardSeen: boolean;
  /** True where Compact opens the card rather than a window. */
  explains: boolean;
  onFull: () => void;
  onCompact: () => void;
  compactRef: Ref<HTMLButtonElement>;
}

export function ModeSwitch({
  mode,
  cardOpen,
  cardSeen,
  explains,
  onFull,
  onCompact,
  compactRef,
}: ModeSwitchProps) {
  return (
    <div className="va-mode" role="group" aria-label={compactCopy.switch}>
      <Tooltip text={compactCopy.full}>
        <button
          type="button"
          className="va-mode__option"
          aria-label={compactCopy.full}
          aria-pressed={mode === 'full'}
          onClick={onFull}
        >
          {/* Part - Window's glyphs: the window with its column, and with a small one in its corner. */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
            <path d="M10 3v10" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip text={explains && cardSeen ? compactCopy.cardTitle : compactCopy.compact}>
        <button
          ref={compactRef}
          type="button"
          className="va-mode__option"
          aria-label={compactCopy.compact}
          // Where it explains, it opens the card and turns nothing on: no toggle state then.
          aria-pressed={explains ? undefined : mode === 'compact'}
          aria-haspopup={explains ? 'dialog' : undefined}
          aria-expanded={explains ? cardOpen : undefined}
          onClick={onCompact}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
            <rect x="9" y="8.5" width="5.5" height="4.5" rx="1" fill="currentColor" stroke="none" />
          </svg>
        </button>
      </Tooltip>
    </div>
  );
}

interface CompactCardProps {
  name: string;
  /** The switch the card hangs from. */
  anchor: RefObject<HTMLElement | null>;

  overPicture: boolean;
  onClose: () => void;
}

export function CompactCard({ name, anchor, overPicture, onClose }: CompactCardProps) {
  const card = useRef<HTMLDivElement>(null);

  // Placed before it is painted, from the switch and the frame as laid out now.
  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    // The frames under it: the stage's own, and a shared picture's inside it (the lowest top wins);
    // their sides, which the card's left edge keeps 8 from.
    const frames = Array.from(document.querySelectorAll('.va-stage, .va-preview__frame'), (frame) =>
      frame.getBoundingClientRect(),
    );

    const stage = document.querySelector('.va-stage')?.getBoundingClientRect();
    const control =
      anchor.current?.closest('.va-mode')?.getBoundingClientRect() ??
      (stage ? { bottom: stage.top, right: stage.right - 8 } : null);
    if (!control) return;
    const place = cardPlace(
      control,
      frames.length > 0 ? Math.max(...frames.map((frame) => frame.top)) : null,
      document.documentElement.clientWidth,
      frames.flatMap((frame) => [frame.left, frame.right]),
    );
    element.style.top = `${String(place.top)}px`;
    element.style.right = `${String(place.right)}px`;
    element.style.width = `${String(place.width)}px`;
    element.style.visibility = 'visible';
    element.querySelector('button')?.focus();
  }, [anchor]);

  // A press outside closes it; a press on the switch is the switch's own (it closes the card too).
  useLayoutEffect(() => {
    const onPress = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (card.current?.contains(target) || anchor.current?.closest('.va-mode')?.contains(target))
        return;
      onClose();
    };
    document.addEventListener('pointerdown', onPress, true);
    return () => {
      document.removeEventListener('pointerdown', onPress, true);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={card}
      className={overPicture ? 'va-compact-card va-compact-card--over-picture' : 'va-compact-card'}
      role="dialog"
      aria-labelledby="va-compact-card-title"
      aria-describedby="va-compact-card-line"
    >
      <div className="va-compact-card__words">
        <h2 id="va-compact-card-title" className="va-compact-card__title">
          {compactCopy.cardTitle}
        </h2>
        <p id="va-compact-card-line" className="va-compact-card__line">
          {cardLine(name)}
        </p>
      </div>
      <div className="va-compact-card__actions">
        <Button kind="primary" size="medium" shape="capsule" onClick={onClose}>
          {compactCopy.gotIt}
        </Button>
      </div>
    </div>
  );
}
