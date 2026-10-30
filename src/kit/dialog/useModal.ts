import { useEffect, useLayoutEffect, type RefObject } from 'react';

/**
 * Shows a `<dialog>` as the kit's modal: the page behind it takes no focus or press, a press on the
 * scrim outside the box is the safe way out, and the browser's own Esc is kept from closing it, so
 * the window's key layers decide what Esc does. Closed again when the component goes.
 */
export function useModal(box: RefObject<HTMLDialogElement | null>, onCancel: () => void): void {
  useLayoutEffect(() => {
    const dialog = box.current;
    // A browser without a modal dialog (and jsdom) still shows it, without the inert page.
    if (dialog && typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    else dialog?.setAttribute('open', '');
    return () => {
      if (!dialog?.open) return;
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
  }, [box]);

  useEffect(() => {
    const dialog = box.current;
    if (!dialog) return;
    // A press outside the box lands on the dialog element itself, over its scrim: Cancel.
    const onPress = (event: PointerEvent) => {
      if (event.target !== dialog) return;
      const edge = dialog.getBoundingClientRect();
      const inside =
        event.clientX >= edge.left &&
        event.clientX <= edge.right &&
        event.clientY >= edge.top &&
        event.clientY <= edge.bottom;
      if (!inside) onCancel();
    };
    const onNativeCancel = (event: Event) => {
      event.preventDefault();
    };
    dialog.addEventListener('pointerdown', onPress);
    dialog.addEventListener('cancel', onNativeCancel);
    return () => {
      dialog.removeEventListener('pointerdown', onPress);
      dialog.removeEventListener('cancel', onNativeCancel);
    };
  }, [box, onCancel]);
}
