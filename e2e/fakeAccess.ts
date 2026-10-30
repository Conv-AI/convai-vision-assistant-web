import type { Page } from '@playwright/test';

/**
 * The browser's word on the microphone and the camera, for the first run's tests: what
 * `permissions.query` says, what `getUserMedia` answers, and a way to change the site's settings
 * while the page shows. Without it Chromium's fake media UI allows everything at once.
 */
export interface FakeDevice {
  /** What `permissions.query` says before any answer. Default prompt. */
  permission?: PermissionState;
  /** What the prompt comes to: allow, or the DOMException's name. Default allow. */
  answer?: 'allow' | 'NotAllowedError' | 'NotReadableError' | 'NotFoundError';
  /** What `permissions.query` says after the answer; default granted after allow, else unchanged. */
  after?: PermissionState;
  /** How long the person takes to answer, in ms. Default 400. */
  takes?: number;
  /** False: no such device is connected. Default true. */
  connected?: boolean;
}

export interface FakeAccessOptions {
  microphone?: FakeDevice;
  camera?: FakeDevice;
}

declare global {
  interface Window {
    fakeAccess?: {
      asked: string[];
      set: (device: 'microphone' | 'camera', state: PermissionState) => void;
    };
  }
}

function install(options: FakeAccessOptions) {
  type Name = 'microphone' | 'camera';
  const statuses: Record<Name, EventTarget & { state: PermissionState }> = {
    microphone: Object.assign(new EventTarget(), {
      state: options.microphone?.permission ?? 'prompt',
    }),
    camera: Object.assign(new EventTarget(), { state: options.camera?.permission ?? 'prompt' }),
  };
  const asked: string[] = [];
  const query = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = (descriptor: PermissionDescriptor) => {
    const name = descriptor.name as string;
    if (name === 'microphone' || name === 'camera')
      return Promise.resolve(statuses[name] as unknown as PermissionStatus);
    return query(descriptor);
  };
  const enumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
  navigator.mediaDevices.enumerateDevices = async () => {
    const devices = await enumerate();
    return devices.filter((device) => {
      if (device.kind === 'audioinput') return options.microphone?.connected !== false;
      if (device.kind === 'videoinput') return options.camera?.connected !== false;
      return true;
    });
  };
  const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    const name: Name = constraints?.audio ? 'microphone' : 'camera';
    const device = options[name] ?? {};
    // Only the first run's asks are answered here; the session opens through its transport.
    if (statuses[name].state === 'granted') return open(constraints);
    asked.push(name);
    const answer = device.answer ?? 'allow';
    if (statuses[name].state === 'denied')
      throw new DOMException('Blocked in the site settings.', 'NotAllowedError');
    await new Promise((resolve) => setTimeout(resolve, device.takes ?? 400));
    const after = device.after ?? (answer === 'allow' ? 'granted' : statuses[name].state);
    statuses[name].state = after;
    if (answer !== 'allow') throw new DOMException('The fake said no.', answer);
    return open(constraints);
  };
  window.fakeAccess = {
    asked,
    set: (name, state) => {
      statuses[name].state = state;
      statuses[name].dispatchEvent(new Event('change'));
    },
  };
}

/** Installs the fake before the app loads; call it before `openApp`. */
export async function fakeAccess(page: Page, options: FakeAccessOptions = {}): Promise<void> {
  await page.addInitScript(install, options);
}

/** Changes the site's settings for `device`, as a person would in the browser. */
export async function setPermission(
  page: Page,
  device: 'microphone' | 'camera',
  state: PermissionState,
): Promise<void> {
  await page.evaluate(([d, s]) => window.fakeAccess?.set(d, s), [device, state] as const);
}

/** The devices the first run asked the browser for, in order. */
export async function askedDevices(page: Page): Promise<string[]> {
  return page.evaluate(() => window.fakeAccess?.asked ?? []);
}
