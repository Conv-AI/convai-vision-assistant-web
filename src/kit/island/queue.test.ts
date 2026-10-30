import { beforeEach, describe, expect, it } from 'vitest';
import {
  bindLastWords,
  bindWords,
  formOf,
  problem,
  request,
  status,
  undo,
  type Notification,
  type NotificationAction,
} from './notification';
import { NotificationQueue } from './queue';

let now = 100;
let queue: NotificationQueue;
let changes = 0;

function advance(seconds: number) {
  // In steps, as frames would: a rule that needs two ticks gets them.
  const steps = Math.ceil(seconds / 0.1);
  for (let i = 0; i < steps; i++) {
    now += seconds / steps;
    queue.tick();
  }
}

const act = (label = 'Do', run = () => undefined, closes = true): NotificationAction => ({
  label,
  run,
  closes,
});
const s = (key: string, seconds = 2) => status(key, key, seconds);
const p = (key: string, dotAfter?: number) => problem(key, key, { dotAfter });
const r = (key: string) => request(key, key, 'Do this.', act('Try again'));
const u = (key: string, run = () => undefined) => undo(key, key, act('Undo', run));
const keys = (list: Notification[]) => list.map((n) => n.key);

beforeEach(() => {
  now = 100;
  queue = new NotificationQueue(() => now);
  changes = 0;
  queue.subscribe(() => {
    changes++;
  });
});

describe('levels and forms', () => {
  it('lets the level decide the form', () => {
    expect(formOf(s('s'))).toBe('toast');
    expect(formOf(u('u'))).toBe('toast-action');
    expect(formOf(p('p'))).toBe('toast');
    expect(formOf(problem('p', 'Offline', { action: act('Try again', undefined, false) }))).toBe(
      'toast-action',
    );
    expect(formOf(r('r'))).toBe('banner');
    expect(formOf(request('r', 't', 'b', act('Try again'), act('Type instead')))).toBe(
      'banner-two-actions',
    );
  });

  it('never keeps a Status over 4 s or under 1.5 s, unless it stays until closed', () => {
    expect(status('long', 'x', 60).seconds).toBe(4);
    expect(status('four', 'x', 4).seconds).toBe(4);
    expect(status('short', 'x', 0.2).seconds).toBe(1.5);
    expect(status('until', 'x', Infinity).seconds).toBe(Infinity);
  });
});

describe('the queue', () => {
  it('shows a Status for its time, then the next one', () => {
    queue.post(s('a'));
    queue.post(s('b'));
    expect(queue.current?.key).toBe('a');
    expect(queue.waiting).toHaveLength(1);
    advance(1.9);
    expect(queue.current?.key).toBe('a');
    advance(0.2);
    expect(queue.current?.key).toBe('b');
    advance(2.1);
    expect(queue.current).toBeNull();
  });

  it('drops the same key within 10 s', () => {
    queue.post(s('copied', 1.5));
    advance(1.6);
    expect(queue.current).toBeNull();
    queue.post(s('copied', 1.5));
    expect(queue.current).toBeNull();
    advance(8.5);
    queue.post(s('copied', 1.5));
    expect(queue.current).not.toBeNull();
  });

  it('updates a Request with the same key in place', () => {
    queue.post(request('mic', 'The microphone is blocked', 'Allow it.', act('Allow')));
    queue.post(request('mic', 'The microphone is blocked', 'Allow it in Settings.', act('Allow')));
    expect(queue.current?.body).toBe('Allow it in Settings.');
    expect(queue.waiting.length + queue.dotted.length).toBe(0);
  });

  it('updates a Problem with the same key in place', () => {
    queue.post(problem('offline', 'Offline', { detail: ' · reconnecting' }));
    advance(0.5);
    const before = changes;
    queue.post(problem('offline', 'Offline', { detail: ' · retrying in 8 s' }));
    expect(queue.current?.detail).toBe(' · retrying in 8 s');
    expect(changes).toBe(before + 1);
    expect(queue.waiting.length + queue.dotted.length).toBe(0);
  });

  it('morphs a higher level over what shows at once; a Status waits again', () => {
    queue.post(s('s', 4));
    advance(0.3);
    queue.post(r('r'));
    expect(queue.current?.key).toBe('r');
    expect(queue.waiting).toHaveLength(1);
  });

  it('drops an Undo that is outranked', () => {
    queue.post(u('cleared'));
    queue.post(p('offline'));
    expect(queue.current?.key).toBe('offline');
    expect(queue.contains('cleared')).toBe(false);
  });

  it('makes an outranked Request the dot, and brings it back', () => {
    queue.post(r('mic'));
    queue.post(p('offline'));
    expect(queue.current?.key).toBe('offline');
    expect(queue.dotTop?.key).toBe('mic');
    advance(2);
    queue.close('offline');
    expect(queue.current?.key).toBe('mic');
    expect(queue.dotted).toHaveLength(0);
  });

  it('queues the same or a lower level by level, then arrival', () => {
    queue.post(r('r1'));
    queue.post(s('s1'));
    queue.post(u('u1'));
    queue.post(s('s2'));
    queue.post(r('r2'));
    expect(queue.current?.key).toBe('r1');
    const order: string[] = [];
    queue.subscribe(() => {
      const key = queue.current?.key;
      if (key && order.at(-1) !== key) order.push(key);
    });
    queue.invoke(queue.current?.primary);
    queue.invoke(queue.current?.primary);
    advance(6.1);
    advance(2.1);
    advance(2.1);
    expect(order).toEqual(['r2', 'u1', 's1', 's2']);
  });

  it('holds five; beyond that the oldest Status goes', () => {
    queue.post(r('showing'));
    for (let i = 1; i <= 5; i++) queue.post(s(`s${String(i)}`));
    expect(queue.waiting).toHaveLength(5);
    queue.post(u('u'));
    expect(queue.waiting).toHaveLength(5);
    expect(queue.contains('s1')).toBe(false);
    expect(queue.contains('u')).toBe(true);
    expect(queue.contains('s5')).toBe(true);
  });

  it('lets lower items play while a Problem stays, which comes back after', () => {
    queue.post(p('offline'));
    advance(2);
    queue.post(s('copied', 1.5));
    expect(queue.current?.key).toBe('offline');
    advance(0.1);
    expect(queue.current?.key).toBe('copied');
    expect(queue.dotTop?.key).toBe('offline');
    advance(1.6);
    expect(queue.current?.key).toBe('offline');
    expect(queue.dotted).toHaveLength(0);
  });

  it('shows everything for at least 1.2 s before it steps aside', () => {
    queue.post(p('offline'));
    queue.post(s('copied', 1.5));
    advance(1.0);
    expect(queue.current?.key).toBe('offline');
    advance(0.3);
    expect(queue.current?.key).toBe('copied');
  });

  it('shows the newer of two Problems and puts the other on the dot', () => {
    queue.post(p('offline'));
    queue.post(p('mic-busy'));
    expect(queue.current?.key).toBe('mic-busy');
    expect(keys(queue.dotted)).toEqual(['offline']);
    advance(2);
    queue.close('mic-busy');
    expect(queue.current?.key).toBe('offline');
  });

  it('keeps a Problem the user put away on the dot until resolved or expanded', () => {
    queue.post(p('offline'));
    advance(2);
    queue.putAway();
    expect(queue.current).toBeNull();
    expect(queue.dotTop?.key).toBe('offline');
    advance(30);
    expect(queue.current).toBeNull();
    queue.expand();
    expect(queue.current?.key).toBe('offline');
    queue.putAway();
    queue.close('offline');
    expect(queue.dotted).toHaveLength(0);
  });

  it('just ends a toast that is put away', () => {
    queue.post(s('copied'));
    queue.putAway();
    expect(queue.current).toBeNull();
    expect(queue.dotted).toHaveLength(0);
  });

  it('shows a weak connection for 3 s, then keeps it on the dot', () => {
    queue.post(p('weak', 3));
    advance(2.9);
    expect(queue.current?.key).toBe('weak');
    advance(0.2);
    expect(queue.current).toBeNull();
    expect(queue.dotTop?.key).toBe('weak');
    advance(20);
    expect(queue.current).toBeNull();
  });

  it('waits for the minimum time when closed sooner: no flash', () => {
    queue.post(status('connecting', 'Connecting to Kira…', Infinity));
    advance(0.4);
    queue.close('connecting');
    expect(queue.current).not.toBeNull();
    advance(0.9);
    expect(queue.current).toBeNull();
  });

  it('closes at once what the person’s own action closed, minimum time or not (14b Q10d)', () => {
    queue.post(s('now-sharing', 2));
    advance(0.2);
    queue.close('now-sharing', true);
    expect(queue.current).toBeNull();
  });

  it('stops a toast’s time while it is pointed at', () => {
    queue.post(s('copied', 1.5));
    advance(1);
    queue.isPaused = true;
    advance(5);
    expect(queue.current).not.toBeNull();
    queue.isPaused = false;
    advance(0.6);
    expect(queue.current).toBeNull();
  });

  it('runs the Undo from the keyboard while the Undo toast shows', () => {
    let undone = 0;
    expect(queue.invokeUndo()).toBe(false);
    queue.post(
      u('cleared', () => {
        undone++;
      }),
    );
    expect(queue.invokeUndo()).toBe(true);
    expect(undone).toBe(1);
    expect(queue.current).toBeNull();
  });

  it('shows an Undo for 6 s', () => {
    queue.post(u('cleared'));
    advance(5.9);
    expect(queue.current).not.toBeNull();
    advance(0.2);
    expect(queue.current).toBeNull();
  });

  it('leaves a notification showing after an action that keeps it', () => {
    let retries = 0;
    queue.post(
      problem('offline', 'Offline', {
        action: act(
          'Try again',
          () => {
            retries++;
          },
          false,
        ),
      }),
    );
    queue.invoke(queue.current?.primary);
    expect(retries).toBe(1);
    expect(queue.current?.key).toBe('offline');
  });
});

describe('version', () => {
  it('counts each change to what the Island shows, and nothing else', () => {
    const start = queue.version;
    queue.post(status('saved', 'Saved', 2));
    expect(queue.version).toBe(start + 1);
    queue.tick();
    expect(queue.version).toBe(start + 1);
    const lift = queue.hold(() => false);
    expect(queue.version).toBe(start + 2);
    lift();
    expect(queue.version).toBe(start + 3);
  });
});

describe('holds (K11, K38)', () => {
  const needsTheUser = (n: Notification) => n.level === 'problem' || n.level === 'request';

  it('keeps a toast posted under a hold waiting, its time stopped, and shows it whole once lifted', () => {
    const lift = queue.hold(needsTheUser);
    queue.post(status('saved', 'Saved', 2));
    expect(queue.current).toBeNull();
    expect(queue.waiting).toHaveLength(1);
    advance(9.8);
    expect(keys(queue.waiting)).toEqual(['saved']);
    lift();
    expect(queue.current?.key).toBe('saved');
    advance(1.9);
    expect(queue.current?.key).toBe('saved');
    advance(0.2);
    expect(queue.current).toBeNull();
  });

  it('drops a Status a hold has kept back for 10 s; one only outranked still waits', () => {
    const lift = queue.hold((n) => n.level !== 'status');
    queue.post(status('saved', 'Saved', 2));
    advance(9.8);
    expect(keys(queue.waiting)).toEqual(['saved']);
    advance(0.3);
    expect(queue.waiting).toEqual([]);
    lift();
    expect(queue.current).toBeNull();

    // Outranked, not held: it waits for its turn however long that is.
    queue.post(r('camera'));
    queue.post(status('later', 'Later', 2));
    advance(20);
    queue.invoke(queue.current?.primary);
    expect(queue.current?.key).toBe('later');
  });

  it('starts a held Status’s 10 s again once the hold has let it pass', () => {
    // A Request shows and never steps aside, so the Status waits outranked between the holds.
    queue.post(r('camera'));
    let lift = queue.hold(needsTheUser);
    queue.post(status('saved', 'Saved', 2));
    advance(6);
    lift();
    advance(6);
    lift = queue.hold(needsTheUser);
    advance(6);
    expect(keys(queue.waiting)).toEqual(['saved']);
    lift();
  });

  it('puts what shows back in its place when a hold begins, and drops an Undo', () => {
    queue.post(status('first', 'First', 4));
    queue.post(status('second', 'Second', 4));
    let lift = queue.hold(needsTheUser);
    expect(queue.current).toBeNull();
    expect(keys(queue.waiting)).toEqual(['first', 'second']);
    lift();
    advance(8.5);
    queue.post(u('cleared'));
    lift = queue.hold(needsTheUser);
    expect(queue.current).toBeNull();
    expect(queue.waiting).toHaveLength(0);
    lift();
    expect(queue.current).toBeNull();
  });

  it('shows a Request under a hold at once, and what waits after it', () => {
    const lift = queue.hold(needsTheUser);
    queue.post(status('saved', 'Saved', 2));
    queue.post(r('camera'));
    expect(queue.current?.key).toBe('camera');
    lift();
    expect(queue.current?.key).toBe('camera');
    queue.invoke(queue.current?.primary);
    expect(queue.current?.key).toBe('saved');
  });

  it('morphs a held notification that outranks what shows over it once lifted', () => {
    const lift = queue.hold((n) => n.level === 'status');
    queue.post(status('saved', 'Saved', 4));
    queue.post(p('offline'));
    expect(queue.current?.key).toBe('saved');
    lift();
    expect(queue.current?.key).toBe('offline');
    expect(keys(queue.waiting)).toEqual(['saved']);
  });

  it('shows only what passes every hold, and lifting twice changes nothing', () => {
    const one = queue.hold(needsTheUser);
    const two = queue.hold((n) => n.level === 'problem');
    queue.post(r('camera'));
    expect(queue.current).toBeNull();
    one();
    one();
    expect(queue.current).toBeNull();
    queue.post(p('offline'));
    expect(queue.current?.key).toBe('offline');
    two();
    queue.close('offline');
    advance(1.3);
    expect(queue.current?.key).toBe('camera');
  });

  it('tells the view nothing while only held notifications wait', () => {
    queue.hold(needsTheUser);
    queue.post(status('saved', 'Saved', 2));
    const before = changes;
    advance(5);
    expect(changes).toBe(before);
  });

  it('keeps a Problem under a hold from stepping aside for held notifications', () => {
    queue.hold(needsTheUser);
    queue.post(p('offline'));
    queue.post(status('saved', 'Saved', 2));
    const before = changes;
    advance(5);
    expect(queue.current?.key).toBe('offline');
    expect(queue.dotted).toHaveLength(0);
    expect(changes).toBe(before);
  });

  it('does not expand the dot into a notification a hold keeps', () => {
    queue.post(r('camera'));
    queue.putAway();
    expect(queue.dotted).toHaveLength(1);
    const lift = queue.hold((n) => n.level === 'problem');
    queue.expand();
    expect(queue.current).toBeNull();
    expect(queue.dotted).toHaveLength(1);
    lift();
    queue.expand();
    expect(queue.current?.key).toBe('camera');
  });

  it('drops an Undo posted under a hold that refuses it', () => {
    const lift = queue.hold(() => false);
    queue.post(u('cleared'));
    expect(queue.current).toBeNull();
    expect(queue.waiting).toHaveLength(0);
    lift();
    expect(queue.current).toBeNull();
  });
});

describe('room (K12, K22)', () => {
  it('replaces a waiting notification with a newer one of the same key, in its place', () => {
    queue.post(status('first', 'First', 4));
    queue.post(status('copied', 'Copied 1 item', 2));
    queue.post(status('later', 'Later', 2));
    queue.post(status('copied', 'Copied 2 items', 3));
    expect(queue.waiting.map((n) => n.title)).toEqual(['Copied 2 items', 'Later']);
    expect(queue.waiting[0]?.seconds).toBe(3);
    queue.post(status('first', 'First again', 4));
    expect(queue.current?.title).toBe('First');
  });

  it('never drops a Problem or a Request for room', () => {
    const lift = queue.hold(() => false);
    for (let i = 0; i < 6; i++) queue.post(p(`p${String(i)}`));
    expect(queue.waiting).toHaveLength(6);
    lift();
  });

  it('beyond five drops the oldest Status, then the oldest Undo', () => {
    queue.hold((n) => n.level === 'undo');
    for (let i = 0; i < 4; i++) queue.post(p(`p${String(i)}`));
    queue.post(status('s0', 'Older', 4));
    queue.post(status('s1', 'Newer', 4));
    expect(keys(queue.waiting)).toEqual(['p0', 'p1', 'p2', 'p3', 's1']);
  });
});

describe('the two-word rule', () => {
  it('binds the last two words, so a line never ends with one alone', () => {
    const bound = bindLastWords('Kira reconnects on its own.');
    expect(bound).toBe(`Kira reconnects on its${String.fromCharCode(160)}own.`);
    expect(bindLastWords('Copied')).toBe('Copied');
  });

  it('binds a banner’s articles to their next word, and its last two words from three on', () => {
    const nb = String.fromCharCode(160);
    expect(bindWords('Kira reconnects when the service is back.')).toBe(
      `Kira reconnects when the${nb}service is${nb}back.`,
    );
    expect(bindWords('The camera is in use')).toBe(`The${nb}camera is in${nb}use`);
    expect(bindWords('An app or a tab')).toBe(`An${nb}app or${nb}a${nb}tab`);
    expect(bindWords('Theme ant')).toBe('Theme ant');
    expect(bindWords('Copied')).toBe('Copied');
  });
});
