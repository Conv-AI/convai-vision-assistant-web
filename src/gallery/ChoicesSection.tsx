import { useState, type ReactNode } from 'react';
import { Segmented } from '../kit/controls/Segmented';
import { Select } from '../kit/controls/Select';
import { Slider } from '../kit/controls/Slider';
import { Switch } from '../kit/controls/Switch';

const microphones = [
  { value: '', label: 'Default · Studio USB microphone' },
  { value: 'usb', label: 'Studio USB microphone' },
  { value: 'built-in', label: 'Built-in microphone' },
  { value: 'airpods', label: 'AirPods Pro', meta: 'Not connected' },
];

const percent = (value: number) => `${String(Math.round(value * 100))}%`;

/** One row of the section: the control's name and what it stands for, then its live states. */
function Row({ name, note, children }: { name: string; note: string; children: ReactNode }) {
  return (
    <div className="gallery__row gallery__row--type" role="group" aria-label={name}>
      <span className="gallery__name">
        <span className="convai-text--control">{name}</span>
        <span className="convai-text--meta">{note}</span>
      </span>
      <span className="gallery__choices">{children}</span>
    </div>
  );
}

export function ChoicesSection() {
  const [on, setOn] = useState(true);
  const [mode, setMode] = useState('push');
  const [microphone, setMicrophone] = useState('');
  const [size, setSize] = useState(1);
  const [volume, setVolume] = useState(0.8);
  return (
    <section className="gallery__section" aria-labelledby="choices" data-capture="choices">
      <h2 id="choices" className="convai-text--heading">
        Choices and values
      </h2>
      <div className="gallery__table">
        <Row name="Switch" note="36 × 20, lens.green on">
          <Switch label="Captions" on={on} onChange={setOn} />
          <Switch label="Captions, off" on={false} onChange={() => undefined} />
          <Switch label="Captions, disabled" on={false} onChange={() => undefined} disabled />
          <Switch label="Captions, disabled and on" on onChange={() => undefined} disabled />
        </Row>
        <Row name="Segmented" note="32 track, 26 options, arrows choose">
          <Segmented
            label="Mode"
            options={[
              { value: 'free', label: 'Hands free' },
              { value: 'push', label: 'Push to talk' },
            ]}
            value={mode}
            onChange={setMode}
          />
          <Segmented
            label="Sidebar side, disabled"
            options={[
              { value: 'system', label: 'System' },
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            value="system"
            onChange={() => undefined}
            disabled
          />
        </Row>
        <Row name="Select" note="200 × 36, a menu of up to eight">
          <Select
            label="Input device"
            options={microphones}
            value={microphone}
            onChange={setMicrophone}
          />
          <Select
            label="Input device, disabled"
            options={microphones}
            value=""
            onChange={() => undefined}
            disabled
          />
        </Row>
        <Row name="Slider" note="4 track, 16 knob, value after it">
          <Slider
            label="Zoom"
            value={size}
            min={0.9}
            max={1.3}
            step={0.05}
            onChange={setSize}
            format={percent}
            ends={['A', 'A']}
          />
          <Slider
            label="Volume"
            value={volume}
            min={0}
            max={1}
            step={0.05}
            onChange={setVolume}
            format={percent}
          />
          <Slider
            label="Volume, disabled"
            value={0.4}
            min={0}
            max={1}
            step={0.05}
            onChange={() => undefined}
            format={percent}
            disabled
          />
        </Row>
      </div>
    </section>
  );
}
