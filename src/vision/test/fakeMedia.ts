import type { ShareArea, SurfaceSize } from '../area';
import type { Camera } from '../camera';
import { ImageError, type ImageRefusal } from '../image';
import type { DisplayKind, ImageFeed, Media, RegionFeed } from '../media';

/**
 * A camera or share track the tests can end as an unplugged device, or the browser's own "Stop
 * sharing" bar, would, and see stopped.
 */
export class FakeTrack extends EventTarget {
  readonly kind = 'video';
  readyState: 'live' | 'ended' = 'live';
  readonly label: string;
  private readonly deviceId: string;
  private readonly surface: string | undefined;

  constructor(label: string, deviceId: string, surface?: string) {
    super();
    this.label = label;
    this.deviceId = deviceId;
    this.surface = surface;
  }

  getSettings(): MediaTrackSettings {
    return this.surface === undefined
      ? { deviceId: this.deviceId }
      : { deviceId: this.deviceId, displaySurface: this.surface };
  }

  stop(): void {
    // As in browsers, stopping a track does not fire `ended`.
    this.readyState = 'ended';
  }

  /** The device went away, or the share was stopped from the browser's bar. */
  unplug(): void {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

/**
 * A region's own picture, driven by hand: `draw` is the first picture coming (ready settles) at the
 * surface's size; `resize` a tab resized while it is shared.
 */
export class FakeRegionFeed implements RegionFeed {
  readonly track: FakeTrack;
  readonly stream: MediaStream;
  readonly ready: Promise<void>;
  readonly source: MediaStream;
  readonly area: ShareArea;
  stopped = false;
  private size: SurfaceSize | null = null;
  private readonly listeners = new Set<(size: SurfaceSize) => void>();
  private settle: () => void = () => undefined;
  private fail: (error: Error) => void = () => undefined;

  constructor(source: MediaStream, area: ShareArea, index: number) {
    this.source = source;
    this.area = area;
    this.track = new FakeTrack(`region:${String(index)}`, `region:${String(index)}`);
    this.stream = streamOf(this.track);
    this.ready = new Promise((resolve, reject) => {
      this.settle = resolve;
      this.fail = reject;
    });
    this.ready.catch(() => undefined);
    source.getVideoTracks()[0]?.addEventListener('ended', () => {
      this.fail(new Error('ended'));
    });
  }

  surface(): SurfaceSize | null {
    return this.size;
  }

  onSurface(listener: (size: SurfaceSize) => void): void {
    this.listeners.add(listener);
  }

  /** The first picture is drawn, from a surface this size. */
  draw(size: SurfaceSize = { width: 1280, height: 800 }): void {
    this.resize(size);
    this.settle();
  }

  /** The shared surface changed size. */
  resize(size: SurfaceSize): void {
    this.size = size;
    for (const listener of [...this.listeners]) listener(size);
  }

  stop(): void {
    this.stopped = true;
    this.track.stop();
    this.fail(new Error('stopped'));
  }
}

function streamOf(track: FakeTrack): MediaStream {
  return {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

/** A still image's picture, decoded by hand. */
export class FakeImageFeed implements ImageFeed {
  readonly track: FakeTrack;
  readonly stream: MediaStream;
  readonly size = { width: 640, height: 480 };
  stopped = false;

  constructor(index: number) {
    this.track = new FakeTrack(`image:${String(index)}`, `image:${String(index)}`);
    this.stream = streamOf(this.track);
  }

  stop(): void {
    this.stopped = true;
    this.track.stop();
  }
}

interface PendingImage {
  file: Blob;
  resolve: (feed: ImageFeed) => void;
  reject: (error: unknown) => void;
}

interface PendingPicker {
  prefer: DisplayKind;
  /** Asked for a region: the picker offers a whole screen too. */
  forRegion: boolean;
  resolve: (stream: MediaStream) => void;
  reject: (error: unknown) => void;
}

interface PendingStart {
  deviceId: string | null;
  resolve: (stream: MediaStream) => void;
  reject: (error: unknown) => void;
}

/**
 * The browser's media, driven by hand: each `camera()` waits until the test answers it, and every
 * track handed out is kept, so a test can check that the camera's light went off.
 */
export class FakeMedia implements Media {
  devices: Camera[] = [
    { id: 'cam-1', label: 'Integrated Camera (04f2:b6dd)' },
    { id: 'cam-2', label: 'Logitech C920 (046d:082d)' },
  ];
  permission: 'granted' | 'denied' | 'prompt' = 'granted';
  readonly tracks: FakeTrack[] = [];
  readonly starts: PendingStart[] = [];
  /** The browser's pickers asked, each waiting for the test's answer. */
  readonly pickers: PendingPicker[] = [];
  /** Every region drawn, oldest first. */
  readonly feeds: FakeRegionFeed[] = [];
  /** The images being decoded, each waiting for the test's answer. */
  readonly decoding: PendingImage[] = [];
  /** Every image decoded, oldest first. */
  readonly images: FakeImageFeed[] = [];
  displaySupported = true;
  private readonly deviceListeners = new Set<() => void>();

  /** Every stream a still was taken of, oldest first. */
  readonly stills: MediaStream[] = [];

  canShareDisplay(): boolean {
    return this.displaySupported;
  }

  still(stream: MediaStream): Promise<string | null> {
    this.stills.push(stream);
    return Promise.resolve(`still:${String(this.stills.length)}`);
  }

  display(prefer: DisplayKind, forRegion = false): Promise<MediaStream> {
    return new Promise((resolve, reject) => {
      this.pickers.push({ prefer, forRegion, resolve, reject });
    });
  }

  region(source: MediaStream, area: ShareArea): RegionFeed {
    const feed = new FakeRegionFeed(source, area, this.feeds.length + 1);
    this.feeds.push(feed);
    return feed;
  }

  image(file: Blob): Promise<ImageFeed> {
    return new Promise((resolve, reject) => {
      this.decoding.push({ file, resolve, reject });
    });
  }

  /** Answers the oldest decoding with its picture. */
  decode(): FakeImageFeed {
    const pending = this.decoding.shift();
    if (!pending) throw new Error('No image is decoding.');
    const feed = new FakeImageFeed(this.images.length + 1);
    this.images.push(feed);
    pending.resolve(feed);
    return feed;
  }

  /** Answers the oldest decoding with why the file is no image. */
  undecodable(refusal: ImageRefusal): void {
    const pending = this.decoding.shift();
    if (!pending) throw new Error('No image is decoding.');
    pending.reject(new ImageError(refusal));
  }

  /** The newest region drawn. */
  get feed(): FakeRegionFeed {
    const feed = this.feeds.at(-1);
    if (!feed) throw new Error('No region is drawn.');
    return feed;
  }

  /** Answers the oldest open picker with what the person chose there ("browser", "window", "monitor"). */
  choose(surface: 'browser' | 'window' | 'monitor'): FakeTrack {
    const picker = this.pickers.shift();
    if (!picker) throw new Error('No picker is open.');
    const track = new FakeTrack(`${surface}:1:0`, `${surface}:1:0`, surface);
    this.tracks.push(track);
    picker.resolve(streamOf(track));
    return track;
  }

  /** Answers the oldest open picker with the browser's error: NotAllowedError when it was closed. */
  closePicker(name = 'NotAllowedError'): void {
    const picker = this.pickers.shift();
    if (!picker) throw new Error('No picker is open.');
    picker.reject(new DOMException('closed', name));
  }

  camera(deviceId: string | null): Promise<MediaStream> {
    return new Promise((resolve, reject) => {
      this.starts.push({ deviceId, resolve, reject });
    });
  }

  cameras(): Promise<Camera[]> {
    return Promise.resolve([...this.devices]);
  }

  cameraPermission(): Promise<'granted' | 'denied' | 'prompt'> {
    return Promise.resolve(this.permission);
  }

  onDevicesChange(listener: () => void): () => void {
    this.deviceListeners.add(listener);
    return () => this.deviceListeners.delete(listener);
  }

  /** Answers the oldest unanswered start with a running camera. */
  open(): FakeTrack {
    const start = this.starts.shift();
    if (!start) throw new Error('No camera start is waiting.');
    const device = this.devices.find((d) => d.id === start.deviceId) ?? this.devices[0];
    const track = new FakeTrack(device?.label ?? 'Camera', device?.id ?? 'default');
    this.tracks.push(track);
    start.resolve(streamOf(track));
    return track;
  }

  /** Answers the oldest unanswered start with the browser's error. */
  refuse(name: string): void {
    const start = this.starts.shift();
    if (!start) throw new Error('No camera start is waiting.');
    start.reject(new DOMException('refused', name));
  }

  devicesChanged(): void {
    for (const listener of [...this.deviceListeners]) listener();
  }
}
