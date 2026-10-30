import { useState } from 'react';
import { Lens, LensLoader, type LensSize } from '../kit/lens/Lens';
import type { LensState } from '../kit/lens/lensLabel';
import { scriptedSpeech, type LevelSource } from '../kit/lens/voice';

const states: { state: LensState; id: string; name: string }[] = [
  { state: 'ready', id: 'L1a', name: 'Ready' },
  { state: 'listening', id: 'L1b', name: 'Listening' },
  { state: 'held', id: 'L1c', name: 'Push to talk held' },
  { state: 'thinking', id: 'L1d', name: 'Thinking' },
  { state: 'speaking', id: 'L1e', name: 'Speaking' },
  { state: 'muted', id: 'L1f', name: 'Muted' },
  { state: 'connecting', id: 'L1g', name: 'Connecting' },
  { state: 'offline', id: 'L1h', name: 'Offline' },
];

const sizes: { size: LensSize; use: string }[] = [
  { size: 96, use: 'Overlays, onboarding' },
  { size: 64, use: 'Full-screen conversation' },
  { size: 48, use: 'Side panel header' },
  { size: 44, use: 'Talk capsule' },
  { size: 32, use: 'Transcript, Island, composer' },
];

export function LensSection() {
  const [voice] = useState((): LevelSource => {
    const steady = Number(new URLSearchParams(window.location.search).get('lensVoice'));
    return Number.isFinite(steady) && steady > 0
      ? { sample: () => ({ level: Math.min(1, steady), onset: false }) }
      : scriptedSpeech();
  });
  const [sizeState, setSizeState] = useState<LensState>('speaking');

  return (
    <section className="gallery__section" aria-labelledby="lens" data-capture="lens">
      <h2 id="lens" className="convai-text--heading">
        Lens
      </h2>
      <div className="gallery__table gallery__lens-grid">
        {states.map(({ state, id, name }) => (
          <figure key={state} className="gallery__lens-cell">
            <span className="gallery__lens-tile">
              <Lens name="Kira" state={state} size={64} level={voice} />
            </span>
            <figcaption className="gallery__lens-caption">
              <span className="convai-text--micro convai-tone--tertiary">{id}</span>
              <span className="convai-text--control">{name}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="gallery__table gallery__lens-sizes" role="group" aria-label="Sizes">
        <label className="convai-text--meta gallery__lens-pick">
          State at every size
          <select
            value={sizeState}
            onChange={(e) => {
              setSizeState(e.target.value as LensState);
            }}
          >
            {states.map(({ state, name }) => (
              <option key={state} value={state}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {sizes.map(({ size, use }) => (
          <figure key={size} className="gallery__lens-cell">
            <Lens name="Kira" state={sizeState} size={size} level={voice} />
            <figcaption className="gallery__lens-caption">
              <span className="convai-text--control">{size}</span>
              <span className="convai-text--meta">{use}</span>
            </figcaption>
          </figure>
        ))}
        <figure className="gallery__lens-cell">
          <LensLoader />
          <figcaption className="gallery__lens-caption">
            <span className="convai-text--control">24</span>
            <span className="convai-text--meta">Loader only</span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
