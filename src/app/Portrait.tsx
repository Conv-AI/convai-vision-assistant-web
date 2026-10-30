import { useState, type ReactNode } from 'react';

interface PortraitProps {
  /** The picture's https address, or null when the character has none. */
  src: string | null;

  children: ReactNode;
}

export function Portrait({ src, children }: PortraitProps) {
  const [failed, setFailed] = useState<string | null>(null);
  if (src === null || failed === src) return children;
  return (
    <img
      className="va-portrait"
      src={src}
      alt=""
      decoding="async"
      draggable={false}
      onError={() => {
        setFailed(src);
      }}
    />
  );
}
