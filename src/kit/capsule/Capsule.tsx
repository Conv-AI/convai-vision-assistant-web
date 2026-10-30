import { useLayoutEffect, useRef } from 'react';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import { Tooltip } from '../controls/Tooltip';
import { Lens } from '../lens/Lens';
import { lensLabel, type LensState } from '../lens/lensLabel';
import { useAnnouncement } from '../useAnnouncement';
import type { LevelSource } from '../lens/voice';
import { KeyCap } from '../controls/KeyCap';
import type { IconName } from '../icons';
import {
  capsuleCopy,
  hintPieces,
  compactLabel,
  lensAction,
  type CapsuleCopyOptions,
  type CapsuleState,
  type TalkMode,
} from './capsuleCopy';

const lensStates: Record<CapsuleState, LensState> = {
  ready: 'ready',
  listening: 'listening',
  held: 'held',
  thinking: 'thinking',
  speaking: 'speaking',
  muted: 'muted',
  connecting: 'connecting',
  offline: 'offline',
  unavailable: 'offline',
  'no-character': 'offline',
};

/**
 * The app's own tool, between Type and the kit's . A toggle: its glyph names the feature in both states and `pressed` says it is on.
 */
export interface CapsuleAppTool {
  /** The feature's name, in both states ("Pause vision"): `pressed` says that it is on. */
  label: string;
  /** What a press does now, where it is not the name ("Resume vision"): the tooltip's words. */
  tooltip?: string;
  icon: IconName;
  /** The key as the person reads it ("Alt V"), after the name in the tooltip. */
  shortcut?: string;
  /** The key in ARIA's words ("Alt+V"). */
  keyShortcuts?: string;
  pressed: boolean;
  /** Why it cannot act now and how to get it back; it is then dimmed, and still in the Tab order. */
  reason?: string;
  onClick: () => void;
}

export interface CapsuleSource {
  mark: 'live' | 'paused' | 'failed' | 'none';
  words: string;
}

export interface CapsuleFloating {
  /** What is seen, under the state's words; null: the hint stands there. */
  source: CapsuleSource | null;
  muted: boolean;
  onMute: () => void;
}

export interface CapsuleProps extends CapsuleCopyOptions {
  /** The character's name. */
  name: string;
  state: CapsuleState;
  mode: TalkMode;
  /** The voice the Lens follows. */
  level?: LevelSource;

  compact?: boolean;

  floating?: CapsuleFloating;

  overPicture?: boolean;
  /** A click: mute, unmute, stop or cancel, by state. */
  onLens?: () => void;
  /** The Lens pressed (pointer, Enter or Space): push to talk starts holding. */
  onLensPress?: () => void;
  /** The Lens let go: push to talk sends. */
  onLensRelease?: () => void;
  /** Each tool is drawn only when the app gives it something to do: no tool opens nothing. */
  onType?: () => void;
  /** The app's tool. Never dimmed while connecting: what it does is the app's, not the session's. */
  appTool?: CapsuleAppTool;
  onTranscript?: () => void;
  /** The Transcript key as its cap shows it; R unless changed; empty for none. */
  transcriptKey?: string;

  onMore?: () => void;
  /** Quick controls is open: More shows expanded, on the selected fill. */
  moreOpen?: boolean;
  /** The Quick controls key as its cap shows it; Q unless changed; empty for none. */
  moreKey?: string;
  /** Try again, when offline or unavailable. */
  onAction?: () => void;
  /**
   * False when the app says the capsule's state itself, from a region that outlives the capsule
   * (`capsuleCopy(…).announce`): the capsule then has no status region of its own.
   */
  speaks?: boolean;
}

function appButton(tool: CapsuleAppTool) {
  return (
    <IconButton
      key="app"
      className="convai-capsule__app-tool"
      label={tool.label}
      tooltip={tool.tooltip}
      icon={tool.icon}
      kind="tool"
      shape="round"
      shortcut={tool.shortcut}
      aria-keyshortcuts={tool.keyShortcuts}
      pressed={tool.pressed}
      disabled={tool.reason !== undefined}
      reason={tool.reason}
      onClick={tool.onClick}
    />
  );
}

/** ARIA names keys by their key names: the tooltip's "Esc" is "Escape". */
const ariaKey = (key: string) => (key === 'Esc' ? 'Escape' : key);

export function Capsule({
  name,
  state,
  mode,
  level,
  compact = false,
  floating,
  overPicture = false,
  hasTalked,
  wordsOff,
  askingMicrophone,
  microphoneOff,
  talkKey = 'T',
  typeKey = '/',
  muteKey = 'M',
  transcriptKey = 'R',
  moreKey = 'Q',
  moreOpen = false,
  onLens,
  onLensPress,
  onLensRelease,
  onType,
  appTool,
  onTranscript,
  onMore,
  onAction,
  speaks = true,
}: CapsuleProps) {
  const copy = capsuleCopy(name, state, mode, {
    hasTalked,
    wordsOff,
    askingMicrophone,
    microphoneOff,
    talkKey,
    typeKey,
    muteKey,
  });
  const lensTip = lensAction(state, mode, { talkKey, muteKey, microphoneOff });

  const lensState = microphoneOff && state === 'ready' ? 'muted' : lensStates[state];
  const toolReason = state === 'connecting' ? `Available once ${name} is connected` : undefined;
  const spoken = useAnnouncement(copy.announce);
  const lensButton = useRef<HTMLButtonElement>(null);
  const hadActionFocus = useRef(false);
  const pressed = useRef(false);

  // When Try again gives way to the tools, the focus it held moves to the Lens, not to the page.
  useLayoutEffect(() => {
    if (!copy.action && hadActionFocus.current) lensButton.current?.focus();
    hadActionFocus.current = false;
  }, [copy.action]);

  const press = () => {
    if (pressed.current) return;
    pressed.current = true;
    onLensPress?.();
  };
  const release = () => {
    if (!pressed.current) return;
    pressed.current = false;
    onLensRelease?.();
  };
  const characterName =
    state === 'unavailable' || state === 'no-character'
      ? copy.label
      : lensLabel(name, lensStates[state]);
  const tools = (
    [
      ['Type', 'keyboard', typeKey, onType],
      ['Transcript', 'transcript', transcriptKey, onTranscript],
      ['Quick controls', 'more', moreKey, onMore],
    ] as const
  ).filter(
    ([label, , , run]) =>
      run !== undefined &&
      state !== 'no-character' &&
      !floating &&
      (!compact || label === 'Quick controls'),
  );
  const app = state === 'no-character' || compact || floating ? undefined : appTool;
  const kitTool = ([label, icon, shortcut, run]: (typeof tools)[number]) => (
    <IconButton
      key={label}
      label={label}
      icon={icon}
      kind="tool"
      shape="round"
      shortcut={shortcut === '' ? undefined : shortcut}
      disabled={toolReason !== undefined}
      reason={toolReason}
      onClick={run}
      data-tip-target={label === 'Type' ? 'type' : label === 'Quick controls' ? 'more' : undefined}

      {...(label === 'Quick controls'
        ? { 'aria-haspopup': 'dialog' as const, 'aria-expanded': moreOpen }
        : {})}
    />
  );

  const shownTools: ((typeof tools)[number] | 'app')[] = copy.action
    ? tools.filter(([label]) => label === 'Quick controls')
    : [
        ...tools.filter(([label]) => label === 'Type'),
        ...(app ? (['app'] as const) : []),
        ...tools.filter(([label]) => label !== 'Type'),
      ];

  const more = tools.some(([label]) => label === 'Quick controls');

  return (
    <div
      className={[
        'convai-capsule',
        compact && 'convai-capsule--compact',
        floating && 'convai-capsule--floating',
        overPicture && 'convai-capsule--over-picture',
      ]
        .filter(Boolean)
        .join(' ')}
      data-state={state}
    >
      <Tooltip
        text={lensTip ? lensTip.label : characterName}
        shortcut={lensTip && lensTip.key !== '' ? lensTip.key : undefined}
      >
        <button
          ref={lensButton}
          type="button"
          className="convai-capsule__lens"

          data-tip-target="lens"
          aria-label={lensTip ? lensTip.label : characterName}
          aria-keyshortcuts={lensTip?.key ? ariaKey(lensTip.key) : undefined}
          aria-disabled={lensTip ? undefined : true}
          onClick={() => {
            if (lensTip) onLens?.();
          }}
          onPointerDown={(event) => {
            // Only the main button talks: a right-click opens Quick controls instead.
            if (event.button === 0) press();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            if (more && toolReason === undefined) onMore?.();
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onPointerLeave={release}
          onKeyDown={(event) => {
            if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) press();
          }}
          onKeyUp={(event) => {
            if (event.key === ' ' || event.key === 'Enter') release();
          }}
        >
          <Lens
            name={name}
            state={lensState}
            size={44}
            level={level}
            decorative
            warning={state === 'unavailable'}
          />
        </button>
      </Tooltip>
      {compact ? (
        // Compact: the short words, the talk key's cap, and the long sentence as the tooltip.
        <Tooltip text={copy.label} className="convai-capsule__words-anchor">
          <span className="convai-capsule__words" aria-hidden="true">
            <span className="convai-capsule__label">{compactLabel(name, state)}</span>
          </span>
        </Tooltip>
      ) : (
        <Tooltip text={copy.label} wraps className="convai-capsule__words-anchor">
          <span className="convai-capsule__words" aria-hidden="true">
            <span className="convai-capsule__label">{copy.label}</span>
            {floating?.source ? (
              <span className="convai-capsule__source">
                {floating.source.mark !== 'none' && (
                  <span className="convai-capsule__dot" data-mark={floating.source.mark} />
                )}
                <span className="convai-capsule__source-words">{floating.source.words}</span>
              </span>
            ) : (
              copy.hint && (
                <span className="convai-capsule__hint">
                  {hintPieces(copy.hint, copy.hintKeys).map((piece, i) =>
                    'key' in piece ? (
                      <KeyCap key={i}>{piece.key}</KeyCap>
                    ) : (
                      <span key={i}>{piece.words}</span>
                    ),
                  )}
                </span>
              )
            )}
          </span>
        </Tooltip>
      )}
      {floating && !copy.action && state !== 'no-character' && (
        <span className="convai-capsule__tools">
          <IconButton
            label={floating.muted ? 'Unmute microphone' : 'Mute microphone'}
            icon={floating.muted ? 'mic-off' : 'mic'}
            kind="secondary"
            shape="round"
            size="large"
            shortcut={muteKey === '' ? undefined : muteKey}
            disabled={toolReason !== undefined}
            reason={toolReason}
            onClick={floating.onMute}
          />
        </span>
      )}
      {compact &&
        mode === 'push-to-talk' &&
        talkKey !== '' &&
        !copy.action &&
        state !== 'no-character' && (
          <span className="convai-capsule__key" aria-hidden="true">
            <KeyCap>{talkKey}</KeyCap>
          </span>
        )}
      {speaks && (
        <span className="convai-visually-hidden" role="status">
          {spoken}
        </span>
      )}
      {copy.action && (
        <span
          className="convai-capsule__action"
          onFocus={() => {
            hadActionFocus.current = true;
          }}
          onBlur={() => {
            hadActionFocus.current = false;
          }}
        >
          <Button shape="capsule" kind={copy.actionKind} onClick={onAction}>
            {copy.action}
          </Button>
        </span>
      )}
      {shownTools.length > 0 && (
        <span className="convai-capsule__tools">
          {shownTools.map((tool) => (tool === 'app' ? app && appButton(app) : kitTool(tool)))}
        </span>
      )}
    </div>
  );
}
