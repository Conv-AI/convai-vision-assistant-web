import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';
import { Icon, type IconName } from '../icons';
import { KeyCap } from './KeyCap';
import { Spinner } from './Spinner';

export type ButtonKind = 'primary' | 'secondary' | 'text';

/**
 * A button's height: small 28 (an Island toast's action), standard 32, medium 36 (a prompt's two
 * actions), large 40 (dialogs, empty states), extra-large 48 (the one action of a full-window page,
 * always a capsule).
 */
export type ButtonSize = 'small' | 'standard' | 'medium' | 'large' | 'extra-large';

/** radius.s, or radius.capsule for actions on Island surfaces and in dialogs. */
export type ButtonShape = 'rounded' | 'capsule';

type NativeButton = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'disabled'>;

export interface ButtonProps extends NativeButton {
  children: ReactNode;
  /** Primary is the one action a view asks for, at most one per view. Default secondary. */
  kind?: ButtonKind;
  size?: ButtonSize;
  shape?: ButtonShape;
  /** A destructive action: its words are danger.text. Never a primary. */
  danger?: boolean;
  /** A 16 px glyph before the words. */
  icon?: IconName;
  /** The key that does the same, drawn as a cap after the words. */
  keyCap?: string;
  /** Working: a spinner in place of the words; the button keeps its width and takes no press. */
  loading?: boolean;
  disabled?: boolean;

  reasonId?: string;
  ref?: Ref<HTMLButtonElement>;
}

function classes(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

export function Button({
  children,
  kind = 'secondary',
  size = 'standard',
  shape,
  danger = false,
  icon,
  keyCap,
  loading = false,
  disabled = false,
  reasonId,
  className,
  onClick,
  type = 'button',
  ...rest
}: ButtonProps) {
  const inert = disabled || loading;
  const focusableWhenDisabled = disabled && reasonId !== undefined;
  const capsule = shape === 'capsule' || size === 'extra-large';
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (inert) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      {...rest}
      type={type}
      className={classes(
        'convai-button',
        `convai-button--${kind}`,
        `convai-button--${size}`,
        capsule && 'convai-button--capsule',
        danger && kind !== 'primary' && 'convai-button--danger',
        keyCap !== undefined && 'convai-button--with-key-cap',
        loading && 'convai-button--loading',
        disabled && 'convai-disabled',
        className,
      )}
      disabled={disabled && !focusableWhenDisabled}
      aria-disabled={focusableWhenDisabled ? true : undefined}
      aria-keyshortcuts={rest['aria-keyshortcuts'] ?? keyCap}
      aria-describedby={
        classes(rest['aria-describedby'], focusableWhenDisabled && reasonId) || undefined
      }
      aria-busy={loading || undefined}
      onClick={handleClick}
    >
      <span className="convai-button__content">
        {icon && <Icon name={icon} className="convai-button__icon" />}
        <span className="convai-button__label">{children}</span>
        {keyCap !== undefined && <KeyCap inButton>{keyCap}</KeyCap>}
      </span>
      {loading && <Spinner className="convai-button__spinner" />}
    </button>
  );
}
