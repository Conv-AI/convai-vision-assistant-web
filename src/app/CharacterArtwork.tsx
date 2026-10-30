import { useState } from 'react';
import type { Character } from '../credentials/characters';

interface Props {
  character: Character;
  initial: string;
  /** The selected preview loads immediately; gallery art can wait until it approaches the viewport. */
  preview?: boolean;
}

/** Independent background and foreground layers; a failed layer never hides the other one. */
export function CharacterArtwork({ character, initial, preview = false }: Props) {
  const sources = [
    ...new Set(
      (preview
        ? [character.portraitFull, character.portrait]
        : [character.portrait, character.portraitFull]
      ).filter((src): src is string => Boolean(src)),
    ),
  ];
  return (
    <span className="va-artwork" aria-hidden="true">
      {character.background && (
        <ArtworkImage
          key={character.background}
          sources={[character.background]}
          background
          preview={preview}
        />
      )}
      <ArtworkImage
        key={JSON.stringify(sources)}
        sources={sources}
        full={character.portraitFull}
        preview={preview}
        initial={initial}
      />
    </span>
  );
}

function ArtworkImage({
  sources,
  background,
  full,
  preview,
  initial,
}: {
  sources: string[];
  background?: boolean;
  full?: string;
  preview: boolean;
  initial?: string;
}) {
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<string | null>(null);
  const src = sources[index];
  if (!src) return background ? null : <span className="va-artwork__initial">{initial}</span>;
  return (
    <>
      {!background && loaded !== src && <span className="va-artwork__initial">{initial}</span>}
      <img
        key={src}
        className={background ? 'va-artwork__background' : 'va-artwork__foreground va-portrait'}
        data-full={(!background && src === full) || undefined}
        data-loaded={loaded === src || undefined}
        src={src}
        alt=""
        loading={preview ? 'eager' : 'lazy'}
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onLoad={() => {
          setLoaded(src);
        }}
        onError={() => {
          setIndex((current) => current + 1);
        }}
      />
    </>
  );
}
