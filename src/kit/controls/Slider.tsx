import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { stepValue } from './stepValue';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  /** What an arrow key moves the value by; a drag lands on a step too. */
  step: number;
  onChange: (value: number) => void;
  /** The value as the person reads it ("115 %"), shown after the track and read by screen readers. */
  format: (value: number) => string;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  /** What stands at the track's two ends (Text size's small and large A), or nothing. */
  ends?: readonly [ReactNode, ReactNode];
  disabled?: boolean;
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  format,
  label,
  labelledBy,
  describedBy,
  ends,
  disabled = false,
}: SliderProps) {
  const track = useRef<HTMLSpanElement>(null);
  const share = max > min ? (value - min) / (max - min) : 0;
  const percent = `${String(Math.min(1, Math.max(0, share)) * 100)}%`;

  const change = (next: number) => {
    const stepped = stepValue(next, min, max, step);
    if (stepped !== value) onChange(stepped);
  };

  const fromPointer = (clientX: number) => {
    const edge = track.current?.getBoundingClientRect();
    if (!edge || edge.width === 0) return;
    const at = Math.min(1, Math.max(0, (clientX - edge.left) / edge.width));
    change(min + at * (max - min));
  };

  const onPointerDown = (event: PointerEvent<HTMLSpanElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    fromPointer(event.clientX);
  };

  const onPointerMove = (event: PointerEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    fromPointer(event.clientX);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (disabled) return;
    const big = step * 10;
    const by: Record<string, number> = {
      ArrowRight: event.shiftKey ? big : step,
      ArrowUp: event.shiftKey ? big : step,
      ArrowLeft: -(event.shiftKey ? big : step),
      ArrowDown: -(event.shiftKey ? big : step),
      PageUp: big,
      PageDown: -big,
    };
    let next: number | undefined;
    if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    else if (event.key in by) next = value + (by[event.key] ?? 0);
    if (next === undefined) return;
    event.preventDefault();
    change(next);
  };

  return (
    <span
      className={disabled ? 'convai-slider convai-disabled' : 'convai-slider'}
      aria-disabled={disabled || undefined}
    >
      {ends && (
        <span className="convai-slider__end" aria-hidden="true">
          {ends[0]}
        </span>
      )}
      <span
        ref={track}
        className="convai-slider__track"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        aria-disabled={disabled || undefined}
        style={{ ['--convai-slider-at' as string]: percent }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <span className="convai-slider__rail" aria-hidden="true" />
        <span className="convai-slider__fill" aria-hidden="true" />
        <span className="convai-slider__knob" aria-hidden="true" />
      </span>
      {ends && (
        <span className="convai-slider__end" aria-hidden="true">
          {ends[1]}
        </span>
      )}
      <span className="convai-slider__value" aria-hidden="true">
        {format(value)}
      </span>
    </span>
  );
}
