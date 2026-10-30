import { sentSize, toPixels, type ShareArea, type SurfaceSize } from './area';
import { camerasOf, type Camera } from './camera';
import { ImageError, imageSignature } from './image';

export type DisplayKind = 'screen' | 'window' | 'tab';

/** The browser's media calls the sources use, so tests stand in for them. */
export interface Media {
  /** Whether this browser has a picker for a tab, a window or a screen. */
  canShareDisplay(): boolean;

  display(prefer: DisplayKind, forRegion?: boolean): Promise<MediaStream>;
  /** Draws `area` of a share's picture into a picture of its own, which is what a region publishes. */
  region(source: MediaStream, area: ShareArea): RegionFeed;
  /**
   * Decodes an image file into a picture of its own, upright and over white, which is what an image
   * publishes; rejects with an `ImageError` that says why it cannot be.
   */
  image(file: Blob): Promise<ImageFeed>;
  /** Starts a camera: the chosen device, or the browser's default with null. Never asks for audio. */
  camera(deviceId: string | null): Promise<MediaStream>;
  /** The cameras the browser lists now; it never starts one. */
  cameras(): Promise<Camera[]>;
  /** The camera permission as far as the browser says without asking. */
  cameraPermission(): Promise<'granted' | 'denied' | 'prompt'>;
  /** Calls `listener` when a device comes or goes; returns how to stop. */
  onDevicesChange(listener: () => void): () => void;
  /**
   * A still of the picture running now in `stream`, cut to fill `stillSize` (an image URL), for the
   * transcript's turn picture; null when no picture comes within a second.
   */
  still(stream: MediaStream): Promise<string | null>;
}

export const stillSize: SurfaceSize = { width: 128, height: 80 };

/** The part of a picture of `size` that fills `target`: centred, its aspect kept (as `cover`). */
export function coverCut(
  size: SurfaceSize,
  target: SurfaceSize,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.max(target.width / size.width, target.height / size.height);
  const width = target.width / scale;
  const height = target.height / scale;
  return { x: (size.width - width) / 2, y: (size.height - height) / 2, width, height };
}

/** How long a still waits for the picture before giving up. */
const stillWaitMs = 1000;

async function browserStill(stream: MediaStream): Promise<string | null> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  const picture = new Promise<boolean>((resolve) => {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) resolve(true);
    video.addEventListener(
      'loadeddata',
      () => {
        resolve(true);
      },
      { once: true },
    );
    setTimeout(() => {
      resolve(false);
    }, stillWaitMs);
  });
  try {
    video.play().catch(() => undefined);
    if (!(await picture) || video.videoWidth === 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = stillSize.width;
    canvas.height = stillSize.height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const cut = coverCut({ width: video.videoWidth, height: video.videoHeight }, stillSize);
    context.drawImage(
      video,
      cut.x,
      cut.y,
      cut.width,
      cut.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    video.pause();
    video.srcObject = null;
  }
}

export interface RegionFeed {
  /** The area's own picture: what is published and previewed. */
  readonly stream: MediaStream;
  /**
   * Settles once the first picture is drawn, so the track is published at the area's size; rejects
   * when the share ends first.
   */
  readonly ready: Promise<void>;
  /** The shared surface's size when it was last drawn, in its own pixels; null before the first. */
  surface(): SurfaceSize | null;
  /** Calls `listener` whenever the surface's size changes: a tab that is resized or zoomed. */
  onSurface(listener: (size: SurfaceSize) => void): void;
  /** Stops drawing and the area's own track; the share it is drawn from is the caller's. */
  stop(): void;
}

export interface ImageFeed {
  /** The image's own picture: what is published and previewed. */
  readonly stream: MediaStream;
  /** The picture's size as it is sent. */
  readonly size: SurfaceSize;
  /** Stops drawing and the picture's track. */
  stop(): void;
}

/** How often a region is drawn: as often as the browser's share is asked to give a picture. */
export const regionFramesPerSecond = 15;

function tick(every: number, run: () => void): () => void {
  try {
    const script = `setInterval(() => postMessage(0), ${String(every)});`;
    const address = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
    const worker = new Worker(address);
    URL.revokeObjectURL(address);
    worker.onmessage = run;
    return () => {
      worker.terminate();
    };
  } catch {
    const timer = window.setInterval(run, every);
    return () => {
      window.clearInterval(timer);
    };
  }
}

function browserRegion(source: MediaStream, area: ShareArea): RegionFeed {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = source;
  void video.play().catch(() => undefined);
  const canvas = document.createElement('canvas');
  // A first frame the size of nothing would set the encoder's size: the track waits for `ready`.
  canvas.width = 2;
  canvas.height = 2;
  const context = canvas.getContext('2d', { alpha: false });
  const stream = canvas.captureStream(regionFramesPerSecond);
  const listeners = new Set<(size: SurfaceSize) => void>();
  let surface: SurfaceSize | null = null;
  let drawn: () => void = () => undefined;
  let failed: (error: Error) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    drawn = resolve;
    failed = reject;
  });
  // A feed stopped before anyone waited for it is not an error.
  ready.catch(() => undefined);
  const shared = source.getVideoTracks()[0];
  const onEnded = () => {
    failed(new Error('The share ended before its first picture.'));
  };
  shared?.addEventListener('ended', onEnded);

  const draw = () => {
    if (!context || video.readyState < 2 || video.videoWidth <= 0) return;
    const size = { width: video.videoWidth, height: video.videoHeight };
    if (surface?.width !== size.width || surface.height !== size.height) {
      surface = size;
      for (const listener of [...listeners]) listener(size);
    }
    // The area's pixels on the surface as it is now: a resized tab keeps the same part of itself.
    const part = toPixels(area, size);
    if (!part) return;
    const sent = sentSize(part.width, part.height);
    if (canvas.width !== sent.width || canvas.height !== sent.height) {
      canvas.width = sent.width;
      canvas.height = sent.height;
    }
    context.drawImage(
      video,
      part.x,
      part.y,
      part.width,
      part.height,
      0,
      0,
      sent.width,
      sent.height,
    );
    drawn();
  };
  const stopTick = tick(1000 / regionFramesPerSecond, draw);

  return {
    stream,
    ready,
    surface: () => surface,
    onSurface(listener) {
      listeners.add(listener);
    },
    stop() {
      stopTick();
      listeners.clear();
      shared?.removeEventListener('ended', onEnded);
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
      failed(new Error('The region was stopped.'));
    },
  };
}

/** Reads a file's first bytes: a PNG or a JPEG says so there, whatever its name. */
async function signatureOf(file: Blob): Promise<'png' | 'jpeg' | null> {
  let head: ArrayBuffer;
  try {
    head = await file.slice(0, 4).arrayBuffer();
  } catch {
    throw new ImageError('unreadable');
  }
  return imageSignature(new Uint8Array(head));
}

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      return await createImageBitmap(file);
    } catch {
      // The bytes begin as an image's and are not one: a file cut short or damaged.
      throw new ImageError('unreadable');
    }
  }
}

async function browserImage(file: Blob): Promise<ImageFeed> {
  if (typeof createImageBitmap !== 'function') throw new ImageError('unreadable');
  if (!(await signatureOf(file))) throw new ImageError('not-image');
  const bitmap = await decode(file);
  const size = sentSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    bitmap.close();
    throw new ImageError('unreadable');
  }

  context.fillStyle = 'white';
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const stream = canvas.captureStream(regionFramesPerSecond);
  // Painting a pixel over itself is a new frame for the canvas's track, and changes nothing. A draw,
  // not `putImageData`: putting pixels made the headless shell spend five times the main-thread time.
  const stopTick = tick(1000 / regionFramesPerSecond, () => {
    context.drawImage(canvas, 0, 0, 1, 1, 0, 0, 1, 1);
  });
  return {
    stream,
    size,
    stop() {
      stopTick();
      for (const each of stream.getTracks()) each.stop();
    },
  };
}

const cameraSize = { width: { ideal: 1920 }, height: { ideal: 1080 } };

/** The browser's word for each kind (`displaySurface`). */
const surfaces: Record<DisplayKind, string> = {
  screen: 'monitor',
  window: 'window',
  tab: 'browser',
};

/** What the browser says was shared: "browser" a tab, "monitor" a screen, anything else a window. */
export function displayKindOf(track: MediaStreamTrack): DisplayKind {
  const surface = (track.getSettings() as { displaySurface?: string }).displaySurface;
  return surface === 'browser' ? 'tab' : surface === 'monitor' ? 'screen' : 'window';
}

export const browserMedia: Media = {
  canShareDisplay() {
    const devices = navigator.mediaDevices as MediaDevices | undefined;
    return typeof devices?.getDisplayMedia === 'function';
  },
  display(prefer, forRegion = false) {
    return navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 30 }, displaySurface: surfaces[prefer] },
      audio: false,
      // The app's own tab would show the app sharing itself.
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      preferCurrentTab: false,
      // A whole screen is offered only from "Entire screen…" and "Region…" (a region of it).
      monitorTypeSurfaces: prefer === 'screen' || forRegion ? 'include' : 'exclude',
    } as DisplayMediaStreamOptions);
  },
  region: browserRegion,
  image: browserImage,
  camera(deviceId) {
    return navigator.mediaDevices.getUserMedia({
      video: deviceId ? { ...cameraSize, deviceId: { exact: deviceId } } : cameraSize,
      audio: false,
    });
  },
  async cameras() {
    // Pages served over plain http have no media devices at all.
    const devices = navigator.mediaDevices as MediaDevices | undefined;
    if (!devices) return [];
    return camerasOf(await devices.enumerateDevices());
  },
  async cameraPermission() {
    try {
      return (await navigator.permissions.query({ name: 'camera' })).state;
    } catch {
      return 'prompt';
    }
  },
  onDevicesChange(listener) {
    const devices = navigator.mediaDevices as MediaDevices | undefined;
    devices?.addEventListener('devicechange', listener);
    return () => {
      devices?.removeEventListener('devicechange', listener);
    };
  },
  still: browserStill,
};
