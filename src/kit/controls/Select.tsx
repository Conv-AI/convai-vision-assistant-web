import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useEscapeLayer } from '../escape';
import { Icon } from '../icons';
import { Tooltip } from './Tooltip';

export interface SelectOption {
  value: string;
  label: string;
  /** Quieter words after the label ("Not connected"). */
  meta?: string;
}

interface SelectProps {
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  disabled?: boolean;
  /** What the field says when no option is chosen or there are none. */
  placeholder?: string;
  /** Something after the options, such as a rule and a row that leaves ("Sound settings…"). */
  footer?: ReactNode;
}

export const menuRows = 8;

export function Select({
  options,
  value,
  onChange,
  label,
  labelledBy,
  describedBy,
  disabled = false,
  placeholder = '',
  footer,
}: SelectProps) {
  const id = useId();
  const field = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [above, setAbove] = useState(false);
  const typed = useRef({ text: '', at: 0 });
  const chosen = options.findIndex((option) => option.value === value);
  const shown = options[chosen]?.label ?? placeholder;

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) field.current?.focus();
  };
  useEscapeLayer(open, close);

  const openMenu = () => {
    if (disabled || options.length === 0) return;
    setActive(Math.max(0, chosen));
    setOpen(true);
  };

  const pick = (index: number) => {
    const option = options[index];
    close();
    if (option && option.value !== value) onChange(option.value);
  };

  // Open, the menu stands below the field, or above it when the page has no room under it; the
  // focus goes into it.
  useLayoutEffect(() => {
    if (!open) return;
    const edge = field.current?.getBoundingClientRect();
    const menu = list.current;
    if (edge && menu) {
      const room = window.innerHeight - edge.bottom;
      setAbove(room < menu.offsetHeight + 8 && edge.top > room);
    }
    menu?.focus();
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${String(active)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const jump = (key: string) => {
    const now = performance.now();
    const text = now - typed.current.at < 700 ? typed.current.text + key : key;
    typed.current = { text, at: now };
    const lower = text.toLocaleLowerCase();
    const at = options.findIndex((option) => option.label.toLocaleLowerCase().startsWith(lower));
    if (at >= 0) setActive(at);
  };

  const onFieldKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu();
    }
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = options.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        setActive((at) => Math.min(last, at + 1));
        break;
      case 'ArrowUp':
        setActive((at) => Math.max(0, at - 1));
        break;
      case 'Home':
        setActive(0);
        break;
      case 'End':
        setActive(last);
        break;
      case 'Enter':
      case ' ':
        pick(active);
        break;
      case 'Escape':
        close();
        break;
      case 'Tab':
        // Tab leaves with the menu closed and nothing changed.
        close(false);
        return;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          jump(event.key);
          break;
        }
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <span className="convai-select">
      {/* A value cut in the field shows whole in the tooltip (C11). */}
      <Tooltip text={shown} wraps>
        <button
          ref={field}
          type="button"
          className={disabled ? 'convai-select__field convai-disabled' : 'convai-select__field'}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? `${id}-list` : undefined}
          // The name, then the value: "Input device, Studio USB, pop-up button".
          aria-labelledby={`${labelledBy ?? `${id}-label`} ${id}-value`}
          aria-describedby={describedBy}
          aria-disabled={disabled || undefined}
          data-open={open || undefined}
          onClick={(event) => {
            event.stopPropagation();
            if (open) close();
            else openMenu();
          }}
          onKeyDown={onFieldKey}
        >
          {!labelledBy && (
            <span id={`${id}-label`} className="convai-visually-hidden">
              {label}
            </span>
          )}
          <span id={`${id}-value`} className="convai-select__value">
            {shown}
          </span>
          <Icon name="chevron-down" size={14} className="convai-select__chevron" />
        </button>
      </Tooltip>
      {open && (
        <div
          ref={list}
          id={`${id}-list`}
          className="convai-select__menu"
          data-above={above || undefined}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-labelledby={labelledBy}
          aria-activedescendant={`${id}-option-${String(active)}`}
          onKeyDown={onMenuKey}
          onBlur={(event) => {
            // A press elsewhere closes it, as Tab does: the focus has gone where it went.
            if (!event.currentTarget.contains(event.relatedTarget)) close(false);
          }}
        >
          {options.map((option, index) => (
            <button
              type="button"
              key={option.value}
              id={`${id}-option-${String(index)}`}
              tabIndex={-1}
              data-index={index}
              role="option"
              aria-selected={index === chosen}
              className="convai-select__option"
              data-active={index === active || undefined}
              onPointerMove={() => {
                setActive(index);
              }}
              onPointerDown={(event) => {
                // The press picks; the menu keeps the focus until then.
                event.preventDefault();
              }}
              onClick={(event) => {
                event.stopPropagation();
                pick(index);
              }}
            >
              <span className="convai-select__check" aria-hidden="true">
                {index === chosen && <Icon name="check" size={16} />}
              </span>
              <span className="convai-select__label">{option.label}</span>
              {option.meta && <span className="convai-select__meta">{option.meta}</span>}
            </button>
          ))}
          {footer}
        </div>
      )}
    </span>
  );
}
