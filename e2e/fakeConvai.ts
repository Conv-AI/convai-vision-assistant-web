import type { Page } from '@playwright/test';

/**
 * A stand-in for Convai in end-to-end tests. It is installed before the app loads through
 * `addInitScript` and hands the app a transport through `window.convaiVisionTest`, so the tests run
 * an optimized build in E2E mode. Normal production builds remove this hook; `pnpm check:bundle`
 * rejects both the hook name and the fake marker in publishable output.
 */
export const fakeMarker = 'fake-convai-transport-7c1e';

export interface FakeOptions {
  /** How the first connect goes; `hold` waits for `accept()` or `refuse()`. */
  connect?: 'accept' | 'hold' | 'refuse-network' | 'refuse-service';
  permission?: 'granted' | 'prompt' | 'denied';
  /** What opening the microphone comes to. */
  microphone?: 'on' | 'blocked' | 'busy' | 'none';
  /** How every connect after the first goes (Try again, restarts). */
  later?: 'accept' | 'hold' | 'refuse-network' | 'refuse-service';

  firstRun?: boolean;

  tips?: boolean;
  /**
   * How a typed question goes out. By default the service takes it at once (its acknowledgement and
   * a moment of `listening`), as 2.0.1 does; `hold` gives only the SDK's own echo and waits for the
   * test to emit what the service says; `drop` is a send that cannot leave (no client). Read again
   * at every send, so a test may change `window.fakeConvai.options.send` in between.
   */
  send?: 'take' | 'hold' | 'drop';
}

/** What a test reads back from the fake, through `page.evaluate`. */
export interface FakeRecord {
  sent: string[];
  interrupts: number;
  connects: number;
  /** The character of each connect, in order. */
  characters: string[];
  /** Every end user a connect spoke as: one fixed id. */
  endUsers: (string | undefined)[];
  microphone: boolean[];
  /** Every microphone chosen in Settings, in order; null is the browser's default. */
  devices: (string | null)[];
  /** The character's volume as last set. */
  volume: number;
  /** Every picture handed over, in order; null is "see nothing". */
  visions: (PublishedVision | null)[];
}

/** A picture as the fake was handed it: what it is, and which track. */
export interface PublishedVision {
  kind: string;
  label: string;
  trackId: string;
  /** The track came from a canvas, not from the device. */
  canvas: boolean;
}

declare global {
  interface Window {
    /** The app's test hook (src/app/runtime.ts); typed loosely here, where the app is not built. */
    convaiVisionTest?: { createTransport?: () => unknown };
    fakeConvai?: {
      marker: string;
      record: FakeRecord;
      emit: (event: unknown) => void;
      accept: () => void;
      refuse: (failure: 'network' | 'service') => void;
      /** Plays a whole reply as the recorded 2.0.1 session does, over about a second. */
      answer: (text: string) => Promise<void>;
      options: FakeOptions;
      /** The tracks handed over, to read their state later (is the camera's light off?). */
      tracks: MediaStreamTrack[];
      /**
       * The canvas a track was captured from, if it was. Only Chromium's tracks know their canvas
       * (`CanvasCaptureMediaStreamTrack`); this one is kept for every engine.
       */
      canvasOf: (track: MediaStreamTrack) => HTMLCanvasElement | undefined;
    };
  }
}

/** Runs in the page, before the app: everything it needs is inside it. */
function install(input: { options: FakeOptions; marker: string }) {
  const options = input.options;
  // The first run shows once on a device; a test that is not about it starts after it.
  if (!options.firstRun) window.localStorage.setItem('va.first-run-done', '1');
  if (!options.tips) {
    const learned = { learned: true };
    const tips = {
      talk: learned,
      stop: learned,
      type: learned,
      transcript: learned,
      quick: learned,
    };
    window.localStorage.setItem('va.tips', JSON.stringify({ sessions: 1, answers: 0, tips }));
  }
  const listeners = new Set<(event: unknown) => void>();
  const silence = { sample: () => ({ level: 0, onset: false }) };
  const record: FakeRecord = {
    sent: [],
    interrupts: 0,
    connects: 0,
    characters: [],
    endUsers: [],
    microphone: [],
    devices: [],
    volume: 1,
    visions: [],
  };
  const tracks: MediaStreamTrack[] = [];
  const canvases = new WeakMap<MediaStreamTrack, HTMLCanvasElement>();
  const proto = HTMLCanvasElement.prototype as unknown as {
    captureStream: (rate?: number) => MediaStream;
  };
  const capture = proto.captureStream;
  proto.captureStream = function (this: HTMLCanvasElement, rate?: number) {
    const stream = capture.call(this, rate);
    for (const track of stream.getTracks()) canvases.set(track, this);
    return stream;
  };
  const canvasOf = (track: MediaStreamTrack) => canvases.get(track);
  let pending: { resolve: () => void; reject: (error: unknown) => void } | null = null;
  let replies = 0;
  const emit = (event: unknown) => {
    for (const listener of [...listeners]) listener(event);
  };
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  // A refusal says why the way the app's own transport does: a `failure` on the error.
  const refusal = (failure: 'network' | 'service') =>
    Object.assign(new Error(`The fake refused (${failure}).`), { failure });
  const outcome = (mode: FakeOptions['connect']) => {
    if (mode === 'refuse-network') return Promise.reject(refusal('network'));
    if (mode === 'refuse-service') return Promise.reject(refusal('service'));
    if (mode === 'hold')
      return new Promise<void>((resolve, reject) => {
        pending = { resolve, reject };
      });
    return Promise.resolve();
  };

  const devices = navigator.mediaDevices as MediaDevices | undefined;
  if (devices && !window.fakeDisplay) {
    devices.getDisplayMedia = () =>
      Promise.reject(new DOMException('No e2e test shares the real screen.', 'NotAllowedError'));
  }

  window.fakeConvai = {
    marker: input.marker,
    record,
    options,
    tracks,
    canvasOf,
    emit,
    accept: () => {
      pending?.resolve();
      pending = null;
    },
    refuse: (failure) => {
      pending?.reject(refusal(failure));
      pending = null;
    },
    answer: async (text) => {
      const id = `bot-llm-${String(++replies)}`;
      emit({ type: 'activity', activity: 'thinking' });
      emit({ type: 'reply', id, text: '', streaming: true });
      await wait(150);
      emit({ type: 'reply', id, text, streaming: true });
      emit({ type: 'activity', activity: 'idle' });
      emit({ type: 'reply', id, text, streaming: false });
      emit({ type: 'activity', activity: 'speaking' });
      await wait(900);
      emit({ type: 'activity', activity: 'idle' });
    },
  };

  window.convaiVisionTest = {
    createTransport: () => ({
      characterLevel: silence,
      userLevel: silence,
      connect: (connect: { characterId: string; endUserId?: string }) => {
        record.connects++;
        record.characters.push(connect.characterId);
        record.endUsers.push(connect.endUserId);
        // Only the first connect follows the option; later ones (Try again, restarts) work.
        return outcome(record.connects === 1 ? options.connect : (options.later ?? 'accept'));
      },
      disconnect: () => Promise.resolve(),
      sendText: (text: string) => {
        if (options.send === 'drop') return false;
        record.sent.push(text);
        // As 2.0.1 does: the SDK's own echo of the question, then the service's acknowledgement
        // naming it and a moment of "listening".
        emit({ type: 'question', text });
        if (options.send === 'hold') return true;
        emit({ type: 'question-taken', text });
        emit({ type: 'activity', activity: 'listening' });
        emit({ type: 'activity', activity: 'idle' });
        return true;
      },
      interrupt: () => {
        record.interrupts++;
        emit({ type: 'activity', activity: 'thinking' });
        emit({ type: 'activity', activity: 'idle' });
      },
      setMicrophone: (open: boolean) => {
        record.microphone.push(open);
        return Promise.resolve(open ? (options.microphone ?? 'on') : 'on');
      },
      microphonePermission: () => Promise.resolve(options.permission ?? 'granted'),
      setMicrophoneDevice: (deviceId: string | null) => {
        record.devices.push(deviceId);
        return Promise.resolve();
      },
      setVolume: (volume: number) => {
        record.volume = volume;
      },
      setVision: (vision: { track: MediaStreamTrack; kind: string } | null) => {
        if (vision) {
          tracks.push(vision.track);
          record.visions.push({
            kind: vision.kind,
            label: vision.track.label,
            trackId: vision.track.id,
            canvas: canvasOf(vision.track) !== undefined,
          });
        } else {
          record.visions.push(null);
        }
        return Promise.resolve();
      },
      subscribe: (listener: (event: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
  };
}

/** A character as `/api/characters` answers it; `languages` may be left out, as older servers do. */
export interface ApiCharacter {
  id: string;
  name: string | null;
  languages?: string[];
  portrait?: string | null;
  portraitFull?: string;
  background?: string;
}

/** The app's `/api` answers for one character, Kira. */
export async function routeApi(
  page: Page,
  characters: ApiCharacter[] = [{ id: 'kira-1', name: 'Kira' }],
  charactersDelayMs = 0,
): Promise<void> {
  await page.route('**/api/token', (route) =>
    route.fulfill({ json: { token: 'test-token', endUserId: 'e2e-user' } }),
  );
  await page.route('**/api/characters', async (route) => {
    if (charactersDelayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, charactersDelayMs));
    await route.fulfill({ json: { characters } });
  });
}

/** Installs the fake Convai and the `/api` answers, then opens the app. */
export async function openApp(
  page: Page,
  options: FakeOptions = {},
  characters?: ApiCharacter[],
  charactersDelayMs = 0,
): Promise<void> {
  await routeApi(page, characters, charactersDelayMs);
  await page.addInitScript(install, { options, marker: fakeMarker });
  await page.goto('/');
}

export async function fakeRecord(page: Page): Promise<FakeRecord> {
  return page.evaluate(() => {
    if (!window.fakeConvai) throw new Error('The fake Convai is not installed.');
    return window.fakeConvai.record;
  });
}

export async function emit(page: Page, event: unknown): Promise<void> {
  await page.evaluate((e) => window.fakeConvai?.emit(e), event);
}

export async function answer(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => window.fakeConvai?.answer(t), text);
}
