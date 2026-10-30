import type { SelectOption } from '../kit/controls/Select';

/** What the list reads of a device, as `enumerateDevices` gives it. */
export type DeviceInfo = Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>;

/** The select's value for the browser's default microphone. */
export const defaultMicrophone = '';

export function microphoneOptions(devices: readonly DeviceInfo[]): SelectOption[] {
  const inputs = devices.filter((device) => device.kind === 'audioinput');
  const named = inputs.some((device) => device.label !== '');
  const chromeDefault = inputs.find((device) => device.deviceId === 'default');
  const defaultName = chromeDefault?.label.replace(/^Default\s*-\s*/, '') ?? '';
  const options: SelectOption[] = [
    {
      value: defaultMicrophone,
      label: named && defaultName !== '' ? `Default · ${defaultName}` : 'Default',
    },
  ];
  if (!named) return options;
  let unnamed = 0;
  for (const device of inputs) {
    if (device.deviceId === 'default' || device.deviceId === 'communications') continue;
    if (device.deviceId === '') continue;
    options.push({
      value: device.deviceId,
      label: device.label !== '' ? device.label : `Microphone ${String(++unnamed)}`,
    });
  }
  return options;
}

/** True when the browser lists no microphone at all. */
export function noMicrophone(devices: readonly DeviceInfo[]): boolean {
  return !devices.some((device) => device.kind === 'audioinput');
}

/** The value the select shows for the stored choice: a device that is gone shows the default. */
export function shownMicrophone(stored: string | null, options: readonly SelectOption[]): string {
  return stored !== null && options.some((option) => option.value === stored)
    ? stored
    : defaultMicrophone;
}

/** Where the device list comes from: the browser's, or a test's. */
export interface DeviceSource {
  list(): Promise<DeviceInfo[]>;
  /** Calls `onChange` when a device comes or goes; returns the way to stop. */
  watch(onChange: () => void): () => void;
}

export const browserDevices: DeviceSource = {
  list: async () => {
    try {
      return await navigator.mediaDevices.enumerateDevices();
    } catch {
      return [];
    }
  },
  watch: (onChange) => {
    const devices = navigator.mediaDevices as MediaDevices | undefined;
    devices?.addEventListener('devicechange', onChange);
    return () => devices?.removeEventListener('devicechange', onChange);
  },
};

/** The devices the browser lists now, read again whenever one comes or goes. */
export class DeviceList {
  private devices: DeviceInfo[] | null = null;
  private readonly listeners = new Set<() => void>();
  private stopWatching: (() => void) | null = null;
  private readonly source: DeviceSource;

  constructor(source: DeviceSource) {
    this.source = source;
  }

  /** Null until the first list arrived. */
  get state(): DeviceInfo[] | null {
    return this.devices;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.stopWatching = this.source.watch(() => {
        void this.refresh();
      });
      void this.refresh();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stopWatching?.();
        this.stopWatching = null;
      }
    };
  }

  async refresh(): Promise<void> {
    this.devices = await this.source.list();
    for (const listener of [...this.listeners]) listener();
  }
}
