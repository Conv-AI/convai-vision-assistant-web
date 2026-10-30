import { useRef, type KeyboardEvent } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  /** The group's name, read before the option ("How you talk, Hands free, selected, 1 of 2"). */
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

export function Segmented<T extends string>({
  label,
  labelledBy,
  describedBy,
  options,
  value,
  onChange,
  disabled = false,
}: SegmentedProps<T>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    const to =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : step === 0
            ? -1
            : (chosen + step + options.length) % options.length;
    if (to < 0) return;
    event.preventDefault();
    const option = options[to];
    if (!option) return;
    onChange(option.value);
    buttons.current[to]?.focus();
  };

  return (
    <div
      className={disabled ? 'convai-segmented convai-disabled' : 'convai-segmented'}
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-disabled={disabled || undefined}
    >
      {options.map((option, index) => {
        const on = index === chosen;
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className="convai-segmented__option"
            onClick={(event) => {
              event.stopPropagation();
              if (!disabled && !on) onChange(option.value);
            }}
            onKeyDown={onKeyDown}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
