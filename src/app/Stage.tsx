import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { Button } from '../kit/controls/Button';
import { Tooltip } from '../kit/controls/Tooltip';
import { Icon } from '../kit/icons';
import { Lens } from '../kit/lens/Lens';
import type { Overlay, SessionState } from '../session/session';
import { lastTurn, type TranscriptItem, type Turn } from '../session/turns';
import { captionFor, captionWidth, pageAt, pages, questionLine } from './captions';
import { launchCopy } from './copy';
import type { CaptionMode, TranscriptPlace } from './layout';
import { useMeasure, useTextScale } from './measure';
import { fitFrame, lineForm, lineLeft, previewPlace, type PreviewLine } from './preview';
import { useHeldStill } from './hooks';
import { Portrait } from './Portrait';
import { CameraPicture } from './SourceChip';

interface LaunchProps {
  overlay: Overlay;
  name: string;
  state: Pick<SessionState, 'slow' | 'failure' | 'failureMessage'>;

  portrait?: string | null;

  line?: string;
  onRetry: () => void;
}

export function Launch({ overlay, name, state, portrait = null, line, onRetry }: LaunchProps) {
  const copy = launchCopy(overlay, name, state);
  const action = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const button = action.current;
    if (!button) return;
    // Try again takes the focus only where nothing else holds it (it went with the capsule, or the
    // app has just started), never out of the transcript, a menu or a dialog.
    const held = button.ownerDocument.activeElement;
    const stage = button.closest('.va-stage');
    if (held === null || held === button.ownerDocument.body || stage?.contains(held))
      button.focus();
  }, [overlay]);
  if (overlay === 'switching') {
    return (
      <div className="va-launch va-launch--switching" role="status">
        {portrait !== null && (
          <div className="va-launch__portrait" aria-hidden="true">
            <Portrait src={portrait}>{null}</Portrait>
          </div>
        )}
        {portrait !== null && <div className="va-launch__fade" aria-hidden="true" />}
        <div className="va-launch__words va-launch__words--switching">
          <p className="va-launch__kicker">{copy.kicker}</p>
          <p className="va-launch__title--name">{copy.title}</p>
          {line && <p className="va-launch__body">{line}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="va-launch" role={overlay === 'failed' ? 'alert' : undefined}>
      {overlay !== 'failed' && (
        <Lens
          name={name}
          state={overlay === 'boot' ? 'ready' : 'connecting'}
          size={96}
          decorative
        />
      )}
      {copy.title && (
        <div
          className="va-launch__words"

          role={overlay === 'connecting' ? 'status' : undefined}
          data-shown={overlay === 'connecting' ? state.slow : undefined}
        >
          <p className={overlay === 'failed' ? 'va-launch__title--large' : 'va-launch__title'}>
            {copy.title}
          </p>
          {copy.body && <p className="va-launch__body">{copy.body}</p>}
        </div>
      )}
      {copy.action && (
        <Button ref={action} kind="primary" shape="capsule" size="large" onClick={onRetry}>
          {copy.action}
        </Button>
      )}
    </div>
  );
}

interface NothingSharedProps {
  name: string;

  stopped: boolean;

  underBanner?: boolean;
  /** Opens the source menu. */
  onChoose: () => void;
}

export function NothingShared({
  name,
  stopped,
  underBanner = false,
  onChoose,
}: NothingSharedProps) {
  return (
    <div className={underBanner ? 'va-nothing va-nothing--under-banner' : 'va-nothing'}>
      <p className="va-nothing__title">{stopped ? 'Sharing stopped' : `Show ${name} something`}</p>
      {/* The invitation's two sentences, two lines (D12): the break never falls inside the second.
          "Sharing stopped" has one sentence, on one line where it fits (H11). */}
      <p className="va-nothing__line">
        {stopped ? (
          <span>Choose something new, or just keep talking.</span>
        ) : (
          <>
            <span>Share your camera, a window or your screen.</span>{' '}
            <span>Voice and text work without it.</span>
          </>
        )}
      </p>
      <Button kind="primary" shape="capsule" size="large" onClick={onChoose}>
        Choose what {name} sees
      </Button>
    </div>
  );
}

interface StartingProps {
  slow: boolean;
  onCancel: () => void;
}

export function StartingSource({ slow, onCancel }: StartingProps) {
  return (
    <div className="va-nothing va-starting" role="status">
      <Lens name="" state="connecting" size={32} decorative />
      <p className="va-starting__title">Starting the camera…</p>
      {slow && (
        <>
          <p className="va-starting__line">Taking longer than usual</p>
          <Button shape="capsule" onClick={onCancel}>
            Cancel
          </Button>
        </>
      )}
    </div>
  );
}

export interface PauseControl {
  /** The key as the person reads it ("Alt V", "⌥ V"), on Resume's cap. */
  keyLabel: string;
  /** The key in ARIA's words ("Alt+V"). */
  keyShortcuts: string;
  onResume: () => void;
}

function PausedPill({ pause }: { pause: PauseControl }) {
  return (
    <div className="va-paused__pill">
      <Icon name="view-off" />
      <span className="va-paused__words">Vision paused</span>
      <Tooltip text="Resume vision" shortcut={pause.keyLabel}>
        <Button
          kind="primary"
          shape="capsule"
          keyCap={pause.keyLabel}
          aria-keyshortcuts={pause.keyShortcuts}
          onClick={pause.onResume}
        >
          {/* Named "Resume vision", which starts with the word shown (WCAG 2.5.3, Label in Name). */}
          <span aria-hidden="true">Resume</span>
          <span className="convai-visually-hidden">Resume vision</span>
        </Button>
      </Tooltip>
    </div>
  );
}

export function CameraStage({
  stream,
  pause,
}: {
  stream: MediaStream;
  /** Vision is paused: the veil and its way back. */
  pause: PauseControl | null;
}) {
  return (
    <div className="va-camera">
      <CameraPicture stream={stream} className="va-camera__video" still={pause !== null} />
      <span className="va-camera__scrim" aria-hidden="true" />
      {pause ? (
        <div className="va-paused va-paused--stage">
          <PausedPill pause={pause} />
        </div>
      ) : (
        <>
          <span className="va-camera__corner va-camera__corner--tl" aria-hidden="true" />
          <span className="va-camera__corner va-camera__corner--tr" aria-hidden="true" />
          <span className="va-camera__corner va-camera__corner--bl" aria-hidden="true" />
          <span className="va-camera__corner va-camera__corner--br" aria-hidden="true" />
        </>
      )}
    </div>
  );
}

interface SharePreviewProps {
  stream: MediaStream;
  /** The line over the picture: "Live preview · …" for a share, "Image · mug.jpg" for an image. */
  line: PreviewLine;
  place: TranscriptPlace;
  /** A floating panel's room at the stage's right. */
  floatRight: number;
  stageWidth: number;

  bannerShows: boolean;
  /** Vision is paused: the frame holds its last picture under the veil, with the way back. */
  pause: PauseControl | null;
}

interface Size {
  width: number;
  height: number;
}

/** The preview's place, re-measured whenever it changes size. */
function useBoxSize(): [RefObject<HTMLDivElement | null>, Size | null] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
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

/**
 * A share's live picture, as it is; it says the picture's own size as it comes and changes. `still`
 * holds the frame shown last (Pause vision): the share keeps running, so Resume needs no picker.
 */
function SharePicture({
  stream,
  still,
  onSize,
}: {
  stream: MediaStream;
  still: boolean;
  onSize: (size: Size) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useHeldStill(video, still);
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
    // A window that is resized while shared changes the picture's size: "resize".
    element.addEventListener('loadedmetadata', report);
    element.addEventListener('resize', report);
    return () => {
      element.removeEventListener('loadedmetadata', report);
      element.removeEventListener('resize', report);
      element.srcObject = null;
    };
  }, [stream]);
  return (
    <video
      ref={video}
      className="va-preview__video"
      autoPlay
      muted
      playsInline
      aria-hidden="true"
    />
  );
}

export function SharePreview({
  stream,
  line,
  place,
  floatRight,
  stageWidth,
  bannerShows,
  pause,
}: SharePreviewProps) {
  const [area, areaSize] = useBoxSize();
  const [picture, setPicture] = useState<Size | null>(null);
  const scale = useTextScale();
  const at = previewPlace(place, scale, floatRight);
  const frame = fitFrame(areaSize ?? { width: 0, height: 0 }, picture);
  const lineFont = useMeasure(`400 ${String(12 * scale)}px Inter`);
  const nowSharingFont = useMeasure(`600 ${String(13 * scale)}px Inter`);
  const whole = lineFont(line.whole);
  const { short } = lineForm({
    left: lineLeft(at.left + frame.x, frame.width, whole),
    islandRoom: stageWidth - floatRight,
    whole,
    nowSharingWords: nowSharingFont('Now sharing · '),
    bannerShows,
  });
  const words = short ? line.short : line.whole;

  return (
    <>
      <p
        className="va-preview__line"
        style={{
          top: at.lineTop,
          left: lineLeft(at.left + frame.x, frame.width, lineFont(words)),
          // The frame and its line wait for the picture's size, so neither jumps into place.
          visibility: picture ? undefined : 'hidden',
        }}
      >
        {words}
      </p>
      <div
        ref={area}
        className="va-preview"
        style={{ top: at.top, right: at.right, bottom: at.bottom, left: at.left }}
      >
        <div
          className="va-preview__frame"
          style={{
            left: frame.x,
            top: frame.y,
            width: frame.width,
            height: frame.height,
            visibility: picture ? undefined : 'hidden',
          }}
        >
          <SharePicture stream={stream} still={pause !== null} onSize={setPicture} />
          {/* The veil is the frame's: its place, its size, its corners (A17). */}
          {pause && <div className="va-paused va-paused--frame" />}
        </div>
        {pause && picture && (
          // The pill centres on the frame and stays whole over a frame narrower than it.
          <div
            className="va-paused__anchor"
            style={{ left: frame.x + frame.width / 2, top: frame.y + frame.height / 2 }}
          >
            <PausedPill pause={pause} />
          </div>
        )}
      </div>
    </>
  );
}

interface DropTargetProps {
  name: string;

  replaces: boolean;
}

export function DropTarget({ name, replaces }: DropTargetProps) {
  return (
    <div className="va-drop">
      <svg
        className="va-drop__glyph"
        width="32"
        height="32"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M1.5 5V1.5H5 M11 1.5h3.5V5 M14.5 11v3.5H11 M5 14.5H1.5V11" />
        <path d="M8 5v6M5.5 8.5L8 11l2.5-2.5" />
      </svg>
      <p className="va-drop__title">Drop to show {name}</p>
      <p className="va-drop__line">
        PNG or JPG · up to 20 MB · {replaces ? 'replaces' : 'becomes'} what {name} sees
      </p>
    </div>
  );
}

/** A clock that ticks while `running`, for words that follow the voice. */
function useNow(running: boolean, every = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, every);
    return () => {
      window.clearInterval(timer);
    };
  }, [running, every]);
  return now;
}

interface CaptionsProps {
  state: SessionState;
  mode: CaptionMode;
  width: number;

  backing?: boolean;
}

export function Captions({ state, mode, width, backing = false }: CaptionsProps) {
  const turn = lastTurn(state.items);
  // A quarter-second clock while there is something the caption could show.
  const now = useNow(mode !== 'off' && turn !== undefined);
  const shown = captionFor(state, turn, mode, now);
  const scale = useTextScale();
  const answerFont = useMeasure(`600 ${String(22 * scale)}px Inter`);
  const questionFont = useMeasure(`600 ${String(17 * scale)}px Inter`);
  if (!shown) return null;

  const room = Math.min(captionWidth, width - 96);
  const answerPages = pages(
    shown.turn.status === 'stopped' ? `${shown.turn.reply.trimEnd()}…` : shown.turn.reply,
    answerFont,
    room,
  );
  const page =
    answerPages[
      pageAt(
        answerPages.map((p) => p.start),
        shown.spokenMs,
      )
    ];
  const question =
    shown.turn.question === '' ? '' : questionLine(shown.turn.question, questionFont, room);

  return (
    <div
      className="va-captions"
      data-backing={backing || undefined}
      aria-hidden="true"
      style={{ maxWidth: room }}
    >
      {question && <p className="va-captions__question">{question}</p>}
      {shown.answer && page && (
        // Each laid line is drawn as laid, so the browser never wraps a page to a third line.
        <p key={page.start} className="va-captions__answer">
          {page.lines.map((line) => (
            <span key={line} className="va-captions__line">
              {line}
            </span>
          ))}
        </p>
      )}
      {shown.turn.status === 'stopped' && <p className="va-captions__stopped">Stopped</p>}
    </div>
  );
}

export function Continuum({ items, name }: { items: readonly TranscriptItem[]; name: string }) {
  const turns = items.filter((item): item is Turn => item.kind === 'turn').slice(-3);
  return (
    <div className="va-continuum">
      <div className="va-continuum__veil" />
      <div className="va-continuum__turns">
        {turns.map((turn, i) => (
          <div
            key={turn.id}
            className="va-continuum__turn"
            data-older={i < turns.length - 1 || undefined}
          >
            {turn.question && (
              <p className="va-continuum__question">
                <span className="convai-visually-hidden">You: </span>
                {turn.question}
              </p>
            )}
            {turn.reply && (
              <p className="va-continuum__answer">
                <span className="convai-visually-hidden">{name}: </span>
                {turn.status === 'stopped' ? `${turn.reply.trimEnd()}…` : turn.reply}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

interface AskProps {
  name: string;
  /** The character's picture; null shows its first letter. */
  portrait: string | null;
  onAllow: () => void;
  onTypeInstead: () => void;
}

export function MicrophoneAsk({ name, portrait, onAllow, onTypeInstead }: AskProps) {
  const allow = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    allow.current?.focus();
  }, []);
  return (
    <div
      className="va-ask"
      role="dialog"
      aria-labelledby="va-ask-title"
      aria-describedby="va-ask-body"
    >
      <div className="va-ask__who">
        <span className="va-avatar" aria-hidden="true">
          <Portrait src={portrait}>{name.slice(0, 1).toUpperCase()}</Portrait>
        </span>
        <span>{name}</span>
      </div>
      <p id="va-ask-title" className="va-ask__title">
        I need your microphone to hear you
      </p>
      <p id="va-ask-body" className="va-ask__body">
        Your browser will ask next. You can type to me instead.
      </p>
      <div className="va-ask__actions">
        <Button ref={allow} kind="primary" shape="capsule" onClick={onAllow}>
          Allow microphone
        </Button>
        <Button shape="capsule" onClick={onTypeInstead}>
          Type instead
        </Button>
      </div>
      <span className="va-ask__tether" aria-hidden="true" />
    </div>
  );
}
