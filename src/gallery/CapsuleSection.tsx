import { useState } from 'react';
import { Capsule } from '../kit/capsule/Capsule';
import type { CapsuleState, TalkMode } from '../kit/capsule/capsuleCopy';
import { scriptedSpeech } from '../kit/lens/voice';

const rows: { id: string; name: string; state: CapsuleState; mode: TalkMode }[] = [
  { id: 'K1a', name: 'Ready', state: 'ready', mode: 'push-to-talk' },
  { id: 'K1b', name: 'Ready', state: 'ready', mode: 'hands-free' },
  { id: 'K1c', name: 'Listening', state: 'listening', mode: 'hands-free' },
  { id: 'K1d', name: 'Push to talk held', state: 'held', mode: 'push-to-talk' },
  { id: 'K1e', name: 'Thinking', state: 'thinking', mode: 'hands-free' },
  { id: 'K1f', name: 'Speaking', state: 'speaking', mode: 'push-to-talk' },
  { id: 'K1g', name: 'Muted', state: 'muted', mode: 'hands-free' },
  { id: 'K1h', name: 'Connecting', state: 'connecting', mode: 'hands-free' },
  { id: 'K1i', name: 'Offline', state: 'offline', mode: 'hands-free' },
  { id: 'K1j', name: 'Service unavailable', state: 'unavailable', mode: 'push-to-talk' },
];

const modeName: Record<TalkMode, string> = {
  'push-to-talk': 'Push to talk',
  'hands-free': 'Hands free',
};

const noop = () => undefined;

export function CapsuleSection() {
  const [voice] = useState(() => scriptedSpeech());
  return (
    <section className="gallery__section" aria-labelledby="capsule" data-capture="capsule">
      <h2 id="capsule" className="convai-text--heading">
        Capsule
      </h2>
      <div className="gallery__capsules">
        {rows.map((row) => (
          <figure key={row.id} className="gallery__capsule-cell" data-capsule={row.id}>
            <figcaption className="gallery__capsule-caption">
              <span className="convai-text--meta">{row.id}</span>
              <span className="convai-text--control">{row.name}</span>
              <span className="gallery__capsule-mode convai-text--meta">{modeName[row.mode]}</span>
            </figcaption>
            <Capsule
              name="Kira"
              state={row.state}
              mode={row.mode}
              level={voice}
              onLens={noop}
              onType={noop}
              onTranscript={noop}
              onMore={noop}
              onAction={noop}
            />
          </figure>
        ))}
      </div>
    </section>
  );
}
