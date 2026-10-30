import { Dialog } from '../kit/dialog/Dialog';
import type { DisplayKind } from '../vision/media';
import { shareCardCopy, shareCardLines } from '../vision/shareCard';

interface ShareCardDialogProps {
  name: string;
  kind: DisplayKind;
  /** Opens the browser's picker: called straight from the Continue press. */
  onContinue: () => void;
  onCancel: () => void;
}

export function ShareCardDialog({ name, kind, onContinue, onCancel }: ShareCardDialogProps) {
  return (
    <Dialog
      className="va-share-card"
      title={shareCardCopy.title}
      body={shareCardLines(name, kind)}
      confirm={shareCardCopy.continue}
      cancel={shareCardCopy.cancel}
      onConfirm={onContinue}
      onCancel={onCancel}
    >
      <ol className="va-share-card__steps">
        {shareCardCopy.steps.map((step, i) => (
          <li key={step} className="va-share-card__step">
            <span className="va-share-card__number" aria-hidden="true">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
    </Dialog>
  );
}
