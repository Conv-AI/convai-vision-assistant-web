import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Button } from '../controls/Button';
import { useModal } from './useModal';

interface DialogProps {
  title: string;

  body: readonly string[];
  /** What stands between the body and the actions, such as the share card's steps; it is read too. */
  children?: ReactNode;
  /** The action the dialog asks for; it has the focus on open. */
  confirm: string;
  /** The safe way out: Esc and a press on the scrim do the same. */
  cancel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** The app's own class, for a dialog of its own width. */
  className?: string;

  danger?: { label: string; run: () => void };
}

export function Dialog({
  title,
  body,
  children,
  confirm,
  cancel,
  onConfirm,
  onCancel,
  className,
  danger,
}: DialogProps) {
  const id = useId();
  const box = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useModal(box, onCancel);
  useLayoutEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <dialog
      ref={box}
      className={className ? `convai-dialog ${className}` : 'convai-dialog'}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={children ? `${id}-body ${id}-more` : `${id}-body`}
    >
      <div className="convai-dialog__words">
        <h2 id={`${id}-title`} className="convai-dialog__title">
          {title}
        </h2>
        <p id={`${id}-body`} className="convai-dialog__body">
          {body.join(' ')}
        </p>
      </div>
      {children && <div id={`${id}-more`}>{children}</div>}
      <div className="convai-dialog__actions">
        {danger ? (
          <Button shape="capsule" size="medium" danger onClick={danger.run}>
            {danger.label}
          </Button>
        ) : (
          <Button kind="text" shape="capsule" size="medium" onClick={onCancel}>
            {cancel}
          </Button>
        )}
        <Button ref={confirmRef} kind="primary" shape="capsule" size="medium" onClick={onConfirm}>
          {confirm}
        </Button>
      </div>
    </dialog>
  );
}
