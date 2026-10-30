import { describe, expect, it, vi } from 'vitest';
import {
  DeviceList,
  defaultMicrophone,
  microphoneOptions,
  noMicrophone,
  shownMicrophone,
  type DeviceInfo,
} from './microphones';

const input = (deviceId: string, label: string): DeviceInfo => ({
  kind: 'audioinput',
  deviceId,
  label,
});

describe('the microphones offered', () => {
  it('names Chrome’s default after its device and leaves out the communications pick', () => {
    const options = microphoneOptions([
      input('default', 'Default - Studio USB (1a2b:3c4d)'),
      input('communications', 'Communications - Studio USB (1a2b:3c4d)'),
      input('usb', 'Studio USB (1a2b:3c4d)'),
      input('built-in', 'Built-in microphone'),
      { kind: 'videoinput', deviceId: 'cam', label: 'Camera' },
    ]);
    expect(options).toEqual([
      { value: defaultMicrophone, label: 'Default · Studio USB (1a2b:3c4d)' },
      { value: 'usb', label: 'Studio USB (1a2b:3c4d)' },
      { value: 'built-in', label: 'Built-in microphone' },
    ]);
  });

  it('offers a plain default where the browser lists none of its own', () => {
    expect(microphoneOptions([input('a', 'Headset'), input('b', '')])).toEqual([
      { value: defaultMicrophone, label: 'Default' },
      { value: 'a', label: 'Headset' },
      { value: 'b', label: 'Microphone 1' },
    ]);
  });

  it('offers only the default while the browser names no device', () => {
    expect(microphoneOptions([input('', ''), input('', '')])).toEqual([
      { value: defaultMicrophone, label: 'Default' },
    ]);
  });

  it('says when there is no microphone at all', () => {
    expect(noMicrophone([])).toBe(true);
    expect(noMicrophone([{ kind: 'audiooutput', deviceId: 's', label: 'Speakers' }])).toBe(true);
    expect(noMicrophone([input('', '')])).toBe(false);
  });

  it('shows the default for a stored microphone that is gone', () => {
    const options = microphoneOptions([input('default', 'Default - A'), input('a', 'A')]);
    expect(shownMicrophone('a', options)).toBe('a');
    expect(shownMicrophone('gone', options)).toBe(defaultMicrophone);
    expect(shownMicrophone(null, options)).toBe(defaultMicrophone);
  });
});

describe('the device list', () => {
  it('lists on the first listener, again on a change, and stops watching after the last', async () => {
    let changed: (() => void) | null = null;
    const stopWatching = vi.fn();
    let devices = [input('a', 'A')];
    const list = new DeviceList({
      list: () => Promise.resolve(devices),
      watch: (onChange) => {
        changed = onChange;
        return stopWatching;
      },
    });
    expect(list.state).toBeNull();
    const heard = vi.fn();
    const stop = list.subscribe(heard);
    await vi.waitFor(() => {
      expect(list.state).toEqual([input('a', 'A')]);
    });
    devices = [input('a', 'A'), input('b', 'B')];
    (changed as (() => void) | null)?.();
    await vi.waitFor(() => {
      expect(list.state).toHaveLength(2);
    });
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    expect(stopWatching).toHaveBeenCalledOnce();
  });
});
