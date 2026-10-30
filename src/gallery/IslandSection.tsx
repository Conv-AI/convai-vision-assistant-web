import { useState } from 'react';
import { Button } from '../kit/controls/Button';
import { Island } from '../kit/island/Island';
import {
  problem,
  request,
  status,
  undo,
  type Notification,
  type NotificationAction,
} from '../kit/island/notification';
import { NotificationQueue } from '../kit/island/queue';

const noop: NotificationAction = { label: '', run: () => undefined };
const act = (label: string, closes = true): NotificationAction => ({ ...noop, label, closes });

/** One notification on a queue whose clock stands still, so the form stays to be looked at. */
function still(...posts: Notification[]): NotificationQueue {
  const queue = new NotificationQueue(() => 0);
  for (const n of posts) queue.post(n);
  return queue;
}

function dotted(...posts: Notification[]): NotificationQueue {
  const queue = still(...posts);
  queue.putAway();
  return queue;
}

const forms: { id: string; name: string; queue: () => NotificationQueue; width?: number }[] = [
  { id: 'N1a', name: 'Toast', queue: () => still(status('mode', 'Push to talk is on', Infinity)) },
  {
    id: 'N1a',
    name: 'Toast with a glyph',
    queue: () => still({ ...status('copied', 'Copied', Infinity), icon: 'copy' }),
  },
  {
    id: 'N1b',
    name: 'Undo toast',
    queue: () =>
      still({ ...undo('cleared', 'Conversation cleared', act('Undo')), seconds: Infinity }),
  },
  {
    id: 'N1c',
    name: 'Persistent problem',
    queue: () =>
      still({
        ...problem('offline', 'Offline', {
          detail: ' · reconnecting',
          action: act('Try again', false),
        }),
        working: true,
      }),
  },
  {
    id: 'N1c',
    name: 'Weak connection',
    queue: () => still({ ...problem('weak', 'Weak connection'), mark: 'warn' }),
  },
  {
    id: 'N1d',
    name: 'Minimized dot',
    queue: () => dotted({ ...problem('offline', 'Offline'), icon: 'offline' }),
  },
  {
    id: 'N1e',
    name: 'Banner · one action',
    queue: () =>
      still(
        request(
          'unavailable',
          'Kira is unavailable right now',
          'You can keep working. Kira reconnects when the service is back.',
          act('Try again'),
        ),
      ),
  },
  {
    id: 'N1f',
    name: 'Banner · two actions',
    queue: () =>
      still(
        request(
          'mic-busy',
          'Another app is using the microphone',
          'Close it to talk, or type to Kira for now.',
          act('Try again'),
          act('Type instead'),
        ),
      ),
  },
  {
    id: 'N-FIT1',
    name: 'Narrow · close given way',
    width: 202,
    queue: () => still(status('hands-free', 'Hands free is on', Infinity)),
  },
  {
    id: 'N-FIT3',
    name: 'Narrow · two lines',
    width: 340,
    queue: () =>
      still({
        ...problem('offline', 'Offline. Kira reconnects on its own when the network is back.'),
        brief: 'Offline. Kira reconnects on its own.',
      }),
  },
];

const catalog: (() => Notification)[] = [
  () => status('copied', 'Copied', 1.5),
  () => status('mode', 'Hands free is on', 2),
  () => undo('cleared', 'Conversation cleared', act('Undo')),
  () => ({
    ...problem('offline', 'Offline', {
      detail: ' · reconnecting',
      action: act('Try again', false),
    }),
    working: true,
  }),
  () =>
    request(
      'mic',
      'The microphone is blocked',
      'Allow it in your browser’s site settings, or type to Kira.',
      act('How to allow'),
      act('Type instead'),
    ),
];

export function IslandSection() {
  const [queues] = useState(() => forms.map((f) => f.queue()));
  const [live] = useState(() => new NotificationQueue(() => performance.now() / 1000));
  return (
    <section className="gallery__section" aria-labelledby="island" data-capture="island">
      <h2 id="island" className="convai-text--heading">
        Island
      </h2>
      <div className="gallery__islands">
        {forms.map((form, i) => (
          <figure key={`${form.id}-${form.name}`} className="gallery__island-cell">
            <figcaption className="gallery__capsule-caption">
              <span className="convai-text--meta">{form.id}</span>
              <span className="convai-text--control">{form.name}</span>
            </figcaption>
            <div
              className="gallery__island-place"
              style={form.width ? { width: form.width } : undefined}
            >
              {queues[i] && <Island queue={queues[i]} keys={false} />}
            </div>
          </figure>
        ))}
      </div>
      <div className="gallery__table gallery__strip" role="group" aria-label="Try the Island">
        <div className="gallery__island-live">
          <Island queue={live} />
        </div>
        {['Status', 'Another status', 'Undo', 'Problem', 'Request'].map((name, i) => (
          <Button
            key={name}
            size="small"
            onClick={() => {
              const make = catalog[i];
              if (make) live.post(make());
            }}
          >
            {name}
          </Button>
        ))}
        <Button
          size="small"
          kind="text"
          onClick={() => {
            live.close('offline');
          }}
        >
          Back online
        </Button>
      </div>
    </section>
  );
}
