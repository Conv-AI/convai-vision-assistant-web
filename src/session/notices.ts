import {
  problem,
  request,
  status,
  type Notification,
  type NotificationAction,
} from '../kit/island/notification';
import { timing } from './timing';

export const noticeKeys = {
  connecting: 'session.connecting',
  offline: 'session.offline',
  backOnline: 'session.back-online',
  weak: 'session.weak',
  restarted: 'session.restarted',
  micBlocked: 'session.mic-blocked',
  micBusy: 'session.mic-busy',
  micNone: 'session.mic-none',
  micOn: 'session.mic-on',
} as const;

export function connectingNotice(name: string): Notification {
  return status(noticeKeys.connecting, `Connecting to ${name}…`, Infinity);
}

export function offlineNotice(): Notification {
  return {
    ...status(noticeKeys.offline, 'You’re offline. You can keep working.', 4),
    brief: 'You’re offline',
  };
}

export function backOnlineNotice(): Notification {
  return status(noticeKeys.backOnline, 'Back online', timing.backOnlineSeconds);
}

/** "Weak connection" for 3 s, then the dot with the warn mark until the link recovers. */
export function weakNotice(): Notification {
  return { ...problem(noticeKeys.weak, 'Weak connection', { dotAfter: 3 }), mark: 'warn' };
}

export function restartedNotice(name: string): Notification {
  return status(noticeKeys.restarted, `${name} restarted after a break`, timing.restartedSeconds);
}

export function microphoneBlockedNotice(
  name: string,
  retry: NotificationAction,
  typeInstead: NotificationAction,
): Notification {
  return request(
    noticeKeys.micBlocked,
    'The microphone is blocked',
    `Allow the microphone in this site’s settings, then try again. You can type to ${name} until then.`,
    retry,
    typeInstead,
  );
}

export function microphoneBusyNotice(
  name: string,
  retry: NotificationAction,
  typeInstead: NotificationAction,
): Notification {
  return request(
    noticeKeys.micBusy,
    'Another app is using the microphone',
    `Close it to talk, or type to ${name} for now.`,
    retry,
    typeInstead,
  );
}

export function microphoneMissingNotice(
  name: string,
  typeInstead: NotificationAction,
): Notification {
  return request(
    noticeKeys.micNone,
    'No microphone found',
    `Connect one to talk, or type to ${name} for now.`,
    typeInstead,
  );
}

export function microphoneOnNotice(): Notification {
  return status(noticeKeys.micOn, 'Microphone is on');
}
