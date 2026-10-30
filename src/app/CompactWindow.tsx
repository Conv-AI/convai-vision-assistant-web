import { useLayoutEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { compactCopy } from '../compact/copy';
import { Button } from '../kit/controls/Button';

interface CompactWindowProps {
  /** The browser's floating window the capsule moves into. */
  window: Window;

  notice: boolean;
  /** The notice's Open: back to the full window. */
  onOpen: () => void;
  /** The pointer or the focus is on the notice: its time waits (the kit Island's rule). */
  onHoldNotice: (held: boolean) => void;

  children: ReactNode;
}

export function CompactWindow({
  window: floating,
  notice,
  onOpen,
  onHoldNotice,
  children,
}: CompactWindowProps) {
  const body = floating.document.body;

  // The window's body is the app's ground; its root follows the page's preferences (Compact).
  useLayoutEffect(() => {
    body.classList.add('va-compact-window');
    return () => {
      body.classList.remove('va-compact-window');
    };
  }, [body]);

  return createPortal(
    <main className="va-compact">
      <h1 className="convai-visually-hidden">Convai Vision Assistant</h1>
      {notice ? (
        <div
          className="va-compact__notice"
          onPointerEnter={() => {
            onHoldNotice(true);
          }}
          onPointerLeave={() => {
            onHoldNotice(false);
          }}
          onFocus={() => {
            onHoldNotice(true);
          }}
          onBlur={() => {
            onHoldNotice(false);
          }}
        >
          <span className="va-compact__notice-words" aria-hidden="true">
            {compactCopy.imagesInFull}
          </span>
          <Button size="small" shape="capsule" onClick={onOpen}>
            {compactCopy.open}
          </Button>
        </div>
      ) : (
        children
      )}
      {/* One status line for the window's life: a live region that arrives filled is often missed. */}
      <span className="convai-visually-hidden" role="status">
        {notice ? compactCopy.imagesInFull : ''}
      </span>
    </main>,
    body,
  );
}

interface CompactAwayProps {
  name: string;
  onBack: () => void;
}

export function CompactAway({ name, onBack }: CompactAwayProps) {
  return (
    <div className="va-compact-away">
      <p className="va-compact-away__line">{compactCopy.away(name)}</p>
      <p className="va-compact-away__keys">{compactCopy.awayKeys}</p>
      <Button size="medium" shape="capsule" onClick={onBack}>
        {compactCopy.back(name)}
      </Button>
    </div>
  );
}
