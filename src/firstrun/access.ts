export type Device = 'microphone' | 'camera';

export type Access =
  /** The browser has not been asked, or was asked and answered nothing yet. */
  | 'not-asked'
  | 'allowed'
  /** The prompt was closed without an answer: the browser can ask again. */
  | 'refused'
  /** The site's settings block it: the browser will not ask again. */
  | 'blocked'
  /** No such device is connected. */
  | 'missing'
  /** Another app holds the device. */
  | 'busy';

/** What the browser offers, injectable so a test can stand in for it. */
export interface AccessBrowser {
  /** The permission without asking; null where the browser cannot say. */
  permission(device: Device): Promise<PermissionState | null>;
  /** Calls back when the permission changes in the site's settings; returns what stops it. */
  watchPermission(device: Device, changed: () => void): () => void;
  /** Whether such a device is connected; null where the browser cannot say. */
  hasDevice(device: Device): Promise<boolean | null>;
  watchDevices(changed: () => void): () => void;
  /** Opens the device once, which asks the browser, and stops it again. Rejects as getUserMedia. */
  open(device: Device): Promise<void>;
  now(): number;
}

/**
 * A refusal faster than this came from the browser, not from a person: it did not ask, so it will
 * not ask again (a block the browser keeps without saying so).
 */
export const unaskedRefusalMs = 200;

/** Where `device` stands now, asking nothing. */
export async function readAccess(browser: AccessBrowser, device: Device): Promise<Access> {
  const [has, permission] = await Promise.all([
    browser.hasDevice(device),
    browser.permission(device),
  ]);
  if (permission === 'denied') return 'blocked';
  if (has === false) return 'missing';
  return permission === 'granted' ? 'allowed' : 'not-asked';
}

/** Asks the browser for `device`: one prompt, and the answer as an `Access`. */
export async function askAccess(browser: AccessBrowser, device: Device): Promise<Access> {
  const asked = browser.now();
  try {
    await browser.open(device);
    return 'allowed';
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing';
    if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
    const permission = await browser.permission(device);
    if (permission === 'denied' || browser.now() - asked < unaskedRefusalMs) return 'blocked';
    return 'refused';
  }
}

/**
 * What a later look at the browser means for what the run knows: a look cannot tell a closed prompt
 * or a device another app holds from one never asked, so those stand until the browser says more.
 */
export function followRead(known: Access, read: Access): Access {
  if (known === 'refused' && read === 'not-asked') return known;
  if (known === 'busy' && (read === 'not-asked' || read === 'allowed')) return known;
  return read;
}

const permissionName = (device: Device) => device as PermissionName;
const deviceKind = (device: Device): MediaDeviceKind =>
  device === 'microphone' ? 'audioinput' : 'videoinput';

/** The page's own browser. */
export const browserAccess: AccessBrowser = {
  async permission(device) {
    try {
      return (await navigator.permissions.query({ name: permissionName(device) })).state;
    } catch {
      return null;
    }
  },
  watchPermission(device, changed) {
    let status: PermissionStatus | null = null;
    let stopped = false;
    const permissions = navigator.permissions as Permissions | undefined;
    permissions?.query({ name: permissionName(device) }).then(
      (found) => {
        if (stopped) return;
        status = found;
        status.addEventListener('change', changed);
      },
      () => undefined,
    );
    return () => {
      stopped = true;
      status?.removeEventListener('change', changed);
    };
  },
  async hasDevice(device) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some((one) => one.kind === deviceKind(device));
    } catch {
      return null;
    }
  },
  watchDevices(changed) {
    const devices = navigator.mediaDevices as MediaDevices | undefined;
    devices?.addEventListener('devicechange', changed);
    return () => {
      devices?.removeEventListener('devicechange', changed);
    };
  },
  async open(device) {
    const stream = await navigator.mediaDevices.getUserMedia(
      device === 'microphone' ? { audio: true } : { video: true },
    );
    for (const track of stream.getTracks()) track.stop();
  },
  now: () => performance.now(),
};
