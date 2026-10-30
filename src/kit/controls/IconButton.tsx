import { useId, type ButtonHTMLAttributes, type MouseEvent, type Ref } from 'react';
import { Icon, type IconName } from '../icons';
import { Spinner } from './Spinner';
import { Tooltip } from './Tooltip';

/**
 * secondary: fill.emphasis, the icon button of a sheet or toolbar. primary: accent.user, the round
 * talk and send buttons. tool: no fill until hover, text.secondary glyph, the capsule's tools.
 */
export type IconButtonKind = 'primary' | 'secondary' | 'tool';

type NativeButton = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'disabled' | 'aria-label'
>;

export interface IconButtonProps extends NativeButton {
  /** The button's name: its accessible name and its tooltip. Never the glyph. */
  label: string;
  /**
   * The tooltip's words where they differ from the name: a toggle keeps its name and says what a
   * press does now here ("Resume vision" on a pressed Pause vision).
   */
  tooltip?: string;
  icon: IconName;
  kind?: IconButtonKind;
  /** square (radius.s) for toolbars; round for the capsule's tools, talk and send. */
  shape?: 'square' | 'round';
  /** small 28, standard 32, large 40. Icon buttons hold no text, so text size never grows them. */
  size?: 'small' | 'standard' | 'large';
  /** A key that does the same, shown in the tooltip. */
  shortcut?: string;
  /** Pressed state for a toggle, such as Mute. */
  pressed?: boolean;
  loading?: boolean;
  disabled?: boolean;

  reason?: string;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  label,
  tooltip,
  icon,
  kind = 'secondary',
  shape = 'square',
  size = 'standard',
  shortcut,
  pressed,
  loading = false,
  disabled = false,
  reason,
  className,
  onClick,
  type = 'button',
  ref,
  ...rest
}: IconButtonProps) {
  const inert = disabled || loading;
  const focusableWhenDisabled = disabled && reason !== undefined;
  const reasonId = useId();
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (inert) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <Tooltip
      text={focusableWhenDisabled ? reason : (tooltip ?? label)}
      shortcut={focusableWhenDisabled ? undefined : shortcut}
    >
      <button
        {...rest}
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={pressed}
        aria-disabled={focusableWhenDisabled ? true : undefined}
        aria-keyshortcuts={rest['aria-keyshortcuts'] ?? shortcut}
        aria-describedby={
          [rest['aria-describedby'], focusableWhenDisabled && reasonId].filter(Boolean).join(' ') ||
          undefined
        }
        aria-busy={loading || undefined}
        disabled={disabled && !focusableWhenDisabled}
        className={[
          'convai-button',
          'convai-icon-button',
          `convai-button--${kind === 'tool' ? 'text' : kind}`,
          kind === 'tool' && 'convai-button--tool',
          `convai-icon-button--${shape}`,
          `convai-icon-button--${size}`,
          loading && 'convai-button--loading',
          disabled && 'convai-disabled',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={handleClick}
      >
        <span className="convai-button__content">
          <Icon name={icon} className="convai-button__icon" />
        </span>
        {loading && <Spinner className="convai-button__spinner" />}
        {focusableWhenDisabled && (
          <span id={reasonId} className="convai-visually-hidden">
            {reason}
          </span>
        )}
      </button>
    </Tooltip>
  );
}
