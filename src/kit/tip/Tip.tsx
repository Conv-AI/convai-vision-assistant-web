import type { CSSProperties, Ref } from 'react';
import type { TipSide } from './place';
import { bindTipLine } from './words';
import './tip.css';

export interface TipProps {
  title?: string;
  /** Drawn as a cap inside the title; key caps go only in titles (rounds 9–13, 4). */
  keyCap?: string;
  titleAfter?: string;
  line?: string;
  /** The side of its target the bubble stands on: the tail is on the bubble's other side. */
  side: TipSide;
  /** From the bubble's near edge to the tail's box (28 unless the window edge moved the bubble). */
  tailOffset: number;

  overPicture?: boolean;
  /** Leaving: a 150 ms fade. */
  leaving?: boolean;
  style?: CSSProperties;
  ref?: Ref<HTMLDivElement>;
}

export function Tip({
  title,
  keyCap,
  titleAfter,
  line,
  side,
  tailOffset,
  overPicture = false,
  leaving = false,
  style,
  ref,
}: TipProps) {
  const across = side === 'above' || side === 'below';
  return (
    <div
      ref={ref}
      className={[
        'convai-tip',
        `convai-tip--${side}`,
        overPicture && 'convai-tip--over-picture',
        leaving && 'convai-tip--leaving',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        ...style,
        // The bubble grows out of its tail.
        transformOrigin: across
          ? `${String(tailOffset + 7)}px ${side === 'above' ? '100%' : '0'}`
          : `${side === 'left' ? '100%' : '0'} ${String(tailOffset + 7)}px`,
      }}
      aria-hidden="true"
    >
      <span
        className="convai-tip__tail"
        style={across ? { left: tailOffset } : { top: tailOffset }}
      />
      <div className="convai-tip__title">
        {title && <span>{title}</span>}
        {keyCap && <kbd className="convai-tip__key">{keyCap}</kbd>}
        {titleAfter && <span>{titleAfter}</span>}
      </div>
      {line && <div className="convai-tip__line">{bindTipLine(line)}</div>}
    </div>
  );
}

export function TipHalo({
  box,
  radius,
  leaving = false,
}: {
  box: { left: number; top: number; width: number; height: number };
  /** The target's own corner radius, as its computed style gives it. */
  radius: string;
  leaving?: boolean;
}) {
  return (
    <span
      className={leaving ? 'convai-tip-halo convai-tip-halo--leaving' : 'convai-tip-halo'}
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        borderRadius: radius,
      }}
      aria-hidden="true"
    />
  );
}
