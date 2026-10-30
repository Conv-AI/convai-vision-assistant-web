import { Button, type ButtonKind } from '../kit/controls/Button';
import { IconButton, type IconButtonKind } from '../kit/controls/IconButton';
import { KeyCap } from '../kit/controls/KeyCap';
import { Tooltip } from '../kit/controls/Tooltip';

const longName = 'Vision Assistant – Quarterly planning notes for the design review.docx';

const states = ['Default', 'Hover', 'Pressed', 'Focus', 'Disabled', 'Loading'] as const;
type State = (typeof states)[number];

const stateClass: Partial<Record<State, string>> = {
  Hover: 'convai-state-hover',
  Pressed: 'convai-state-pressed',
  Focus: 'convai-state-focus',
};

const labeled: { name: string; note: string; kind: ButtonKind; danger?: boolean; label: string }[] =
  [
    { name: 'Primary', note: 'accent.user', kind: 'primary', label: 'Allow' },
    { name: 'Secondary', note: 'fill.emphasis, edge.button', kind: 'secondary', label: 'Cancel' },
    { name: 'Text', note: 'No fill until hover', kind: 'text', label: 'Details' },
    {
      name: 'Danger',
      note: 'danger.text, never primary',
      kind: 'text',
      danger: true,
      label: 'Remove',
    },
  ];

const icons: { name: string; note: string; kind: IconButtonKind; shape: 'square' | 'round' }[] = [
  { name: 'Icon', note: '32 square, tooltip', kind: 'secondary', shape: 'square' },
  { name: 'Tool', note: 'Capsule tools', kind: 'tool', shape: 'round' },
  { name: 'Round', note: '40, talk and send', kind: 'primary', shape: 'round' },
];

function cellProps(state: State) {
  return {
    className: stateClass[state],
    disabled: state === 'Disabled',
    loading: state === 'Loading',
    tabIndex: state === 'Default' ? undefined : -1,
  };
}

export function ControlsSection() {
  return (
    <section className="gallery__section" aria-labelledby="buttons" data-capture="buttons">
      <h2 id="buttons" className="convai-text--heading">
        Buttons
      </h2>
      <div className="gallery__table">
        <div className="gallery__matrix-head convai-text--meta" aria-hidden="true">
          <span className="gallery__name">Kind</span>
          {states.map((s) => (
            <span key={s} className="gallery__cell">
              {s}
            </span>
          ))}
        </div>
        {labeled.map((b) => (
          <div key={b.name} className="gallery__matrix-row" role="group" aria-label={b.name}>
            <span className="gallery__name">
              <span className="convai-text--control">{b.name}</span>
              <span className="convai-text--meta">{b.note}</span>
            </span>
            {states.map((s) => (
              <span key={s} className="gallery__cell">
                <Button kind={b.kind} danger={b.danger} {...cellProps(s)}>
                  {b.label}
                </Button>
              </span>
            ))}
          </div>
        ))}
        {icons.map((b) => (
          <div key={b.name} className="gallery__matrix-row" role="group" aria-label={b.name}>
            <span className="gallery__name">
              <span className="convai-text--control">{b.name}</span>
              <span className="convai-text--meta">{b.note}</span>
            </span>
            {states.map((s) => (
              <span key={s} className="gallery__cell">
                <IconButton
                  label={b.kind === 'primary' ? 'Send' : 'Transcript'}
                  icon={b.kind === 'primary' ? 'send' : 'transcript'}
                  kind={b.kind}
                  shape={b.shape}
                  size={b.kind === 'primary' ? 'large' : 'standard'}
                  {...cellProps(s)}
                />
              </span>
            ))}
          </div>
        ))}
      </div>

      <div className="gallery__table gallery__strip" role="group" aria-label="Sizes and key caps">
        <Button size="small">Small</Button>
        <Button>Standard</Button>
        <Button size="medium">Medium</Button>
        <Button size="large" shape="capsule">
          Large
        </Button>
        <Button kind="primary" size="extra-large">
          Extra large
        </Button>
        <Button kind="primary" icon="mic" keyCap="T">
          Hold to talk
        </Button>
        <Button icon="keyboard" keyCap="/">
          Type
        </Button>
        <Button size="small" keyCap="M">
          Mute
        </Button>
        <Button size="large" keyCap="Esc">
          Stop
        </Button>
        <span className="convai-text--meta">
          Press <KeyCap>Q</KeyCap> for Quick controls
        </span>
      </div>

      <div
        className="gallery__table gallery__strip"
        role="group"
        aria-label="Disabled with a reason"
      >
        <span className="gallery__reason">
          <Button kind="primary" disabled reasonId="reason-continue">
            Continue
          </Button>
          <span id="reason-continue" className="convai-text--meta">
            Allow the microphone to continue
          </span>
        </span>
        <IconButton
          label="Share camera"
          icon="cam"
          disabled
          reason="Connect a camera to share it"
        />
      </div>

      <div className="gallery__table gallery__strip" role="group" aria-label="Toggles">
        <IconButton label="Mute" icon="mic" shortcut="M" pressed={false} />
        <IconButton label="Unmute" icon="mic-off" shortcut="M" pressed />
        <IconButton label="Unmute" icon="mic-off" kind="tool" shape="round" pressed />
        <IconButton
          label="Unmute"
          icon="mic-off"
          pressed
          disabled
          reason="Muting needs a microphone"
        />
      </div>

      <div className="gallery__table gallery__strip" role="group" aria-label="Cut labels">
        <Tooltip text={longName} wraps>
          <Button kind="text" className="gallery__cut">
            {longName}
          </Button>
        </Tooltip>
        <Tooltip text="Notes.docx" wraps>
          <Button kind="text" className="gallery__cut">
            Notes.docx
          </Button>
        </Tooltip>
      </div>
    </section>
  );
}
