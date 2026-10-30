import { createContext, useContext, useEffect, useEffectEvent } from 'react';

export class EscapeStack {
  private readonly layers: (() => void)[] = [];

  /** Adds a layer; the returned function takes it away again. */
  push(close: () => void): () => void {
    this.layers.push(close);
    return () => {
      const at = this.layers.lastIndexOf(close);
      if (at >= 0) this.layers.splice(at, 1);
    };
  }

  /** Closes the newest layer. False when none is open. */
  closeTop(): boolean {
    const close = this.layers.at(-1);
    if (!close) return false;
    close();
    return true;
  }
}

export const EscapeContext = createContext<EscapeStack | null>(null);

/** While `open`, Esc in the surface around closes this layer first, with `close`. */
export function useEscapeLayer(open: boolean, close: () => void): void {
  const stack = useContext(EscapeContext);
  const onClose = useEffectEvent(close);
  useEffect(() => {
    if (!open || !stack) return;
    return stack.push(() => {
      onClose();
    });
  }, [open, stack]);
}
