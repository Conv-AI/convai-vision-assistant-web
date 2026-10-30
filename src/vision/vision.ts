import type { NotificationAction } from '../kit/island/notification';
import type { Notices } from '../session/session';
import type { SessionTransport, TransportEvent } from '../session/transport';
import {
  middleHalf,
  sameArea,
  sizeWords,
  toPixels,
  type ShareArea,
  type SurfaceSize,
} from './area';
import { cameraName, cameraProblem, type Camera, type CameraProblem } from './camera';
import { checkImage, ImageError, shownImageName, type FileLike } from './image';
import {
  displayKindOf,
  type DisplayKind,
  type ImageFeed,
  type Media,
  type RegionFeed,
} from './media';
import {
  cameraBackNotice,
  cameraCause,
  cameraNotice,
  imageRefusedNotice,
  nothingChosenNotice,
  nowSharingNotice,
  shareFailedNotice,
  stoppedFromBrowserNotice,
  visionKeys,
} from './notices';

export type Share = 'none' | 'starting' | 'live';

export type SourceKind = 'camera' | DisplayKind | 'region' | 'image';

/** The source being started or shared. */
export interface SharedSource {
  kind: SourceKind;
  /** The camera, once the browser said which one it opened; null for a tab, window or screen. */
  deviceId: string | null;

  name: string;
}

/** The chip's and the transcript's word for each kind. */
export const kindWords: Record<SourceKind, string> = {
  camera: 'Camera',
  screen: 'Screen',
  window: 'Window',
  tab: 'Browser tab',
  region: 'Region',
  image: 'Image',
};

export interface SourceFailure {
  problem: CameraProblem;
  cause: string;
}

export interface Crop {
  /** The browser's whole share. */
  stream: MediaStream;
  /** The area as it is now: the middle half, the area shared now, or the last one's proportions. */
  area: ShareArea;
  /** Opened by "Change area…": giving up keeps the area shared now. */
  change: boolean;
}

export interface VisionState {
  share: Share;
  source: SharedSource | null;
  /** The running picture, for the preview. */
  stream: MediaStream | null;

  showStarting: boolean;

  slow: boolean;
  failure: SourceFailure | null;

  stopped: boolean;
  cameras: readonly Camera[];
  /** The crop open now, or null. */
  crop: Crop | null;

  paused: boolean;
}

/**
 * What the person picked in the source menu. `display` opens the browser's picker, so it must come
 * straight from the person's press.
 */
export type Choice =
  | { kind: 'camera'; deviceId: string | null }
  | { kind: 'display'; prefer: DisplayKind }
  | { kind: 'region' }
  | { kind: 'image'; file: Blob & FileLike; pasted?: boolean }
  | { kind: 'nothing' };

type ImageChoice = Extract<Choice, { kind: 'image' }>;

/** What the sources ask of the window around them: Choose another opens the source menu. */
export type VisionIntent = 'menu';

export interface Conversation {
  isAnswering(): boolean;
  subscribe(listener: () => void): () => void;
}

export interface VisionOptions {
  transport: Pick<SessionTransport, 'setVision' | 'subscribe'>;
  media: Media;
  notices: Notices;
  conversation: Conversation;
  /** The character's name, for the notices' words. */
  name: () => string;

  preferredCamera?: () => string | null;
}

export const visionTiming = {
  /** A start shows its loader on the stage after this long. */
  startingShows: 300,
  /** A start this long says "Taking longer than usual" and offers Cancel. */
  startingSlow: 8000,
  /** Try again on a banner shows its loader at least this long. */
  retryLoader: 600,
} as const;

type TimerName = 'shows' | 'slow' | 'retry';

interface Attempt {
  deviceId: string | null;
  /** The problem the attempt before this one ended with, when this is a Try again. */
  problem?: CameraProblem;
  /** When the Try again was pressed; its answer shows no earlier than 600 ms after. */
  since?: number;
  /** The camera came back after it was unplugged: say so once it runs. */
  back?: boolean;
}

/**
 * The shared source, one at a time: choosing one stops the one before it, a choice made
 * while the character answers waits for the reply to end, and nothing is sent unless it is live.
 * A plain store like the Session: the view reads `state` through `subscribe`.
 */
export class Vision {
  private current: VisionState = {
    share: 'none',
    source: null,
    stream: null,
    showStarting: false,
    slow: false,
    failure: null,
    stopped: false,
    cameras: [],
    crop: null,
    paused: false,
  };
  private readonly listeners = new Set<() => void>();
  private readonly intents = new Set<(intent: VisionIntent) => void>();
  private readonly timers = new Map<TimerName, ReturnType<typeof setTimeout>>();
  private readonly options: VisionOptions;
  private generation = 0;
  /** The transport holds a picture of ours, so ending it must tell the transport. */
  private handedOver = false;
  /** A camera choice made while the character was answering. */
  private pending: Choice | null = null;
  /** A tab, window or screen chosen while the character was answering: shared once the reply ends. */
  private parked: MediaStream | null = null;
  /** Counts the browser's pickers: an answer to one that was overtaken is given back. */
  private asking = 0;
  /** The last attempt that failed, for Try again. */
  private failed: Attempt | null = null;

  private lostDevice: string | null = null;
  private stops: (() => void)[] = [];
  private disposed = false;
  /** The region shared now: the browser's share it is drawn from, its own picture, and its area. */
  private region: { whole: MediaStream; feed: RegionFeed; area: ShareArea } | null = null;
  /** What the browser's share being cropped, or cropped now, is: a failed region's Try again asks it. */
  private regionSurface: DisplayKind = 'tab';

  private keptArea: ShareArea | null = null;
  /** Counts the crops opened, so the end of a share that was already let go of is not told. */
  private cropGeneration = 0;
  /** The image shared now: its picture, and the choice that shared it, for Try again. */
  private image: { feed: ImageFeed; choice: ImageChoice } | null = null;

  private parkedImage: { feed: ImageFeed; choice: ImageChoice } | null = null;

  constructor(options: VisionOptions) {
    this.options = options;
  }

  get state(): VisionState {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onIntent(listener: (intent: VisionIntent) => void): () => void {
    this.intents.add(listener);
    return () => this.intents.delete(listener);
  }

  /** What a question asked now is about, for the transcript's meta line ("Camera · 2:14 PM"). */
  seeing(): string | null {
    const { share, source, paused } = this.current;
    return share === 'live' && !paused && source ? kindWords[source.kind] : null;
  }

  /** A still of what the character sees now, for the question's picture; null when it sees nothing. */
  still(): Promise<string | null> {
    const { share, stream, paused } = this.current;
    if (share !== 'live' || paused || !stream) return Promise.resolve(null);
    return this.options.media.still(stream);
  }

  /** Whether the menu can offer a tab, a window and a screen: the browser has a picker for them. */
  canShareDisplay(): boolean {
    return this.options.media.canShareDisplay();
  }

  /** Listens for devices, the transport and the conversation; lists the cameras. */
  start(): void {
    this.disposed = false;
    const { transport, media, conversation } = this.options;
    this.stops.push(
      transport.subscribe((event) => {
        this.onTransport(event);
      }),
      media.onDevicesChange(() => {
        void this.onDevicesChange();
      }),
      conversation.subscribe(() => {
        this.onConversation();
      }),
    );
    void this.refreshCameras();
  }

  /** Stops the picture and every timer; the camera's light goes off. */
  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.asking++;
    for (const name of [...this.timers.keys()]) this.clear(name);
    for (const stop of this.stops.splice(0)) stop();
    this.unpark();
    this.closeCrop();
    this.release();
  }

  /** Reads the camera list again, as the menu opens. It never starts a camera. */
  async refreshCameras(): Promise<void> {
    const cameras = await this.options.media.cameras();
    if (this.disposed) return;
    this.set({ cameras });
  }

  /** A pick in the source menu, or the stage's action. */
  choose(choice: Choice): void {
    this.lostDevice = null;
    // A newer choice overtakes a picker still open and a share still waiting for the reply.
    this.asking++;
    this.unpark();
    // A crop given up by another choice: a first crop's share ends, a change keeps the area shared.
    this.closeCrop();
    if (choice.kind === 'region') {
      this.pending = null;
      this.askRegion('tab', this.keptArea ?? middleHalf);
      return;
    }
    if (choice.kind === 'nothing') {
      // Stopping is never held back: the picture stops going out at once.
      this.pending = null;
      this.options.notices.close(visionKeys.camera);
      this.options.notices.close(visionKeys.nowSharing);
      this.end(false);
      return;
    }
    if (choice.kind === 'display') {
      this.pending = null;
      this.askDisplay(choice.prefer);
      return;
    }
    if (choice.kind === 'image') {
      this.pending = null;
      this.askImage(choice);
      return;
    }
    const { share, source } = this.current;
    const deviceId = choice.deviceId ?? this.preferredCamera();
    if (
      (share === 'live' || share === 'starting') &&
      source?.deviceId != null &&
      source.deviceId === deviceId
    ) {
      this.pending = null;
      return;
    }

    if (this.options.conversation.isAnswering()) {
      this.pending = choice;
      return;
    }
    void this.startCamera({ deviceId });
  }

  /** The camera Settings chose, while the browser lists it by its id; null otherwise. */
  private preferredCamera(): string | null {
    const id = this.options.preferredCamera?.() ?? null;
    return id !== null && id !== '' && this.current.cameras.some((camera) => camera.id === id)
      ? id
      : null;
  }

  cancel(): void {
    if (this.current.share !== 'starting') return;
    this.end(false);
  }

  /**
   * Whether Pause vision can act: a source is live, the character sees it. That holds while its area
   * is changed too (the region shared stays live meanwhile), and pausing then gives the change up.
   */
  canPause(): boolean {
    const { share, crop, paused } = this.current;
    return share === 'live' && (crop === null || crop.change) && !paused;
  }

  setPaused(paused: boolean): void {
    if (paused) this.pause();
    else this.resume();
  }

  private pause(): void {
    if (!this.canPause()) return;
    // A change of area given up keeps the area shared now: that is what is paused.
    this.closeCrop();
    this.set({ paused: true });
    this.options.notices.close(visionKeys.nowSharing, true);
    if (this.handedOver) {
      this.handedOver = false;
      this.options.transport.setVision(null).catch(() => undefined);
    }
  }

  private resume(): void {
    const { paused, share, source, stream } = this.current;
    if (!paused) return;
    this.set({ paused: false });
    const track = stream?.getVideoTracks()[0];
    if (share !== 'live' || !source || !track) return;
    const generation = this.generation;
    this.handedOver = true;
    this.options.transport
      .setVision({ track, kind: source.kind === 'camera' ? 'camera' : 'screen_share' })
      .catch(() => {
        if (generation === this.generation && !this.current.paused) this.liveFailed();
      });
  }

  // Starting ------------------------------------------------------------------------------------

  private async startCamera(attempt: Attempt): Promise<void> {
    const generation = ++this.generation;
    const { media, transport } = this.options;
    this.pending = null;
    this.failed = null;
    // A picture on the stage gives way to the loader at once: the invitation never flashes between
    // two cameras.
    const replacing = this.current.stream !== null;
    // The source before stops before the next one starts: one at a time.
    this.release();
    this.clear('shows');
    this.clear('slow');
    this.options.notices.close(visionKeys.stoppedFromBrowser);
    this.options.notices.close(visionKeys.nowSharing);
    const known = this.current.cameras.find((c) => c.id === attempt.deviceId);
    this.set({
      share: 'starting',
      source: {
        kind: 'camera',
        deviceId: attempt.deviceId,
        name: known ? cameraName(known.label) : '',
      },
      stream: null,
      showStarting: replacing,
      slow: false,
      failure: null,
      stopped: false,
      paused: false,
    });
    this.later('shows', visionTiming.startingShows, () => {
      this.set({ showStarting: true });
    });
    this.later('slow', visionTiming.startingSlow, () => {
      this.set({ slow: true });
    });

    let stream: MediaStream;
    try {
      stream = await media.camera(attempt.deviceId);
    } catch (error) {
      if (generation !== this.generation) return;
      const permission = await media.cameraPermission();
      if (generation !== this.generation) return;
      this.cameraFailed(cameraProblem(error, permission), attempt);
      return;
    }
    if (generation !== this.generation) {
      stopAll(stream);
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stopAll(stream);
      this.cameraFailed('none', attempt);
      return;
    }
    const deviceId = track.getSettings().deviceId ?? attempt.deviceId;
    track.addEventListener('ended', () => {
      this.onEnded(generation, deviceId);
    });
    this.set({
      source: { kind: 'camera', deviceId, name: cameraName(track.label) },
      stream,
    });

    try {
      this.handedOver = true;
      await transport.setVision({ track, kind: 'camera' });
    } catch {
      if (generation !== this.generation) return;
      this.end(true);
      this.postShareFailed(() => void this.startCamera({ deviceId }));
      return;
    }
    if (generation !== this.generation) return;
    this.clear('shows');
    this.clear('slow');
    // Mint only now: the picture is with the transport.
    this.set({ share: 'live', showStarting: false, slow: false });
    this.options.notices.close(visionKeys.camera);
    if (attempt.back) this.options.notices.post(cameraBackNotice());
    // Once a camera was allowed, the browser names every camera.
    void this.refreshCameras();
  }

  private cameraFailed(problem: CameraProblem, attempt: Attempt): void {
    this.end(problem !== 'not-yet');
    this.failed = { deviceId: attempt.deviceId };
    const show = () => {
      this.set({ failure: { problem, cause: cameraCause(problem, false) } });
      this.options.notices.post(
        cameraNotice({
          ...this.cameraActions(),
          name: this.options.name(),
          problem,
          again: attempt.problem === problem,
          lost: false,
        }),
      );
    };

    const wait = attempt.since === undefined ? 0 : attempt.since + visionTiming.retryLoader - now();
    if (wait > 0) this.later('retry', wait, show);
    else show();
    this.failed.problem = problem;
  }

  /** Try again on a camera banner: the same camera, with the banner's loader meanwhile. */
  private retryCamera(): void {
    const failed = this.failed;
    if (!failed || this.current.share !== 'none') return;
    const { problem } = failed;
    if (problem) {
      this.options.notices.post(
        cameraNotice({
          ...this.cameraActions(),
          name: this.options.name(),
          problem,
          again: false,
          lost: false,
          working: true,
        }),
      );
    }
    void this.startCamera({ deviceId: failed.deviceId, problem, since: now() });
  }

  private cameraActions(): {
    retry: NotificationAction;
    chooseAnother: NotificationAction;
  } {
    return {
      retry: {
        label: 'Try again',
        run: () => {
          this.retryCamera();
        },
      },
      chooseAnother: {
        label: 'Choose another',
        run: () => {
          this.set({ failure: null });
          for (const listener of [...this.intents]) listener('menu');
        },
      },
    };
  }

  /** A picture the service would not take, or a share the browser could not start. */
  private postShareFailed(retry: () => void): void {
    this.options.notices.post(
      shareFailedNotice(
        this.options.name(),
        { label: 'Try again', run: retry },
        {
          label: 'Choose another',
          run: () => {
            for (const listener of [...this.intents]) listener('menu');
          },
        },
      ),
    );
  }

  // A tab, a window or a screen -------------------------------------------------------------------

  private askDisplay(prefer: DisplayKind): void {
    const asked = ++this.asking;
    let answer: Promise<MediaStream>;
    try {
      answer = this.options.media.display(prefer);
    } catch (error) {
      answer = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    answer.then(
      (stream) => {
        if (asked !== this.asking || this.disposed) {
          stopAll(stream);
          return;
        }
        if (this.options.conversation.isAnswering()) {
          this.park(stream);
          return;
        }
        void this.startDisplay(stream);
      },
      (error: unknown) => {
        if (asked !== this.asking || this.disposed) return;
        this.displayRefused(error, () => {
          this.askDisplay(prefer);
        });
      },
    );
  }

  /** The picker closed without a choice, or the browser could not share what was chosen. */
  private displayRefused(error: unknown, retry: () => void): void {
    const name = error instanceof DOMException || error instanceof Error ? error.name : '';
    if (name === 'NotAllowedError' || name === 'AbortError') {
      if (this.current.share === 'none') this.options.notices.post(nothingChosenNotice());
      return;
    }

    if (this.current.share === 'none') this.set({ stopped: true });
    this.postShareFailed(retry);
  }

  /** Holds a chosen share until the reply ends; stopped from the browser meanwhile, it is dropped. */
  private park(stream: MediaStream): void {
    this.unpark();
    this.parked = stream;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (this.parked === stream) this.unpark();
    });
  }

  private unpark(): void {
    const stream = this.parked;
    this.parked = null;
    if (stream) stopAll(stream);
    const image = this.parkedImage;
    this.parkedImage = null;
    image?.feed.stop();
  }

  private async startDisplay(stream: MediaStream): Promise<void> {
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stopAll(stream);
      return;
    }
    const generation = ++this.generation;
    this.pending = null;
    this.failed = null;
    // The source before stops before the next one starts: one at a time.
    this.release();
    this.clear('shows');
    this.clear('slow');
    this.clear('retry');
    // The kind is what the browser says was chosen, whichever row asked: a tab row can give a window.
    const kind = displayKindOf(track);
    this.options.notices.close(visionKeys.camera);
    this.options.notices.close(visionKeys.stoppedFromBrowser);
    this.set({
      share: 'starting',
      source: { kind, deviceId: null, name: '' },
      stream,
      showStarting: false,
      slow: false,
      failure: null,
      stopped: false,
      paused: false,
    });
    track.addEventListener('ended', () => {
      this.onDisplayEnded(generation);
    });
    this.later('slow', visionTiming.startingSlow, () => {
      this.set({ slow: true });
    });

    try {
      this.handedOver = true;
      await this.options.transport.setVision({ track, kind: 'screen_share' });
    } catch {
      if (generation !== this.generation) return;
      this.end(true);
      this.postShareFailed(() => {
        this.askDisplay(kind);
      });
      return;
    }
    if (generation !== this.generation) return;
    this.clear('slow');
    this.set({ share: 'live', slow: false });
    this.options.notices.post(nowSharingNotice(kindWords[kind]));
  }

  private onDisplayEnded(generation: number): void {
    if (generation !== this.generation) return;
    this.end(true);
    this.options.notices.close(visionKeys.nowSharing);
    this.options.notices.post(stoppedFromBrowserNotice());
  }

  private askImage(choice: ImageChoice): void {
    const refusal = checkImage(choice.file);
    if (refusal) {
      this.postRefused(refusal);
      return;
    }
    const asked = ++this.asking;
    let decoded: Promise<ImageFeed>;
    try {
      decoded = this.options.media.image(choice.file);
    } catch (error) {
      decoded = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    decoded.then(
      (feed) => {
        if (asked !== this.asking || this.disposed) {
          feed.stop();
          return;
        }
        if (this.options.conversation.isAnswering()) {
          this.unpark();
          this.parkedImage = { feed, choice };
          return;
        }
        void this.startImage(feed, choice);
      },
      (error: unknown) => {
        if (asked !== this.asking || this.disposed) return;
        this.postRefused(error instanceof ImageError ? error.refusal : 'unreadable');
      },
    );
  }

  private postRefused(refusal: ImageError['refusal']): void {
    this.options.notices.post(imageRefusedNotice(refusal));
  }

  private async startImage(feed: ImageFeed, choice: ImageChoice): Promise<void> {
    const track = feed.stream.getVideoTracks()[0];
    if (!track) {
      feed.stop();
      return;
    }
    const generation = ++this.generation;
    this.pending = null;
    this.failed = null;
    // The source before stops before the next one starts: one at a time.
    this.release();
    this.clear('shows');
    this.clear('slow');
    this.clear('retry');
    this.options.notices.close(visionKeys.camera);
    this.options.notices.close(visionKeys.stoppedFromBrowser);
    this.options.notices.close(visionKeys.nowSharing);
    this.image = { feed, choice };
    this.set({
      share: 'starting',
      source: {
        kind: 'image',
        deviceId: null,
        name: shownImageName(choice.file.name, choice.pasted === true),
      },
      stream: feed.stream,
      showStarting: false,
      slow: false,
      failure: null,
      stopped: false,
      paused: false,
    });
    try {
      this.handedOver = true;
      await this.options.transport.setVision({ track, kind: 'screen_share' });
    } catch {
      if (generation !== this.generation) return;
      this.end(true);
      this.postShareFailed(() => {
        this.choose(choice);
      });
      return;
    }
    if (generation !== this.generation) return;
    this.set({ share: 'live' });
  }

  /**
   * Region…, and Share again… on a region: the browser's picker in the press, then the crop in place on
   * what it gives, with `area` drawn. What was shared stays until the person chooses there.
   */
  private askRegion(prefer: DisplayKind, area: ShareArea): void {
    const asked = ++this.asking;
    let answer: Promise<MediaStream>;
    try {
      answer = this.options.media.display(prefer, true);
    } catch (error) {
      answer = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    answer.then(
      (stream) => {
        if (asked !== this.asking || this.disposed) {
          stopAll(stream);
          return;
        }
        this.openCrop(stream, area);
      },
      (error: unknown) => {
        if (asked !== this.asking || this.disposed) return;
        this.displayRefused(error, () => {
          this.askRegion(prefer, area);
        });
      },
    );
  }

  private openCrop(stream: MediaStream, area: ShareArea): void {
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stopAll(stream);
      return;
    }
    this.pending = null;
    this.failed = null;
    this.end(false);
    this.options.notices.close(visionKeys.camera);
    this.options.notices.close(visionKeys.stoppedFromBrowser);
    this.options.notices.close(visionKeys.nowSharing);
    this.regionSurface = displayKindOf(track);
    const generation = ++this.cropGeneration;
    track.addEventListener('ended', () => {
      if (generation === this.cropGeneration) this.cropShareEnded();
    });
    this.set({ crop: { stream, area, change: false } });
  }

  changeArea(): void {
    const region = this.region;
    if (!region || !this.canChangeArea()) return;
    this.cropGeneration++;
    this.options.notices.close(visionKeys.nowSharing);
    this.set({ crop: { stream: region.whole, area: region.area, change: true } });
  }

  /** Whether "Change area…" can open the crop: a region is shared and no crop is open. */
  canChangeArea(): boolean {
    // Paused, a new area would go out unpaused: Resume comes first.
    return (
      this.region !== null &&
      this.current.share === 'live' &&
      this.current.crop === null &&
      !this.current.paused
    );
  }

  /** The area as the person drags it: kept, so Share again… after a lost share draws it. */
  moveArea(area: ShareArea): void {
    const crop = this.current.crop;
    if (!crop || sameArea(crop.area, area)) return;
    this.set({ crop: { ...crop, area } });
  }

  /**
   * "Share area" (or Return): the area becomes what the character sees, named by what it measures.
   * On a change, an area that did not move closes the crop and leaves the region as it is.
   */
  shareArea(): void {
    const crop = this.current.crop;
    if (!crop) return;
    this.cropGeneration++;
    const region = this.region;
    if (crop.change && region && sameArea(region.area, crop.area)) {
      this.set({ crop: null });
      return;
    }
    void this.startRegion(crop.stream, crop.area, crop.change);
  }

  cancelCrop(): void {
    this.closeCrop();
  }

  private closeCrop(): void {
    const crop = this.current.crop;
    if (!crop) return;
    this.cropGeneration++;
    this.set({ crop: null });
    if (!crop.change) stopAll(crop.stream);
  }

  /**
   * The share being cropped was stopped from the browser's own bar. On a first crop the Island says
   * so, with Share again…, which asks the picker and crops again with the area drawn so far. While an
   * area is changed, the region shared from it ends too, and says so itself (`onRegionEnded`).
   */
  private cropShareEnded(): void {
    const crop = this.current.crop;
    if (!crop || crop.change) return;
    this.cropGeneration++;
    this.set({ crop: null, stopped: true });
    stopAll(crop.stream);
    this.postStopped(crop.area);
  }

  private postStopped(area: ShareArea): void {
    this.keptArea = area;
    this.options.notices.post(stoppedFromBrowserNotice());
  }

  /**
   * The area's own picture is drawn, then handed to the transport as a screen share. A first crop
   * starts from nothing shared; on a change the area before stays live until the new one is handed
   * over, and the browser's share is never ended.
   */
  private async startRegion(whole: MediaStream, area: ShareArea, change: boolean): Promise<void> {
    const shared = whole.getVideoTracks()[0];
    if (!shared) return;
    const generation = ++this.generation;
    this.pending = null;
    this.failed = null;
    this.keptArea = null;
    const before = this.region;
    if (!change) {
      // The crop's share becomes the region's: ending the share ends the region.
      shared.addEventListener('ended', () => {
        this.onRegionEnded(whole);
      });
    }
    const feed = this.options.media.region(whole, area);
    const name = (size: SurfaceSize | null) => {
      const pixels = size ? toPixels(area, size) : null;
      return pixels ? sizeWords(pixels.width, pixels.height) : '';
    };
    this.region = { whole, feed, area };
    feed.onSurface((size) => {
      const source = this.current.source;
      if (this.region?.feed !== feed || source?.kind !== 'region') return;
      this.set({ source: { ...source, name: name(size) } });
    });
    if (change) {
      this.set({ crop: null });
    } else {
      this.set({
        share: 'starting',
        source: { kind: 'region', deviceId: null, name: '' },
        stream: feed.stream,
        showStarting: false,
        slow: false,
        failure: null,
        stopped: false,
        crop: null,
        paused: false,
      });
      this.later('slow', visionTiming.startingSlow, () => {
        this.set({ slow: true });
      });
    }

    const track = feed.stream.getVideoTracks()[0];
    // The area before is drawn until the new one is with the transport, and stops however this ends:
    // nothing else holds it once the new one is the region.
    const dropBefore = () => {
      if (before && before.feed !== feed) before.feed.stop();
    };
    try {
      await feed.ready;
      if (generation !== this.generation) {
        dropBefore();
        return;
      }
      if (!track) throw new Error('The region has no picture.');
      this.handedOver = true;
      await this.options.transport.setVision({ track, kind: 'screen_share' });
    } catch {
      dropBefore();
      if (generation !== this.generation) return;
      // The share ended before its first picture: that is told as its end (onRegionEnded).
      if (shared.readyState === 'ended') return;
      this.end(true);
      this.postShareFailed(() => {
        this.askRegion(this.regionSurface, area);
      });
      return;
    }
    dropBefore();
    if (generation !== this.generation) return;
    this.clear('slow');
    this.set({
      share: 'live',
      slow: false,
      source: { kind: 'region', deviceId: null, name: name(feed.surface()) },
      stream: feed.stream,
    });
    this.options.notices.post(nowSharingNotice(kindWords.region));
  }

  private onRegionEnded(whole: MediaStream): void {
    const region = this.region;
    if (region?.whole !== whole) return;
    const crop = this.current.crop;
    const area = crop?.change ? crop.area : region.area;
    this.cropGeneration++;
    this.set({ crop: null });
    this.end(true);
    this.options.notices.close(visionKeys.nowSharing);
    this.postStopped(area);
  }

  // While shared --------------------------------------------------------------------------------

  private onEnded(generation: number, deviceId: string | null): void {
    if (generation !== this.generation) return;
    this.end(true);
    this.lostDevice = deviceId;

    this.set({ failure: { problem: 'none', cause: cameraCause('none', true) } });
    this.options.notices.post(
      cameraNotice({
        ...this.cameraActions(),
        name: this.options.name(),
        problem: 'none',
        again: false,
        lost: true,
      }),
    );
  }

  private async onDevicesChange(): Promise<void> {
    await this.refreshCameras();
    const lost = this.lostDevice;
    if (lost === null || this.current.share !== 'none') return;
    if (!this.current.cameras.some((camera) => camera.id === lost)) return;
    this.lostDevice = null;
    this.options.notices.close(visionKeys.camera);
    void this.startCamera({ deviceId: lost, back: true });
  }

  private onConversation(): void {
    const parked = this.parked;
    if (parked && !this.options.conversation.isAnswering()) {
      this.parked = null;
      void this.startDisplay(parked);
      return;
    }
    const image = this.parkedImage;
    if (image && !this.options.conversation.isAnswering()) {
      this.parkedImage = null;
      void this.startImage(image.feed, image.choice);
      return;
    }
    const choice = this.pending;
    if (!choice || this.options.conversation.isAnswering()) return;
    this.pending = null;
    this.choose(choice);
  }

  private onTransport(event: TransportEvent): void {
    const source = this.current.source;
    if (event.type !== 'vision-failed' || this.current.share !== 'live' || !source) return;
    // Paused, nothing is with the transport: there is nothing that could fail.
    if (this.current.paused) return;
    this.liveFailed();
  }

  /** The live picture could not go out: nothing is shared, and Try again starts the same source. */
  private liveFailed(): void {
    const source = this.current.source;
    if (!source) return;
    const { kind, deviceId } = source;
    const area = this.region?.area ?? middleHalf;
    const image = this.image?.choice;
    this.end(true);
    let retry: () => void;
    if (kind === 'camera') retry = () => void this.startCamera({ deviceId });
    else if (kind === 'region')
      retry = () => {
        this.askRegion(this.regionSurface, area);
      };
    else if (kind === 'image')
      retry = () => {
        if (image) this.choose(image);
      };
    else
      retry = () => {
        this.askDisplay(kind);
      };
    this.postShareFailed(retry);
  }

  // Plumbing ------------------------------------------------------------------------------------

  /** Back to nothing shared; `stopped` when the share ended by itself. */
  private end(stopped: boolean): void {
    this.generation++;
    this.clear('shows');
    this.clear('slow');
    this.clear('retry');
    this.release();
    this.set({
      share: 'none',
      source: null,
      stream: null,
      showStarting: false,
      slow: false,
      failure: null,
      stopped,
      paused: false,
    });
  }

  /** Takes the picture back from the transport and stops the camera, or the region and its share. */
  private release(): void {
    if (this.handedOver) {
      this.handedOver = false;
      this.options.transport.setVision(null).catch(() => undefined);
    }
    const stream = this.current.stream;
    if (stream) stopAll(stream);
    const region = this.region;
    this.region = null;
    if (region) {
      region.feed.stop();
      stopAll(region.whole);
    }
    const image = this.image;
    this.image = null;
    image?.feed.stop();
  }

  private set(change: Partial<VisionState>): void {
    this.current = { ...this.current, ...change };
    for (const listener of [...this.listeners]) listener();
  }

  private later(name: TimerName, ms: number, run: () => void): void {
    this.clear(name);
    this.timers.set(
      name,
      setTimeout(() => {
        this.timers.delete(name);
        if (!this.disposed) run();
      }, ms),
    );
  }

  private clear(name: TimerName): void {
    const timer = this.timers.get(name);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(name);
  }
}

function stopAll(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function now(): number {
  return Date.now();
}
