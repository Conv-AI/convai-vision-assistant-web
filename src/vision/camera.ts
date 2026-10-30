/** A camera the browser lists. `label` is empty until the site has been allowed a camera once. */
export interface Camera {
  id: string;
  label: string;
}

/** Why a camera did not start, as the person can act on it. */
export type CameraProblem =
  /** The browser refuses this site the camera (it was blocked, or refuses without asking). */
  | 'blocked'
  /** The prompt was closed without an answer: nothing went wrong, it can ask again. */
  | 'not-yet'
  /** Another app holds it, or the cause is not known: Try again first. */
  | 'busy'
  /** There is no camera to start. */
  | 'none';

/** The device's own name, without the USB ids Chrome adds: "Integrated Camera (04f2:b6dd)". */
export function cameraName(label: string): string {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
}

/** What a menu row calls a camera: its name once known, otherwise "Camera" (numbered if several). */
export function cameraLabel(camera: Camera, index: number, count: number): string {
  const name = cameraName(camera.label);
  if (name !== '') return name;
  return count > 1 ? `Camera ${String(index + 1)}` : 'Camera';
}

/** The cameras among the browser's devices, each once, in the browser's order. */
export function camerasOf(devices: readonly MediaDeviceInfo[]): Camera[] {
  const seen = new Set<string>();
  const cameras: Camera[] = [];
  for (const device of devices) {
    if (device.kind !== 'videoinput') continue;
    // Before a camera was allowed, Chrome lists one camera with an empty id: it still counts.
    const id = device.deviceId;
    if (seen.has(id)) continue;
    seen.add(id);
    cameras.push({ id, label: device.label });
  }
  return cameras;
}

/** What a failed `getUserMedia` means, read with the camera permission the browser reports after it. */
export function cameraProblem(
  error: unknown,
  permission: 'granted' | 'denied' | 'prompt',
): CameraProblem {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      // A closed prompt leaves the permission at "prompt"; a block, or a refusal without asking,
      // leaves it at "denied".
      return permission === 'denied' ? 'blocked' : 'not-yet';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'none';
    default:
      return 'busy';
  }
}
