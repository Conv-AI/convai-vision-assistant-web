import type { Ref } from 'react';

interface SwitchProps {
  on: boolean;
  onChange: (on: boolean) => void;
  /** The setting's name, read with the switch ("Captions, switch, on"). */
  label?: string;
  /** The id of the element that names it, for a switch whose label stands in its row. */
  labelledBy?: string;
  /** The id of the line under the row's label, read after the state. */
  describedBy?: string;
  disabled?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Switch({
  on,
  onChange,
  label,
  labelledBy,
  describedBy,
  disabled = false,
  ref,
}: SwitchProps) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      className={disabled ? 'convai-switch convai-disabled' : 'convai-switch'}
      aria-checked={on}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-disabled={disabled || undefined}
      onClick={(event) => {
        // The row's own press stands for this one: it is not heard twice.
        event.stopPropagation();
        if (!disabled) onChange(!on);
      }}
    >
      <span className="convai-switch__knob" aria-hidden="true" />
    </button>
  );
}
