import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { Button } from '../kit/controls/Button';
import { Lens } from '../kit/lens/Lens';
import {
  AreaSelection,
  sizeWords,
  toPixels,
  type ShareArea,
  type Grip,
  type SurfaceSize,
} from '../vision/area';
import { visionTiming } from '../vision/vision';
import type { Crop } from '../vision/vision';
import {
  barRoom,
  cropBarTop,
  cropCopy,
  cropHint,
  cropMarks,
  cropPicturePlace,
  handleCentres,
  hintForm,
  readoutPlace,
  type Rect,
} from './crop';
import type { TranscriptPlace } from './layout';
import { measureWith, useTextScale } from './measure';
import { fitFrame } from './preview';

interface RegionCropProps {
  crop: Crop;
  place: TranscriptPlace;
  floatRight: number;
  stageWidth: number;
  /** The stage, whose Island's notice the bar stands under. */
  stage: RefObject<HTMLDivElement | null>;
  /** A request stands over the crop: "Share area" gives way to it, one white button on screen (15b 3). */
  requestShows: boolean;
  onArea: (area: Crop['area']) => void;
  onShare: () => void;
  onCancel: () => void;
}

/** A surface's size before its first picture: the frame stands where a 16:9 one will, so nothing moves. */
const assumedSurface: SurfaceSize = { width: 1920, height: 1080 };

/** What a screen reader hears of the area, once as the picture comes and after each gesture. */
function spokenSize(area: ShareArea, surface: SurfaceSize): string {
  const pixels = toPixels(area, surface);
  return pixels ? `Area ${String(pixels.width)} by ${String(pixels.height)} pixels` : '';
}

/** Each press's cursor: what the press would take hold of. */
const cursors: Record<Grip, string> = {
  none: 'crosshair',
  new: 'crosshair',
  move: 'move',
  'top-left': 'nwse-resize',
  'bottom-right': 'nwse-resize',
  'top-right': 'nesw-resize',
  'bottom-left': 'nesw-resize',
};

/** The bottom of the notice standing in the Island's place, from the stage's top; null when none. */
function useNoticeBottom(stage: RefObject<HTMLDivElement | null>): number | null {
  const [bottom, setBottom] = useState<number | null>(null);
  useEffect(() => {
    const root = stage.current;
    const surface = root?.querySelector<HTMLElement>('.va-stage__island .convai-island__surface');
    if (!root || !surface) return;
    const measure = () => {
      const next = surface.hidden
        ? null
        : surface.getBoundingClientRect().bottom - root.getBoundingClientRect().top;
      setBottom((current) =>
        current === next || (current !== null && next !== null && Math.abs(current - next) < 0.5)
          ? current
          : next,
      );
    };
    // Shown, hidden (its size goes to nothing) or grown to two lines: its bottom moves. The observer
    // also answers once as it starts.
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    return () => {
      observer.disconnect();
    };
  }, [stage]);
  return bottom;
}

/** The size of an element, re-measured whenever it changes. */
function useSize(): [RefObject<HTMLDivElement | null>, SurfaceSize | null] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<SurfaceSize | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setSize((current) =>
        current?.width === next.width && current.height === next.height ? current : next,
      );
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, size];
}

/** The browser's whole share, for the person's eyes alone; it says its own size as it comes. */
function WholePicture({
  stream,
  onSize,
}: {
  stream: MediaStream;
  onSize: (size: SurfaceSize) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const report = useEffectEvent(() => {
    const element = video.current;
    if (element && element.videoWidth > 0) {
      onSize({ width: element.videoWidth, height: element.videoHeight });
    }
  });
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = stream;
    // A tab that is resized or zoomed while it is cropped changes the picture's size: "resize".
    element.addEventListener('loadedmetadata', report);
    element.addEventListener('resize', report);
    return () => {
      element.removeEventListener('loadedmetadata', report);
      element.removeEventListener('resize', report);
      element.srcObject = null;
    };
  }, [stream]);
  return (
    <video ref={video} className="va-crop__video" autoPlay muted playsInline aria-hidden="true" />
  );
}

export function RegionCrop({
  crop,
  place,
  floatRight,
  stageWidth,
  stage,
  requestShows,
  onArea,
  onShare,
  onCancel,
}: RegionCropProps) {
  const scale = useTextScale();
  const noticeBottom = useNoticeBottom(stage);
  const barTop = cropBarTop(noticeBottom);
  const room = cropPicturePlace(barTop, place, scale, floatRight);
  const [roomRef, roomSize] = useSize();
  const [surface, setSurface] = useState<SurfaceSize | null>(null);
  // The gesture's own state, from the area the crop opens with.
  const [chosen] = useState(() => new AreaSelection(crop.area));
  const [cursor, setCursor] = useState(cursors.new);
  const shareButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [spoken, setSpoken] = useState('');
  const [slow, setSlow] = useState(false);
  const sizeId = useId();
  const waiting = surface === null;

  const frame = fitFrame(roomSize ?? { width: 0, height: 0 }, surface ?? assumedSurface);
  const area = crop.area;
  const areaRect: Rect = {
    x: area.x * frame.width,
    y: area.y * frame.height,
    width: area.width * frame.width,
    height: area.height * frame.height,
  };
  const pixels = surface ? toPixels(area, surface) : null;
  const readout = pixels ? sizeWords(pixels.width, pixels.height) : '';
  const readoutFont = measureWith(`600 ${String(12 * scale)}px Inter`);
  const chip = { width: readoutFont(readout) + 24, height: 28 };
  const readoutAt = readoutPlace(areaRect, chip, frame);
  const handles = handleCentres(areaRect, frame);

  const lineFont = measureWith(`400 ${String(14 * scale)}px Inter`);
  const buttonFont = measureWith(`600 ${String(14 * scale)}px Inter`);
  const widths = {
    whole: lineFont(cropHint.whole),
    short: lineFont(cropHint.short),
    cancel: buttonFont(cropCopy.cancel) + 36,
    share: buttonFont(cropCopy.share) + 36,
  };
  const form = hintForm(barRoom(stageWidth - floatRight), widths);
  const kept = form === 'whole' ? widths.whole : form === 'short' ? widths.short : 0;
  const line =
    form === 'none'
      ? ''
      : waiting
        ? lineFont(cropHint.waiting) <= kept
          ? cropHint.waiting
          : ''
        : cropHint[form];

  useLayoutEffect(() => {
    if (waiting) {
      cancelButton.current?.focus();
      return;
    }
    const active = document.activeElement;
    if (active === cancelButton.current || active === document.body || active === null) {
      shareButton.current?.focus();
    }
  }, [waiting]);

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => {
      setSlow(true);
    }, visionTiming.startingSlow);
    return () => {
      window.clearTimeout(timer);
    };
  }, [waiting]);

  const pictureCame = (size: SurfaceSize) => {
    if (surface === null) setSpoken(spokenSize(crop.area, size));
    setSurface(size);
  };

  /** The pointer's place on the surface, in its pixels; null before the first picture. */
  const onSurface = (event: ReactPointerEvent<HTMLElement>) => {
    const target = roomRef.current;
    if (!surface || !target || frame.width <= 0) return null;
    const box = target.getBoundingClientRect();
    const perPoint = surface.width / frame.width;
    return {
      x: (event.clientX - box.left - frame.x) * perPoint,
      y: (event.clientY - box.top - frame.y) * perPoint,
      reach: cropMarks.reach * perPoint,
    };
  };

  const press = (event: ReactPointerEvent<HTMLElement>) => {
    const at = onSurface(event);
    if (!at || !surface || event.button !== 0) return;
    // The focus stays where it was ("Share area"), so Return shares the area just dragged.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    chosen.press(at.x, at.y, surface, at.reach);
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const at = onSurface(event);
    if (!at || !surface) return;
    if (chosen.grip === 'none') {
      setCursor(cursors[chosen.gripAt(at.x, at.y, surface, at.reach)]);
      return;
    }
    if (chosen.dragTo(at.x, at.y, surface)) onArea(chosen.area);
  };
  const release = () => {
    if (!surface || chosen.grip === 'none') return;
    chosen.release(surface);
    onArea(chosen.area);
    setSpoken(spokenSize(chosen.area, surface));
  };
  const letGo = () => {
    chosen.abandon();
    onArea(chosen.area);
  };

  // Never disabled during a drag: a disabled button lets go of the focus, and Return would not share.
  const canShare = !waiting && pixels !== null;

  return (
    <div className="va-crop" role="group" aria-label="Choose an area">
      {/* Said once as the picture comes and after each gesture, never while the hand moves. */}
      <span id={sizeId} className="convai-visually-hidden" role="status">
        {spoken}
      </span>
      <div className="va-crop__bar-row" style={{ top: barTop, right: floatRight }}>
        <div className="va-crop__bar">
          {line !== '' && (
            // While waiting, the shorter line stands in the room the line will have, against Cancel.
            <p className="va-crop__line" style={{ minWidth: kept }}>
              {line}
            </p>
          )}
          <Button ref={cancelButton} kind="text" shape="capsule" size="large" onClick={onCancel}>
            {cropCopy.cancel}
          </Button>
          <Button
            ref={shareButton}
            kind={requestShows ? 'secondary' : 'primary'}
            shape="capsule"
            size="large"
            disabled={!canShare}
            aria-describedby={sizeId}
            onClick={onShare}
          >
            {cropCopy.share}
          </Button>
        </div>
      </div>
      <div
        ref={roomRef}
        className="va-crop__room"
        style={{ top: room.top, right: room.right, bottom: room.bottom, left: room.left }}
      >
        <div
          className="va-crop__frame"
          data-waiting={waiting || undefined}
          style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height, cursor }}
          onPointerDown={press}
          onPointerMove={move}
          onPointerUp={release}
          onPointerCancel={letGo}
          onLostPointerCapture={release}
        >
          <WholePicture stream={crop.stream} onSize={pictureCame} />
          {waiting ? (
            <div className="va-crop__waiting" role="status">
              <Lens name="" state="connecting" size={32} decorative />
              <p className="va-crop__waiting-title">{cropCopy.waiting}</p>
              {slow && <p className="va-crop__waiting-line">{cropCopy.slow}</p>}
            </div>
          ) : (
            <>
              <div
                className="va-crop__area"
                style={{
                  left: areaRect.x,
                  top: areaRect.y,
                  width: areaRect.width,
                  height: areaRect.height,
                }}
              />
              <div className="va-crop__edge" style={edgeBox(areaRect, frame)} aria-hidden="true" />
              {handles.map((handle, i) => (
                <span
                  key={i}
                  className="va-crop__handle"
                  style={{ left: handle.x, top: handle.y }}
                  aria-hidden="true"
                />
              ))}
              {readout !== '' && (
                <p
                  className="va-crop__readout"
                  style={{ left: readoutAt.x, top: readoutAt.y }}
                  aria-hidden="true"
                >
                  {readout}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The edge's box: the area grown by the edge and its hairline, so both stand outside it, kept inside
 * the picture, so an area on the picture's edge draws them inside itself rather than lose them.
 */
function edgeBox(area: Rect, frame: { width: number; height: number }) {
  const out = cropMarks.edge + cropMarks.hairline;
  const left = Math.max(0, area.x - out);
  const top = Math.max(0, area.y - out);
  const right = Math.min(frame.width, area.x + area.width + out);
  const bottom = Math.min(frame.height, area.y + area.height + out);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
