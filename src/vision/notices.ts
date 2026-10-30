import {
  request,
  status,
  type Notification,
  type NotificationAction,
} from '../kit/island/notification';
import type { CameraProblem } from './camera';
import type { ImageRefusal } from './image';

export const visionKeys = {
  camera: 'vision.camera',
  cameraBack: 'vision.camera-back',
  shareFailed: 'vision.share-failed',
  nowSharing: 'vision.now-sharing',
  nothingChosen: 'vision.nothing-chosen',
  stoppedFromBrowser: 'vision.stopped-from-browser',

  imageRefused: {
    'not-image': 'vision.image-refused',
    'too-large': 'vision.image-refused.too-large',
    unreadable: 'vision.image-refused.unreadable',
  } satisfies Record<ImageRefusal, string>,
} as const;

interface CameraNoticeOptions {
  name: string;
  problem: CameraProblem;
  /** The same problem came back from a Try again. */
  again: boolean;

  lost: boolean;
  /** True while a Try again is running: the Island shows its loader. */
  working?: boolean;
  retry: NotificationAction;
  chooseAnother: NotificationAction;
}

export function cameraNotice(options: CameraNoticeOptions): Notification {
  const { name, problem, again, lost, retry, chooseAnother } = options;
  const elsewhere = `Or choose something else for ${name} to see.`;
  // Try again keeps the banner up: it answers in place.
  const tryAgain = { ...retry, closes: false };
  let notice: Notification;
  if (lost) {
    notice = request(
      visionKeys.camera,
      'The camera was disconnected',
      `Plug it back in, or choose something else for ${name} to see.`,
      chooseAnother,
    );
  } else {
    switch (problem) {
      case 'blocked':
        notice = request(
          visionKeys.camera,
          'Your browser isn’t letting Convai use the camera',
          again
            ? 'Still blocked. Allow the camera in this site’s settings first.'
            : `Allow the camera in this site’s settings, then try again. ${elsewhere}`,
          tryAgain,
          chooseAnother,
        );
        break;
      case 'not-yet':
        notice = request(
          visionKeys.camera,
          'Camera not allowed yet',
          `${name} can see once you allow the camera.`,
          tryAgain,
          chooseAnother,
        );
        break;
      case 'busy':
        notice = request(
          visionKeys.camera,
          'The camera is in use',
          again
            ? 'Still in use. Close the other app using it, then try again.'
            : `Close the other app using it, then try again. ${elsewhere}`,
          tryAgain,
          chooseAnother,
        );
        break;
      case 'none':
        notice = request(
          visionKeys.camera,
          'No camera found',
          `Connect one, or choose something else for ${name} to see.`,
          chooseAnother,
        );
        break;
    }
  }
  return options.working ? { ...notice, working: true } : notice;
}

export function cameraCause(problem: CameraProblem, lost: boolean): string {
  if (lost) return 'Disconnected';
  switch (problem) {
    case 'blocked':
      return 'Camera blocked';
    case 'not-yet':
      return 'Not allowed yet';
    case 'busy':
      return 'Camera in use';
    case 'none':
      return 'No camera found';
  }
}

export function cameraBackNotice(): Notification {
  return status(visionKeys.cameraBack, 'Camera is back');
}

export function shareFailedNotice(
  name: string,
  retry: NotificationAction,
  chooseAnother: NotificationAction,
): Notification {
  return request(
    visionKeys.shareFailed,
    'Sharing couldn’t start',
    `Try again, or choose something else for ${name} to see.`,
    retry,
    chooseAnother,
  );
}

export function nowSharingNotice(name: string): Notification {
  return {
    ...status(visionKeys.nowSharing, `Now sharing · ${name}`, 2),
    brief: 'Now sharing',
  };
}

export function nothingChosenNotice(): Notification {
  return status(visionKeys.nothingChosen, 'Nothing shared', 4);
}

export function stoppedFromBrowserNotice(): Notification {
  return status(visionKeys.stoppedFromBrowser, 'Sharing stopped from the browser', 4);
}

export function imageRefusedNotice(refusal: ImageRefusal): Notification {
  const words: Record<ImageRefusal, [string, string?]> = {
    'not-image': ['PNG and JPG only'],
    'too-large': ['That image is over 20 MB', 'Over 20 MB'],
    unreadable: ['That file couldn’t be opened', 'Couldn’t open'],
  };
  const [title, brief] = words[refusal];
  const notice = status(visionKeys.imageRefused[refusal], title, 4);
  return brief === undefined ? notice : { ...notice, brief };
}
