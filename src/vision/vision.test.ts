import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notification } from '../kit/island/notification';
import { FakeTransport, flush } from '../session/test/fakeTransport';
import { cameraLabel, cameraName, camerasOf, cameraProblem } from './camera';
import { visionKeys } from './notices';
import { FakeMedia } from './test/fakeMedia';
import { Vision, visionTiming, type Conversation } from './vision';

class FakeConversation implements Conversation {
  answering = false;
  private readonly listeners = new Set<() => void>();
  isAnswering(): boolean {
    return this.answering;
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  set(answering: boolean): void {
    this.answering = answering;
    for (const listener of [...this.listeners]) listener();
  }
}

function setup() {
  const transport = new FakeTransport();
  const media = new FakeMedia();
  const conversation = new FakeConversation();
  const posted: Notification[] = [];
  const closed: string[] = [];
  const closedNow: string[] = [];
  const vision = new Vision({
    transport,
    media,
    conversation,
    notices: {
      post: (n) => posted.push(n),
      close: (key, now) => {
        closed.push(key);
        if (now) closedNow.push(key);
      },
    },
    name: () => 'Kira',
  });
  vision.start();
  const intents: string[] = [];
  vision.onIntent((intent) => intents.push(intent));
  return { vision, transport, media, conversation, posted, closed, closedNow, intents };
}

/** The pictures handed to the transport, by track label; null is "see nothing". */
const handed = (transport: FakeTransport) => transport.visions.map((v) => v?.track.label ?? null);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the camera’s pure parts', () => {
  it('names a camera without the ids Chrome adds', () => {
    expect(cameraName('Integrated Camera (04f2:b6dd)')).toBe('Integrated Camera');
    expect(cameraName('HD Pro Webcam C920 (046D:082D)')).toBe('HD Pro Webcam C920');
    expect(cameraName('FaceTime HD Camera')).toBe('FaceTime HD Camera');
    expect(cameraName('Studio (Left)')).toBe('Studio (Left)');
  });

  it('calls an unnamed camera "Camera", numbered when there are several', () => {
    expect(cameraLabel({ id: '', label: '' }, 0, 1)).toBe('Camera');
    expect(cameraLabel({ id: 'a', label: '' }, 1, 2)).toBe('Camera 2');
    expect(cameraLabel({ id: 'a', label: 'Logitech C920 (046d:082d)' }, 1, 2)).toBe(
      'Logitech C920',
    );
  });

  it('lists each camera once, and nothing else', () => {
    const devices = [
      { kind: 'audioinput', deviceId: 'm', label: 'Mic' },
      { kind: 'videoinput', deviceId: 'a', label: 'A' },
      { kind: 'videoinput', deviceId: 'a', label: 'A' },
      { kind: 'videoinput', deviceId: 'b', label: '' },
    ] as MediaDeviceInfo[];
    expect(camerasOf(devices)).toEqual([
      { id: 'a', label: 'A' },
      { id: 'b', label: '' },
    ]);
  });

  it.each([
    ['NotAllowedError', 'denied', 'blocked'],
    ['NotAllowedError', 'prompt', 'not-yet'],
    ['SecurityError', 'denied', 'blocked'],
    ['NotReadableError', 'granted', 'busy'],
    ['AbortError', 'granted', 'busy'],
    ['NotFoundError', 'granted', 'none'],
    ['OverconstrainedError', 'granted', 'none'],
    ['UnknownError', 'granted', 'busy'],
  ] as const)('reads %s with the permission %s as %s', (name, permission, problem) => {
    expect(cameraProblem(new DOMException('x', name), permission)).toBe(problem);
  });
});

describe('Vision', () => {
  it('shares nothing until a source is chosen, and never starts a camera to list them', async () => {
    const { vision, media, transport } = setup();
    await flush();

    expect(vision.state.share).toBe('none');
    expect(vision.state.cameras.map((c) => c.id)).toEqual(['cam-1', 'cam-2']);
    expect(media.starts).toHaveLength(0);
    expect(transport.visions).toEqual([]);
  });

  it('starts the chosen camera, and it is live only once the transport has the picture', async () => {
    const { vision, media, transport } = setup();
    let release: () => void = () => undefined;
    const setVision = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    transport.setVision = setVision;
    // The menu lists the cameras before anything is picked from it.
    await flush();

    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    expect(vision.state).toMatchObject({
      share: 'starting',
      source: { kind: 'camera', deviceId: 'cam-1', name: 'Integrated Camera' },
    });
    expect(media.starts.map((s) => s.deviceId)).toEqual(['cam-1']);

    const track = media.open();
    await flush();
    expect(setVision).toHaveBeenCalledWith({ track, kind: 'camera' });
    expect(vision.state.share).toBe('starting');
    expect(vision.state.stream?.getVideoTracks()[0]).toBe(track);

    release();
    await flush();
    expect(vision.state.share).toBe('live');
    expect(vision.seeing()).toBe('Camera');
  });

  it('shows the stage’s loader only after 300 ms, and Cancel after 8 s', async () => {
    const { vision, media } = setup();
    vision.choose({ kind: 'camera', deviceId: 'cam-1' });

    vi.advanceTimersByTime(visionTiming.startingShows - 1);
    expect(vision.state.showStarting).toBe(false);
    vi.advanceTimersByTime(1);
    expect(vision.state.showStarting).toBe(true);
    vi.advanceTimersByTime(visionTiming.startingSlow - visionTiming.startingShows - 1);
    expect(vision.state.slow).toBe(false);
    vi.advanceTimersByTime(1);
    expect(vision.state.slow).toBe(true);

    vision.cancel();
    expect(vision.state).toMatchObject({ share: 'none', slow: false, showStarting: false });
    // A camera that answers after Cancel is stopped at once and never handed over.
    const late = media.open();
    await flush();
    expect(late.readyState).toBe('ended');
    expect(vision.state.share).toBe('none');
  });

  it('stops the camera before it starts the next one: one at a time', async () => {
    const { vision, media, transport } = setup();
    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    const first = media.open();
    await flush();

    vision.choose({ kind: 'camera', deviceId: 'cam-2' });
    expect(first.readyState).toBe('ended');
    expect(handed(transport)).toEqual([first.label, null]);
    // The picture gives way to the loader at once, never to the invitation.
    expect(vision.state.showStarting).toBe(true);
    const second = media.open();
    await flush();

    expect(handed(transport)).toEqual([first.label, null, second.label]);
    expect(vision.state).toMatchObject({ share: 'live', source: { deviceId: 'cam-2' } });
    expect(media.tracks.filter((t) => t.readyState === 'live')).toEqual([second]);
  });

  it('lets a second choice made while the first starts win; the first’s late answer is stopped', async () => {
    const { vision, media, transport } = setup();
    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    vision.choose({ kind: 'camera', deviceId: 'cam-2' });

    const late = media.open();
    await flush();
    expect(late.readyState).toBe('ended');
    expect(transport.visions).toEqual([]);
    expect(vision.state.share).toBe('starting');

    const second = media.open();
    await flush();
    expect(handed(transport)).toEqual([second.label]);
    expect(vision.state.source?.deviceId).toBe('cam-2');
  });

  it('ignores choosing the camera already shared', async () => {
    const { vision, media } = setup();
    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    media.open();
    await flush();

    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    expect(media.starts).toHaveLength(0);
    expect(vision.state.share).toBe('live');
  });

  it('stops everything on Nothing: the transport sees nothing and the camera’s light goes off', async () => {
    const { vision, media, transport } = setup();
    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    const track = media.open();
    await flush();

    vision.choose({ kind: 'nothing' });
    expect(vision.state).toMatchObject({ share: 'none', source: null, stream: null });
    expect(vision.state.stopped).toBe(false);
    expect(transport.visions.at(-1)).toBeNull();
    expect(track.readyState).toBe('ended');
    expect(vision.seeing()).toBeNull();
  });

  it('waits for the reply to end before switching, but stops at once', async () => {
    const { vision, media, conversation } = setup();
    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    const first = media.open();
    await flush();

    conversation.set(true);
    vision.choose({ kind: 'camera', deviceId: 'cam-2' });
    expect(media.starts).toHaveLength(0);
    expect(vision.state.source?.deviceId).toBe('cam-1');

    conversation.set(false);
    expect(media.starts.map((s) => s.deviceId)).toEqual(['cam-2']);
    expect(first.readyState).toBe('ended');

    media.open();
    await flush();
    conversation.set(true);
    vision.choose({ kind: 'nothing' });
    expect(vision.state.share).toBe('none');
  });

  it('drops a waiting switch when Nothing is chosen before the reply ends', async () => {
    const { vision, media, conversation } = setup();
    conversation.set(true);
    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    vision.choose({ kind: 'nothing' });
    conversation.set(false);
    await flush();
    expect(media.starts).toHaveLength(0);
  });

  it('releases the camera on dispose', async () => {
    const { vision, media, transport } = setup();
    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    const track = media.open();
    await flush();

    vision.dispose();
    expect(track.readyState).toBe('ended');
    expect(transport.visions.at(-1)).toBeNull();
  });

  describe('a camera that does not start', () => {
    it('says it is blocked when the browser refuses this site, with the cause on the chip', async () => {
      const { vision, media, posted, transport } = setup();
      media.permission = 'denied';
      vision.choose({ kind: 'camera', deviceId: 'cam-1' });
      media.refuse('NotAllowedError');
      await flush();

      expect(vision.state).toMatchObject({
        share: 'none',
        failure: { problem: 'blocked', cause: 'Camera blocked' },
      });
      expect(transport.visions).toEqual([]);
      expect(posted.at(-1)).toMatchObject({
        key: visionKeys.camera,
        level: 'request',
        title: 'Your browser isn’t letting Convai use the camera',
        body: 'Allow the camera in this site’s settings, then try again. Or choose something else for Kira to see.',
        primary: { label: 'Try again' },
        secondary: { label: 'Choose another' },
      });
    });

    it('says "not allowed yet" when the prompt was closed, with no red', async () => {
      const { vision, media, posted } = setup();
      media.permission = 'prompt';
      vision.choose({ kind: 'camera', deviceId: null });
      media.refuse('NotAllowedError');
      await flush();

      expect(posted.at(-1)).toMatchObject({
        title: 'Camera not allowed yet',
        body: 'Kira can see once you allow the camera.',
      });
      expect(vision.state.failure?.problem).toBe('not-yet');
    });

    it('shows the try for at least 600 ms, then says "Still blocked"', async () => {
      const { vision, media, posted } = setup();
      media.permission = 'denied';
      vision.choose({ kind: 'camera', deviceId: 'cam-1' });
      media.refuse('NotAllowedError');
      await flush();

      posted.at(-1)?.primary?.run();
      expect(posted.at(-1)).toMatchObject({ working: true });
      expect(media.starts.map((s) => s.deviceId)).toEqual(['cam-1']);
      const before = posted.length;
      media.refuse('NotAllowedError');
      await flush();
      vi.advanceTimersByTime(visionTiming.retryLoader - 1);
      expect(posted).toHaveLength(before);
      vi.advanceTimersByTime(1);
      expect(posted.at(-1)).toMatchObject({
        body: 'Still blocked. Allow the camera in this site’s settings first.',
      });
      expect(posted.at(-1)?.working).toBeUndefined();
    });

    it('turns "not allowed yet" into "blocked" when Try again finds the browser refusing', async () => {
      const { vision, media, posted } = setup();
      media.permission = 'prompt';
      vision.choose({ kind: 'camera', deviceId: 'cam-1' });
      media.refuse('NotAllowedError');
      await flush();

      media.permission = 'denied';
      posted.at(-1)?.primary?.run();
      media.refuse('NotAllowedError');
      await flush();
      vi.advanceTimersByTime(visionTiming.retryLoader);
      expect(posted.at(-1)?.title).toBe('Your browser isn’t letting Convai use the camera');
    });

    it('asks to close the other app when the camera is in use, and says "Still in use" after', async () => {
      const { vision, media, posted } = setup();
      vision.choose({ kind: 'camera', deviceId: 'cam-1' });
      media.refuse('NotReadableError');
      await flush();
      expect(posted.at(-1)).toMatchObject({
        title: 'The camera is in use',
        body: 'Close the other app using it, then try again. Or choose something else for Kira to see.',
      });
      expect(vision.state.failure?.cause).toBe('Camera in use');

      expect(vision.state.stopped).toBe(true);

      posted.at(-1)?.primary?.run();
      media.refuse('NotReadableError');
      await flush();
      vi.advanceTimersByTime(visionTiming.retryLoader);
      expect(posted.at(-1)?.body).toBe(
        'Still in use. Close the other app using it, then try again.',
      );
    });

    it('starts the camera when Try again works, and closes the banner', async () => {
      const { vision, media, posted, closed } = setup();
      vision.choose({ kind: 'camera', deviceId: 'cam-1' });
      media.refuse('NotReadableError');
      await flush();

      posted.at(-1)?.primary?.run();
      media.open();
      await flush();
      expect(vision.state).toMatchObject({ share: 'live', failure: null });
      expect(closed).toContain(visionKeys.camera);
    });

    it('opens the source menu on Choose another, and the chip drops the cause', async () => {
      const { vision, media, posted, intents } = setup();
      vision.choose({ kind: 'camera', deviceId: 'cam-1' });
      media.refuse('NotReadableError');
      await flush();

      posted.at(-1)?.secondary?.run();
      expect(intents).toEqual(['menu']);
      expect(vision.state.failure).toBeNull();
    });

    it('says no camera was found, with Choose another first', async () => {
      const { vision, media, posted } = setup();
      vision.choose({ kind: 'camera', deviceId: null });
      media.refuse('NotFoundError');
      await flush();
      expect(posted.at(-1)).toMatchObject({
        title: 'No camera found',
        primary: { label: 'Choose another' },
      });
      expect(posted.at(-1)?.secondary).toBeUndefined();
    });

    it('stops a camera the transport could not publish, and says sharing could not start', async () => {
      const { vision, media, transport, posted } = setup();
      transport.visionError = new Error('publish failed');
      vision.choose({ kind: 'camera', deviceId: 'cam-1' });
      const track = media.open();
      await flush();

      expect(vision.state.share).toBe('none');
      expect(track.readyState).toBe('ended');
      expect(posted.at(-1)?.title).toBe('Sharing couldn’t start');
    });
  });

  describe('a camera that goes away', () => {
    it('stops sharing, says so, and starts again when the same camera comes back', async () => {
      const { vision, media, transport, posted, closed } = setup();
      vision.choose({ kind: 'camera', deviceId: 'cam-1' });
      const track = media.open();
      await flush();

      const unplugged = media.devices.shift();
      track.unplug();
      expect(vision.state).toMatchObject({
        share: 'none',
        stopped: true,
        failure: { cause: 'Disconnected' },
      });
      expect(transport.visions.at(-1)).toBeNull();
      expect(posted.at(-1)).toMatchObject({
        title: 'The camera was disconnected',
        body: 'Plug it back in, or choose something else for Kira to see.',
        primary: { label: 'Choose another' },
      });
      expect(posted.at(-1)?.secondary).toBeUndefined();

      if (unplugged) media.devices.unshift(unplugged);
      media.devicesChanged();
      await flush();
      expect(closed).toContain(visionKeys.camera);
      expect(media.starts.map((s) => s.deviceId)).toEqual(['cam-1']);
      media.open();
      await flush();
      expect(vision.state.share).toBe('live');
      expect(posted.at(-1)?.title).toBe('Camera is back');
    });

    it('does not start a camera that comes back after something else was chosen', async () => {
      const { vision, media } = setup();
      vision.choose({ kind: 'camera', deviceId: 'cam-1' });
      const track = media.open();
      await flush();
      track.unplug();
      vision.choose({ kind: 'nothing' });

      media.devicesChanged();
      await flush();
      expect(media.starts).toHaveLength(0);
    });

    it('stops sharing when the picture could not go out after a reconnect', async () => {
      const { vision, media, transport, posted } = setup();
      vision.choose({ kind: 'camera', deviceId: 'cam-1' });
      const track = media.open();
      await flush();

      transport.emit({ type: 'vision-failed' });
      expect(vision.state.share).toBe('none');
      expect(track.readyState).toBe('ended');
      expect(posted.at(-1)?.title).toBe('Sharing couldn’t start');
    });
  });
});

describe('Vision: a tab, window or screen', () => {
  it('opens the browser’s picker at once, in the press, with the row’s kind first', () => {
    const { vision, media } = setup();
    vision.choose({ kind: 'display', prefer: 'tab' });
    // Nothing is awaited before the picker: a browser opens it only right after the press.
    expect(media.pickers.map((p) => p.prefer)).toEqual(['tab']);
    expect(vision.state.share).toBe('none');
  });

  it('publishes the share as screen_share, live once the transport has it, and says so once', async () => {
    const { vision, media, transport, posted } = setup();
    let release: () => void = () => undefined;
    const setVision = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    transport.setVision = setVision;
    vision.choose({ kind: 'display', prefer: 'tab' });
    const track = media.choose('browser');
    await flush();

    expect(setVision).toHaveBeenCalledWith({ track, kind: 'screen_share' });
    expect(vision.state).toMatchObject({
      share: 'starting',
      source: { kind: 'tab', deviceId: null, name: '' },
    });
    expect(vision.state.stream?.getVideoTracks()[0]).toBe(track);
    expect(posted.map((n) => n.key)).not.toContain(visionKeys.nowSharing);

    release();
    await flush();
    expect(vision.state.share).toBe('live');
    expect(vision.seeing()).toBe('Browser tab');
    const now = posted.filter((n) => n.key === visionKeys.nowSharing);
    expect(now).toHaveLength(1);
    expect(now[0]).toMatchObject({
      title: 'Now sharing · Browser tab',
      brief: 'Now sharing',
      seconds: 2,
    });

    expect(now[0]?.mark).toBeUndefined();
  });

  it.each([
    ['browser', 'tab', 'Browser tab'],
    ['window', 'window', 'Window'],
    ['monitor', 'screen', 'Screen'],
  ] as const)(
    'names the kind by what the browser says was chosen (%s), whichever row asked',
    async (surface, kind, word) => {
      const { vision, media } = setup();
      // A tab row's picker can give a window: the browser's answer decides.
      vision.choose({ kind: 'display', prefer: 'tab' });
      media.choose(surface);
      await flush();
      expect(vision.state.source?.kind).toBe(kind);
      expect(vision.seeing()).toBe(word);
    },
  );

  it('stops the camera only once the picker gave a choice: one at a time', async () => {
    const { vision, media, transport } = setup();
    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    const camera = media.open();
    await flush();

    vision.choose({ kind: 'display', prefer: 'window' });
    // The picker is open: what was shared stays.
    expect(camera.readyState).toBe('live');
    expect(vision.state.share).toBe('live');

    const share = media.choose('window');
    await flush();
    expect(camera.readyState).toBe('ended');
    expect(handed(transport)).toEqual([camera.label, null, share.label]);
    expect(vision.state.source?.kind).toBe('window');
  });

  it('keeps what was shared, in silence, when the picker is closed', async () => {
    const { vision, media, posted } = setup();
    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    const camera = media.open();
    await flush();
    const before = posted.length;

    vision.choose({ kind: 'display', prefer: 'tab' });
    media.closePicker('NotAllowedError');
    await flush();
    expect(camera.readyState).toBe('live');
    expect(vision.state).toMatchObject({ share: 'live', source: { kind: 'camera' } });
    expect(posted.slice(before)).toEqual([]);
  });

  it.each(['NotAllowedError', 'AbortError'])(
    'says "Nothing shared" when the picker closes (%s) with nothing shared',
    async (name) => {
      const { vision, media, posted } = setup();
      vision.choose({ kind: 'display', prefer: 'screen' });
      media.closePicker(name);
      await flush();
      expect(vision.state.share).toBe('none');
      expect(posted.at(-1)).toMatchObject({
        key: visionKeys.nothingChosen,
        level: 'status',
        title: 'Nothing shared',
        seconds: 4,
      });
    },
  );

  it('offers Try again, which asks the picker again, when the browser cannot share', async () => {
    const { vision, media, posted } = setup();
    vision.choose({ kind: 'display', prefer: 'window' });
    media.closePicker('NotReadableError');
    await flush();
    const failed = posted.at(-1);
    expect(failed?.title).toBe('Sharing couldn’t start');

    expect(vision.state.stopped).toBe(true);

    failed?.primary?.run();
    expect(media.pickers.map((p) => p.prefer)).toEqual(['window']);
    // The share that starts leaves "Sharing stopped" behind.
    media.choose('window');
    await flush();
    expect(vision.state.stopped).toBe(false);
  });

  it.each(['browser', 'window', 'monitor'] as const)(
    'when a share (%s) is stopped from the browser’s bar: nothing shared, a status toast, "Sharing stopped"',
    async (surface) => {
      const { vision, media, transport, posted } = setup();
      vision.choose({ kind: 'display', prefer: 'tab' });
      const track = media.choose(surface);
      await flush();

      track.unplug();
      expect(vision.state).toMatchObject({ share: 'none', stream: null, failure: null });

      expect(vision.state.stopped).toBe(true);
      expect(handed(transport)).toEqual([track.label, null]);
      const stopped = posted.at(-1);
      expect(stopped).toMatchObject({
        key: visionKeys.stoppedFromBrowser,
        level: 'status',
        title: 'Sharing stopped from the browser',
        seconds: 4,
      });
      expect(stopped?.primary).toBeUndefined();
    },
  );

  it('opens the picker while the character answers, and switches once the reply ends', async () => {
    const { vision, media, transport, conversation } = setup();
    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    const camera = media.open();
    await flush();
    conversation.set(true);

    vision.choose({ kind: 'display', prefer: 'tab' });
    expect(media.pickers).toHaveLength(1);
    const share = media.choose('browser');
    await flush();
    expect(camera.readyState).toBe('live');
    expect(handed(transport)).toEqual([camera.label]);

    conversation.set(false);
    await flush();
    expect(camera.readyState).toBe('ended');
    expect(handed(transport)).toEqual([camera.label, null, share.label]);
    expect(vision.state.source?.kind).toBe('tab');
  });

  it('drops a waiting share stopped from the browser, or overtaken by Nothing', async () => {
    const { vision, media, transport, conversation } = setup();
    conversation.set(true);
    vision.choose({ kind: 'display', prefer: 'tab' });
    const first = media.choose('browser');
    await flush();
    first.unplug();
    conversation.set(false);
    await flush();
    expect(transport.visions).toEqual([]);

    conversation.set(true);
    vision.choose({ kind: 'display', prefer: 'tab' });
    const second = media.choose('browser');
    await flush();
    vision.choose({ kind: 'nothing' });
    expect(second.readyState).toBe('ended');
    conversation.set(false);
    await flush();
    expect(transport.visions).toEqual([]);
  });

  it('gives back a picker’s late answer once another choice overtook it', async () => {
    const { vision, media, transport } = setup();
    vision.choose({ kind: 'display', prefer: 'tab' });
    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    const late = media.choose('browser');
    await flush();
    expect(late.readyState).toBe('ended');
    expect(handed(transport)).not.toContain(late.label);
  });

  it('stops the share on Nothing and on dispose', async () => {
    const { vision, media } = setup();
    vision.choose({ kind: 'display', prefer: 'tab' });
    const first = media.choose('browser');
    await flush();
    vision.choose({ kind: 'nothing' });
    expect(first.readyState).toBe('ended');

    vision.choose({ kind: 'display', prefer: 'tab' });
    const second = media.choose('browser');
    await flush();
    vision.dispose();
    expect(second.readyState).toBe('ended');
  });

  it('offers to ask the picker again when the service would not take the share', async () => {
    const { vision, media, transport, posted } = setup();
    transport.visionError = new Error('refused');
    vision.choose({ kind: 'display', prefer: 'window' });
    const track = media.choose('window');
    await flush();
    expect(vision.state.share).toBe('none');
    expect(track.readyState).toBe('ended');
    expect(posted.at(-1)?.title).toBe('Sharing couldn’t start');
    posted.at(-1)?.primary?.run();
    expect(media.pickers.map((p) => p.prefer)).toEqual(['window']);
  });
});

describe('Vision: a region of a tab, window or screen (D6w)', () => {
  const surface = { width: 1280, height: 800 };
  const middle = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
  const quarter = { x: 0.5, y: 0.5, width: 0.5, height: 0.5 };

  /** Region…, the picker answered: the crop is open on the share it gave. */
  async function cropOpen(chosen: 'browser' | 'window' | 'monitor' = 'browser') {
    const context = setup();
    context.vision.choose({ kind: 'region' });
    const whole = context.media.choose(chosen);
    await flush();
    return { ...context, whole };
  }

  /** …and "Share area", its first picture drawn. */
  async function regionLive(chosen: 'browser' | 'window' | 'monitor' = 'browser') {
    const context = await cropOpen(chosen);
    context.vision.shareArea();
    context.media.feed.draw(surface);
    await flush();
    return context;
  }

  it('asks the picker in the press with a tab first and a whole screen offered', () => {
    const { vision, media } = setup();
    vision.choose({ kind: 'region' });
    expect(media.pickers.map((p) => [p.prefer, p.forRegion])).toEqual([['tab', true]]);
  });

  it('opens the crop on what the picker gave, with the middle half, and shows the character nothing', async () => {
    const { vision, media, transport, whole } = await cropOpen();
    expect(vision.state.crop).toMatchObject({ area: middle, change: false });
    expect(vision.state.crop?.stream.getVideoTracks()[0]).toBe(whole);
    expect(vision.state.share).toBe('none');
    expect(transport.visions).toEqual([]);
    expect(media.feeds).toEqual([]);
  });

  it('lets go of the source before as the crop opens, not before (14b Q4)', async () => {
    const { vision, media, transport } = setup();
    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    const camera = media.open();
    await flush();
    vision.choose({ kind: 'region' });
    // The picker is open: what was shared stays.
    expect(camera.readyState).toBe('live');
    expect(vision.state.share).toBe('live');
    media.choose('browser');
    await flush();
    expect(camera.readyState).toBe('ended');
    expect(handed(transport)).toEqual([camera.label, null]);
    expect(vision.state).toMatchObject({ share: 'none', source: null });
  });

  it('shares the area as screen_share once its first picture is drawn, named by its size', async () => {
    const { vision, media, transport, posted, whole } = await cropOpen();
    vision.moveArea(quarter);
    vision.shareArea();
    expect(vision.state.crop).toBeNull();
    expect(media.feed.area).toEqual(quarter);
    expect(media.feed.source.getVideoTracks()[0]).toBe(whole);
    expect(vision.state).toMatchObject({ share: 'starting', source: { kind: 'region', name: '' } });
    expect(vision.state.stream).toBe(media.feed.stream);
    // Not handed over before the picture has the area's size.
    expect(transport.visions).toEqual([]);

    media.feed.draw(surface);
    await flush();
    expect(transport.visions).toEqual([{ track: media.feed.track, kind: 'screen_share' }]);
    expect(vision.state).toMatchObject({
      share: 'live',
      source: { kind: 'region', deviceId: null, name: '640 × 400' },
    });
    expect(vision.seeing()).toBe('Region');
    const now = posted.filter((n) => n.key === visionKeys.nowSharing);
    expect(now.map((n) => n.title)).toEqual(['Now sharing · Region']);
    // The browser's share goes on: the region is drawn from it.
    expect(whole.readyState).toBe('live');
  });

  it('names the region anew when the shared tab is resized', async () => {
    const { vision, media } = await regionLive();
    expect(vision.state.source?.name).toBe('640 × 400');
    media.feed.resize({ width: 640, height: 400 });
    expect(vision.state.source?.name).toBe('320 × 200');
  });

  it('on Cancel of a first crop shares nothing, ends the browser’s share, and says nothing', async () => {
    const { vision, transport, posted, whole } = await cropOpen();
    const before = posted.length;
    vision.cancelCrop();
    expect(vision.state.crop).toBeNull();
    expect(vision.state.share).toBe('none');
    expect(whole.readyState).toBe('ended');
    expect(transport.visions).toEqual([]);
    expect(posted.length).toBe(before);
  });

  it('keeps what was shared, in silence, when the picker is closed; says "Nothing shared" with nothing', async () => {
    const shared = await regionLive();
    shared.vision.choose({ kind: 'region' });
    shared.media.closePicker();
    await flush();
    expect(shared.vision.state.share).toBe('live');
    expect(shared.posted.map((n) => n.key)).not.toContain(visionKeys.nothingChosen);

    const { vision, media, posted } = setup();
    vision.choose({ kind: 'region' });
    media.closePicker('AbortError');
    await flush();
    expect(vision.state.crop).toBeNull();
    expect(posted.at(-1)?.key).toBe(visionKeys.nothingChosen);
  });

  it('offers Try again, which asks for a region again, when the browser cannot share', async () => {
    const { vision, media, posted } = setup();
    vision.choose({ kind: 'region' });
    media.closePicker('NotReadableError');
    await flush();
    expect(posted.at(-1)?.key).toBe(visionKeys.shareFailed);
    posted.at(-1)?.primary?.run();
    expect(media.pickers.map((p) => [p.prefer, p.forRegion])).toEqual([['tab', true]]);
    media.choose('browser');
    await flush();
    expect(vision.state.crop?.change).toBe(false);
  });

  it('opens Change area… on the same share with the area shared; the region stays live, and Cancel keeps it', async () => {
    const { vision, media, transport, closed, whole } = await regionLive();
    expect(vision.canChangeArea()).toBe(true);
    vision.changeArea();
    expect(vision.canChangeArea()).toBe(false);
    expect(media.pickers).toEqual([]);
    expect(vision.state.crop).toMatchObject({ area: middle, change: true });
    expect(vision.state.crop?.stream.getVideoTracks()[0]).toBe(whole);
    expect(vision.state.share).toBe('live');
    // "Now sharing" no longer holds while the area is changed.
    expect(closed.at(-1)).toBe(visionKeys.nowSharing);

    vision.cancelCrop();
    expect(vision.state.crop).toBeNull();
    expect(vision.state.share).toBe('live');
    expect(media.feed.stopped).toBe(false);
    expect(whole.readyState).toBe('live');
    expect(handed(transport)).toEqual(['region:1']);
  });

  it('shares a changed area once its picture is drawn, then stops the one before; the share goes on', async () => {
    const { vision, media, transport, posted, whole } = await regionLive();
    const first = media.feed;
    vision.changeArea();
    vision.moveArea(quarter);
    vision.shareArea();
    expect(vision.state.crop).toBeNull();
    const second = media.feed;
    expect(second).not.toBe(first);
    // The area before stays what the character sees until the new one is handed over.
    expect(first.stopped).toBe(false);
    expect(vision.state).toMatchObject({ share: 'live', stream: first.stream });

    second.draw(surface);
    await flush();
    expect(handed(transport)).toEqual(['region:1', 'region:2']);
    expect(first.stopped).toBe(true);
    expect(whole.readyState).toBe('live');
    expect(vision.state).toMatchObject({
      share: 'live',
      stream: second.stream,
      source: { name: '640 × 400' },
    });
    expect(posted.filter((n) => n.key === visionKeys.nowSharing)).toHaveLength(2);
  });

  it('closes Change area… without a new picture when the area did not move', async () => {
    const { vision, media, transport } = await regionLive();
    vision.changeArea();
    vision.shareArea();
    expect(vision.state.crop).toBeNull();
    expect(media.feeds).toHaveLength(1);
    expect(handed(transport)).toEqual(['region:1']);
  });

  it('closes a first crop stopped from the browser; Region… next crops with the area drawn so far', async () => {
    const { vision, media, posted, whole } = await cropOpen('window');
    vision.moveArea(quarter);
    whole.unplug();
    expect(vision.state).toMatchObject({ crop: null, stopped: true });
    expect(posted.at(-1)).toMatchObject({
      key: visionKeys.stoppedFromBrowser,
      level: 'status',
      title: 'Sharing stopped from the browser',
    });
    vision.choose({ kind: 'region' });
    expect(media.pickers.at(-1)?.forRegion).toBe(true);
    media.choose('window');
    await flush();
    expect(vision.state.crop).toMatchObject({ area: quarter, change: false });
  });

  it('ends a live region stopped from the browser; Region… next crops with its area ready', async () => {
    const { vision, media, transport, posted, whole } = await regionLive();
    const feed = media.feed;
    whole.unplug();
    expect(vision.state).toMatchObject({
      share: 'none',
      source: null,
      stream: null,
      stopped: true,
    });
    expect(feed.stopped).toBe(true);
    expect(handed(transport)).toEqual(['region:1', null]);
    expect(posted.at(-1)).toMatchObject({ key: visionKeys.stoppedFromBrowser, level: 'status' });
    vision.choose({ kind: 'region' });
    media.choose('browser');
    await flush();
    expect(vision.state.crop?.area).toEqual(middle);
  });

  it('ends a region whose share is stopped while its area is changed, keeping the area drawn so far', async () => {
    const { vision, media, posted, whole } = await regionLive();
    vision.changeArea();
    vision.moveArea(quarter);
    whole.unplug();
    expect(vision.state.crop).toBeNull();
    expect(vision.state.share).toBe('none');
    expect(posted.filter((n) => n.key === visionKeys.stoppedFromBrowser)).toHaveLength(1);
    vision.choose({ kind: 'region' });
    media.choose('browser');
    await flush();
    expect(vision.state.crop?.area).toEqual(quarter);
    // Once a region starts from it, the kept area is spent: the next Region… starts in the middle.
    vision.shareArea();
    await flush();
    vision.choose({ kind: 'region' });
    media.choose('browser');
    await flush();
    expect(vision.state.crop?.area).toEqual(middle);
  });

  it('says a share stopped before the area’s first picture as its end, not as a failure', async () => {
    const { vision, media, posted, whole } = await cropOpen();
    vision.shareArea();
    whole.unplug();
    await flush();
    expect(vision.state.share).toBe('none');
    expect(posted.map((n) => n.key)).not.toContain(visionKeys.shareFailed);
    expect(posted.at(-1)?.key).toBe(visionKeys.stoppedFromBrowser);
    expect(media.feed.stopped).toBe(true);
  });

  it('starts over on Region… again: the picker, then a fresh crop; the region before goes as it opens', async () => {
    const { vision, media, whole } = await regionLive();
    const feed = media.feed;
    vision.choose({ kind: 'region' });
    expect(vision.state.share).toBe('live');
    media.choose('browser');
    await flush();
    expect(feed.stopped).toBe(true);
    expect(whole.readyState).toBe('ended');
    expect(vision.state.crop).toMatchObject({ area: middle, change: false });
  });

  it('gives up an open crop when another source is chosen, ending its share', async () => {
    const { vision, media, whole } = await cropOpen();
    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    expect(vision.state.crop).toBeNull();
    expect(whole.readyState).toBe('ended');
    expect(media.starts).toHaveLength(1);
  });

  it('stops the region, its share and its drawing on Nothing and on dispose', async () => {
    const first = await regionLive();
    first.vision.choose({ kind: 'nothing' });
    expect(first.media.feed.stopped).toBe(true);
    expect(first.whole.readyState).toBe('ended');
    expect(handed(first.transport)).toEqual(['region:1', null]);

    const second = await regionLive();
    second.vision.dispose();
    expect(second.media.feed.stopped).toBe(true);
    expect(second.whole.readyState).toBe('ended');

    const third = await cropOpen();
    third.vision.dispose();
    expect(third.whole.readyState).toBe('ended');
  });

  it('offers to crop again when the service would not take the region', async () => {
    const { vision, media, transport, posted } = await regionLive();
    transport.emit({ type: 'vision-failed' });
    expect(vision.state.share).toBe('none');
    expect(media.feed.stopped).toBe(true);
    expect(posted.at(-1)?.key).toBe(visionKeys.shareFailed);
    posted.at(-1)?.primary?.run();
    expect(media.pickers.map((p) => [p.prefer, p.forRegion])).toEqual([['tab', true]]);
  });
});

describe('Vision: a still image (K5, K6)', () => {
  const fileOf = (name: string, size = 1000) =>
    ({ name, size, type: '' }) as unknown as Blob & { name: string; size: number; type: string };

  it('decodes the file, then publishes its picture as screen_share; named by the file, and silent', async () => {
    const { vision, media, transport, posted } = setup();
    vision.choose({ kind: 'image', file: fileOf('mug.jpg') });
    expect(media.decoding).toHaveLength(1);
    expect(vision.state.share).toBe('none');

    const feed = media.decode();
    await flush();
    expect(transport.visions.at(-1)).toEqual({ track: feed.track, kind: 'screen_share' });
    expect(vision.state).toMatchObject({
      share: 'live',
      source: { kind: 'image', deviceId: null, name: 'mug.jpg' },
    });
    expect(vision.state.stream).toBe(feed.stream);
    expect(vision.seeing()).toBe('Image');

    expect(posted).toEqual([]);
  });

  it('calls a paste the browser named generically "Pasted image", and keeps a file’s own name', async () => {
    const { vision, media } = setup();
    vision.choose({ kind: 'image', file: fileOf('image.png'), pasted: true });
    media.decode();
    await flush();
    expect(vision.state.source?.name).toBe('Pasted image');

    vision.choose({ kind: 'image', file: fileOf('receipt.png'), pasted: true });
    media.decode();
    await flush();
    expect(vision.state.source?.name).toBe('receipt.png');
  });

  it.each([
    ['notes.pdf', 1000, 'PNG and JPG only'],
    ['huge.png', 20 * 1024 * 1024 + 1, 'That image is over 20 MB'],
  ] as const)(
    'refuses %s at once, in words, and keeps what was shared',
    async (name, size, words) => {
      const { vision, media, transport, posted } = setup();
      vision.choose({ kind: 'camera', deviceId: 'cam-1' });
      const camera = media.open();
      await flush();

      vision.choose({ kind: 'image', file: fileOf(name, size) });
      await flush();
      expect(media.decoding).toHaveLength(0);
      expect(posted.at(-1)).toMatchObject({ level: 'status', title: words, seconds: 4 });
      expect(camera.readyState).toBe('live');
      expect(vision.state.source?.kind).toBe('camera');
      expect(handed(transport)).toEqual([camera.label]);
    },
  );

  it.each([
    ['not-image', 'PNG and JPG only'],
    ['unreadable', 'That file couldn’t be opened'],
  ] as const)(
    'keeps what was shared when the file does not decode (%s)',
    async (refusal, words) => {
      const { vision, media, transport, posted } = setup();
      vision.choose({ kind: 'image', file: fileOf('first.png') });
      const first = media.decode();
      await flush();

      vision.choose({ kind: 'image', file: fileOf('broken.png') });
      media.undecodable(refusal);
      await flush();
      expect(posted.at(-1)?.title).toBe(words);
      expect(first.stopped).toBe(false);
      expect(vision.state.source?.name).toBe('first.png');
      expect(handed(transport)).toEqual([first.track.label]);
    },
  );

  it('replaces what was shared only once the picture is decoded: one at a time', async () => {
    const { vision, media, transport } = setup();
    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    const camera = media.open();
    await flush();

    vision.choose({ kind: 'image', file: fileOf('mug.jpg') });
    await flush();
    expect(camera.readyState).toBe('live');
    const feed = media.decode();
    await flush();
    expect(camera.readyState).toBe('ended');
    expect(handed(transport)).toEqual([camera.label, null, feed.track.label]);
  });

  it('stops the image before the next source starts, and on Nothing and on dispose', async () => {
    const { vision, media } = setup();
    vision.choose({ kind: 'image', file: fileOf('a.png') });
    const a = media.decode();
    await flush();
    vision.choose({ kind: 'image', file: fileOf('b.png') });
    const b = media.decode();
    await flush();
    expect(a.stopped).toBe(true);
    expect(b.stopped).toBe(false);

    vision.choose({ kind: 'nothing' });
    expect(b.stopped).toBe(true);
    expect(vision.state.share).toBe('none');

    vision.choose({ kind: 'image', file: fileOf('c.png') });
    const c = media.decode();
    await flush();
    vision.dispose();
    expect(c.stopped).toBe(true);
  });

  it('lets a newer choice overtake an image still decoding; its late picture is stopped', async () => {
    const { vision, media } = setup();
    vision.choose({ kind: 'image', file: fileOf('slow.png') });
    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    media.open();
    await flush();
    const late = media.decode();
    await flush();
    expect(late.stopped).toBe(true);
    expect(vision.state.source?.kind).toBe('camera');
  });

  it('shares an image chosen while the character answers once the reply ends', async () => {
    const { vision, media, transport, conversation } = setup();
    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    const camera = media.open();
    await flush();
    conversation.set(true);

    vision.choose({ kind: 'image', file: fileOf('mug.jpg') });
    const feed = media.decode();
    await flush();
    expect(camera.readyState).toBe('live');
    expect(handed(transport)).toEqual([camera.label]);

    conversation.set(false);
    await flush();
    expect(handed(transport)).toEqual([camera.label, null, feed.track.label]);
    expect(vision.state.source?.kind).toBe('image');
  });

  it('drops a waiting image overtaken by Nothing', async () => {
    const { vision, media, conversation } = setup();
    conversation.set(true);
    vision.choose({ kind: 'image', file: fileOf('mug.jpg') });
    const feed = media.decode();
    await flush();
    vision.choose({ kind: 'nothing' });
    expect(feed.stopped).toBe(true);
    conversation.set(false);
    await flush();
    expect(vision.state.share).toBe('none');
  });

  it('offers to share the same file again when the service would not take it', async () => {
    const { vision, media, transport, posted } = setup();
    transport.visionError = new Error('refused');
    vision.choose({ kind: 'image', file: fileOf('mug.jpg') });
    const first = media.decode();
    await flush();
    expect(vision.state.share).toBe('none');
    expect(first.stopped).toBe(true);
    expect(posted.at(-1)?.title).toBe('Sharing couldn’t start');

    posted.at(-1)?.primary?.run();
    media.decode();
    await flush();
    expect(vision.state).toMatchObject({ share: 'live', source: { name: 'mug.jpg' } });
  });

  it('offers the same file again when the service drops the live picture', async () => {
    const { vision, media, transport, posted } = setup();
    vision.choose({ kind: 'image', file: fileOf('mug.jpg') });
    const feed = media.decode();
    await flush();
    transport.emit({ type: 'vision-failed' });
    expect(feed.stopped).toBe(true);
    expect(vision.state.share).toBe('none');
    posted.at(-1)?.primary?.run();
    expect(media.decoding).toHaveLength(1);
  });
});

describe('Vision: Pause vision (H12, H12b)', () => {
  const fileOf = (name: string) =>
    ({ name, size: 1000, type: '' }) as unknown as Blob & {
      name: string;
      size: number;
      type: string;
    };

  async function cameraLive() {
    const context = setup();
    context.vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    const camera = context.media.open();
    await flush();
    return { ...context, camera };
  }

  it('can pause only a live share with no crop over it', async () => {
    const { vision, media, transport } = setup();
    expect(vision.canPause()).toBe(false);
    vision.setPaused(true);
    expect(vision.state.paused).toBe(false);
    expect(transport.visions).toEqual([]);

    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    expect(vision.state.share).toBe('starting');
    expect(vision.canPause()).toBe(false);
    media.open();
    await flush();
    expect(vision.canPause()).toBe(true);
  });

  it('takes the picture back at once, keeps the camera running and its kind and name, and Resume hands the same track back', async () => {
    const { vision, transport, camera, closedNow } = await cameraLive();
    const before = vision.state.source;

    vision.setPaused(true);
    expect(vision.state).toMatchObject({ share: 'live', paused: true, source: before });
    expect(handed(transport)).toEqual([camera.label, null]);
    // Nothing is captured anew for Resume: the camera's light stays on and its picture stays.
    expect(camera.readyState).toBe('live');
    expect(vision.state.stream?.getVideoTracks()[0]).toBe(camera);
    expect(vision.seeing()).toBeNull();
    expect(vision.canPause()).toBe(false);

    expect(closedNow).toEqual([visionKeys.nowSharing]);

    vision.setPaused(false);
    expect(vision.state.paused).toBe(false);
    expect(transport.visions.at(-1)).toEqual({ track: camera, kind: 'camera' });
    expect(vision.seeing()).toBe('Camera');
    await flush();
    expect(vision.state.share).toBe('live');
  });

  it('pauses even while the character answers: stopping being seen is never held back', async () => {
    const { vision, transport, conversation, camera } = await cameraLive();
    conversation.set(true);
    vision.setPaused(true);
    expect(handed(transport)).toEqual([camera.label, null]);
  });

  it('says nothing on Resume: a pause ending is no news', async () => {
    const { vision, media, posted } = setup();
    vision.choose({ kind: 'display', prefer: 'tab' });
    const track = media.choose('browser');
    await flush();
    expect(posted.filter((n) => n.key === visionKeys.nowSharing)).toHaveLength(1);

    vision.setPaused(true);
    vision.setPaused(false);
    await flush();
    expect(posted.filter((n) => n.key === visionKeys.nowSharing)).toHaveLength(1);
    expect(track.readyState).toBe('live');
  });

  it('republishes a tab, a region and an image as screen_share on Resume', async () => {
    const tab = setup();
    tab.vision.choose({ kind: 'display', prefer: 'tab' });
    const track = tab.media.choose('window');
    await flush();
    tab.vision.setPaused(true);
    tab.vision.setPaused(false);
    expect(tab.transport.visions.slice(-2)).toEqual([null, { track, kind: 'screen_share' }]);

    const region = setup();
    region.vision.choose({ kind: 'region' });
    region.media.choose('browser');
    await flush();
    region.vision.shareArea();
    region.media.feed.draw({ width: 1280, height: 800 });
    await flush();
    region.vision.setPaused(true);
    expect(region.media.feed.stopped).toBe(false);
    region.vision.setPaused(false);
    expect(region.transport.visions.slice(-2)).toEqual([
      null,
      { track: region.media.feed.track, kind: 'screen_share' },
    ]);

    const image = setup();
    image.vision.choose({ kind: 'image', file: fileOf('mug.jpg') });
    const feed = image.media.decode();
    await flush();
    image.vision.setPaused(true);
    expect(feed.stopped).toBe(false);
    expect(image.vision.state.source?.name).toBe('mug.jpg');
    image.vision.setPaused(false);
    expect(image.transport.visions.slice(-2)).toEqual([
      null,
      { track: feed.track, kind: 'screen_share' },
    ]);
  });

  it('pauses while an area is changed, the region still being seen: the change is given up', async () => {
    const { vision, media, transport } = setup();
    vision.choose({ kind: 'region' });
    const whole = media.choose('browser');
    await flush();
    vision.shareArea();
    media.feed.draw({ width: 1280, height: 800 });
    await flush();
    const region = media.feed;
    vision.changeArea();
    expect(vision.canPause()).toBe(true);
    vision.setPaused(true);
    expect(vision.state).toMatchObject({ paused: true, crop: null, source: { kind: 'region' } });
    expect(transport.visions.at(-1)).toBeNull();
    // The area shared before the change is what is paused; nothing of the share ends.
    expect(region.stopped).toBe(false);
    expect(whole.readyState).toBe('live');
    vision.setPaused(false);
    expect(transport.visions.at(-1)).toEqual({ track: region.track, kind: 'screen_share' });
  });

  it('cannot pause a first crop: nothing is seen yet', async () => {
    const { vision, media } = setup();
    vision.choose({ kind: 'region' });
    media.choose('browser');
    await flush();
    expect(vision.state.crop).not.toBeNull();
    expect(vision.canPause()).toBe(false);
  });

  it('offers no Change area… while paused: a new area would go out unpaused', async () => {
    const { vision, media } = setup();
    vision.choose({ kind: 'region' });
    media.choose('browser');
    await flush();
    vision.shareArea();
    media.feed.draw({ width: 1280, height: 800 });
    await flush();
    expect(vision.canChangeArea()).toBe(true);
    vision.setPaused(true);
    expect(vision.canChangeArea()).toBe(false);
    vision.changeArea();
    expect(vision.state.crop).toBeNull();
  });

  it('ends the pause when another source is chosen: the new one goes out, not paused', async () => {
    const { vision, media, transport, camera } = await cameraLive();
    vision.setPaused(true);
    vision.choose({ kind: 'display', prefer: 'tab' });
    // The picker is open: the paused camera stays paused.
    expect(vision.state.paused).toBe(true);
    const track = media.choose('browser');
    await flush();
    expect(camera.readyState).toBe('ended');
    expect(vision.state).toMatchObject({ share: 'live', paused: false, source: { kind: 'tab' } });
    expect(transport.visions.at(-1)).toEqual({ track, kind: 'screen_share' });
  });

  it('ends the pause on Nothing, and when the share is stopped from the browser', async () => {
    const first = await cameraLive();
    first.vision.setPaused(true);
    first.vision.choose({ kind: 'nothing' });
    expect(first.vision.state).toMatchObject({ share: 'none', paused: false });
    expect(first.camera.readyState).toBe('ended');
    // Already taken back on pause: the transport is not told twice.
    expect(handed(first.transport)).toEqual([first.camera.label, null]);

    const second = setup();
    second.vision.choose({ kind: 'display', prefer: 'tab' });
    const track = second.media.choose('browser');
    await flush();
    second.vision.setPaused(true);
    track.unplug();
    expect(second.vision.state).toMatchObject({ share: 'none', paused: false });
  });

  it('ignores a vision failure while paused: nothing is with the transport', async () => {
    const { vision, transport, posted } = await cameraLive();
    vision.setPaused(true);
    transport.emit({ type: 'vision-failed' });
    expect(vision.state).toMatchObject({ share: 'live', paused: true });
    expect(posted.map((n) => n.key)).not.toContain(visionKeys.shareFailed);
  });

  it('says sharing could not start when Resume is refused, with Try again', async () => {
    const { vision, media, transport, posted, camera } = await cameraLive();
    vision.setPaused(true);
    transport.visionError = new Error('refused');
    vision.setPaused(false);
    await flush();
    expect(vision.state.share).toBe('none');
    expect(camera.readyState).toBe('ended');
    expect(posted.at(-1)?.key).toBe(visionKeys.shareFailed);
    posted.at(-1)?.primary?.run();
    expect(media.starts.map((s) => s.deviceId)).toEqual(['cam-1']);
  });
});

describe('the camera Settings › Vision chose (S3)', () => {
  function withPreferred(preferred: string | null) {
    const transport = new FakeTransport();
    const media = new FakeMedia();
    const vision = new Vision({
      transport,
      media,
      conversation: new FakeConversation(),
      notices: { post: () => undefined, close: () => undefined },
      name: () => 'Kira',
      preferredCamera: () => preferred,
    });
    vision.start();
    return { vision, media };
  }

  it('opens a camera share that names no camera on the chosen one, while the browser lists it', async () => {
    const { vision, media } = withPreferred('cam-2');
    await flush();
    vision.choose({ kind: 'camera', deviceId: null });
    expect(media.starts.map((start) => start.deviceId)).toEqual(['cam-2']);
  });

  it('leaves a share that names its camera, and a camera no longer listed, as they are', async () => {
    const { vision, media } = withPreferred('cam-2');
    await flush();
    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    const gone = withPreferred('unplugged');
    await flush();
    gone.vision.choose({ kind: 'camera', deviceId: null });
    expect(media.starts.map((start) => start.deviceId)).toEqual(['cam-1']);
    expect(gone.media.starts.map((start) => start.deviceId)).toEqual([null]);
  });
});

describe('a still for the transcript', () => {
  it('is taken of the running picture only while the character sees it', async () => {
    const { vision, media } = setup();
    expect(await vision.still()).toBeNull();

    vision.choose({ kind: 'camera', deviceId: 'cam-1' });
    const camera = media.open();
    await flush();
    expect(await vision.still()).toBe('still:1');
    expect(media.stills[0]?.getVideoTracks()[0]).toBe(camera);

    vision.setPaused(true);
    expect(await vision.still()).toBeNull();
    vision.setPaused(false);
    vision.choose({ kind: 'nothing' });
    expect(await vision.still()).toBeNull();
    expect(media.stills).toHaveLength(1);
  });
});
