import { useLayoutEffect, type RefObject } from 'react';
import { IconButton } from '../kit/controls/IconButton';
import { Lens, LensLoader } from '../kit/lens/Lens';
import type { LensState } from '../kit/lens/lensLabel';
import type { SendState } from '../session/session';

export const composerLines = 8;

/** Inter's normal line height: its typographic ascender and descender over the em, (1984 + 494) / 2048. */
const interLine = 1.21;

export const couldNotSend = 'Couldn’t send. Press Return to try again.';

interface ComposerProps {
  name: string;
  lens: LensState;
  draft: string;
  onDraft: (draft: string) => void;

  canSend: boolean;

  reason?: string;

  send: SendState;
  onSend: () => void;
  /** Back to voice: the Lens, or Esc on an empty field. */
  onClose: () => void;
  fieldRef: RefObject<HTMLTextAreaElement | null>;
}

export function Composer({
  name,
  lens,
  draft,
  onDraft,
  canSend,
  reason,
  send: sendState,
  onSend,
  onClose,
  fieldRef,
}: ComposerProps) {
  const empty = draft.trim() === '';
  const sending = sendState === 'sending';

  // The field takes the focus as it opens, before the next key arrives: letters typed right after /
  // are the message, never shortcuts.
  useLayoutEffect(() => {
    fieldRef.current?.focus();
  }, [fieldRef]);

  // The field is as tall as its lines, up to eight (the kit's `lineHeight × lines + 20`).
  useLayoutEffect(() => {
    const element = fieldRef.current;
    if (!element) return;
    element.style.height = 'auto';
    const style = getComputedStyle(element);
    // The kit's field sets line-height normal: Inter's own 1.21 of the size.
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * interLine;
    // The field is border-box: eight lines of text plus its own padding.
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const most = line * composerLines + padding;
    element.style.height = `${String(Math.min(element.scrollHeight, most))}px`;
    element.toggleAttribute('data-over', element.scrollHeight > element.clientHeight + 1);
  }, [draft, fieldRef]);

  const send = () => {
    if (canSend && !empty && !sending) onSend();
  };

  const failed = canSend && sendState === 'failed' && !empty;
  const note = !canSend && !empty ? reason : undefined;

  return (
    <div className="va-composer-stack">
      {note && (
        <p className="va-composer__note" role="status">
          <span className="va-dot va-dot--warn" aria-hidden="true" />
          {note}
        </p>
      )}
      {failed && (
        <p className="va-composer__line" role="alert">
          <span className="va-dot va-dot--danger" aria-hidden="true" />
          {couldNotSend}
        </p>
      )}
      <div
        className="va-composer"
        role="group"
        aria-label={`Message ${name}`}
        data-send={sendState === 'idle' ? undefined : sendState}
      >
        <button
          type="button"
          className="va-composer__lens"
          aria-label="Back to voice"
          onClick={onClose}
        >
          <Lens
            name={name}
            state={sending ? 'thinking' : lens === 'offline' ? 'offline' : 'muted'}
            size={40}
            decorative
          />
        </button>
        <textarea
          ref={fieldRef}
          className="va-composer__field"
          rows={1}
          value={draft}
          readOnly={sending}
          aria-invalid={failed || undefined}
          placeholder={reason ?? `Message ${name}`}
          aria-label={`Message ${name}`}
          onChange={(event) => {
            onDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
        />
        <IconButton
          label={
            sending
              ? 'Sending'
              : !canSend
                ? (reason ?? 'Send')
                : empty
                  ? 'Type a message first'
                  : 'Send'
          }
          icon="send"
          kind={canSend && !empty && !sending ? 'primary' : 'secondary'}
          shape="round"
          size="large"
          className={sending ? 'va-composer__send va-composer__send--sending' : 'va-composer__send'}
          disabled={!canSend || empty}
          reason={!canSend ? reason : empty ? 'Type a message first' : undefined}
          onClick={send}
        />
        {sending && <LensLoader className="va-composer__loader" />}
      </div>
    </div>
  );
}
