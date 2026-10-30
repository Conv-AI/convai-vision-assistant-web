import type { IconName } from '../icons';

/** Problem: not working, now. Request: one thing helps. Undo: can be reversed. Status: nothing to do. */
export type NotificationLevel = 'problem' | 'request' | 'undo' | 'status';

/** Lower is more urgent. */
export const levelRank: Record<NotificationLevel, number> = {
  problem: 1,
  request: 2,
  undo: 3,
  status: 4,
};

export type NotificationForm = 'toast' | 'toast-action' | 'banner' | 'banner-two-actions';

export interface NotificationAction {
  label: string;
  run: () => void;
  /** False for an action that leaves the notification showing, such as Try again on Offline. */
  closes?: boolean;
}

export interface Notification {
  /** Duplicates by key within 10 s are dropped; a Problem with the same key updates in place. */
  key: string;
  level: NotificationLevel;
  title: string;
  /** After the title on the same line, in text.secondary: " · reconnecting". */
  detail?: string;
  /** A banner's second line. */
  body?: string;

  brief?: string;
  /** How long it shows; Infinity until it is closed. */
  seconds: number;
  /** A Problem that becomes the dot by itself after this long ("Weak connection": 3 s). */
  dotAfter?: number;
  primary?: NotificationAction;
  secondary?: NotificationAction;
  /** A glyph for an event ("Copied"); without one, a plain status has a 6 px dot. */
  icon?: IconName;

  mark?: 'dot' | 'warn';
  /** Retrying: the loader Lens in place of the mark ("Offline · reconnecting"). */
  working?: boolean;
}

export const statusSeconds = { min: 1.5, max: 4 };
export const undoSeconds = 6;

export function status(key: string, title: string, seconds = 2): Notification {
  const time = Number.isFinite(seconds)
    ? Math.min(statusSeconds.max, Math.max(statusSeconds.min, seconds))
    : seconds;
  return { key, level: 'status', title, seconds: time };
}

export function problem(
  key: string,
  title: string,
  options: { detail?: string; action?: NotificationAction; dotAfter?: number } = {},
): Notification {
  return {
    key,
    level: 'problem',
    title,
    detail: options.detail,
    primary: options.action,
    dotAfter: options.dotAfter,
    seconds: Infinity,
  };
}

export function request(
  key: string,
  title: string,
  body: string,
  primary: NotificationAction,
  fallback?: NotificationAction,
): Notification {
  return { key, level: 'request', title, body, primary, secondary: fallback, seconds: Infinity };
}

export function undo(key: string, title: string, action: NotificationAction): Notification {
  return { key, level: 'undo', title, primary: action, seconds: undoSeconds };
}

export function formOf(n: Notification): NotificationForm {
  switch (n.level) {
    case 'status':
      return 'toast';
    case 'undo':
      return 'toast-action';
    case 'problem':
      return n.primary ? 'toast-action' : 'toast';
    case 'request':
      return n.secondary ? 'banner-two-actions' : 'banner';
  }
}

export type ToastFit = 'whole' | 'no-close' | 'brief' | 'two-lines';

export function fitSteps(n: Notification): ToastFit[] {
  return ['whole', 'no-close', ...(n.brief ? (['brief'] as const) : []), 'two-lines'];
}

const noBreakSpace = String.fromCharCode(160);

export function bindLastWords(text: string): string {
  const at = text.trimEnd().lastIndexOf(' ');
  return at > 0 ? text.slice(0, at) + noBreakSpace + text.slice(at + 1) : text;
}

export function bindWords(text: string): string {
  const bound = text.replace(
    /(^|\s)(a|an|the|A|An|The) (?=\S)/g,
    (_, before: string, word: string) => `${before}${word}${noBreakSpace}`,
  );
  if ((bound.match(/ /g) ?? []).length < 2) return bound;
  const at = bound.lastIndexOf(' ');
  return bound.slice(0, at) + noBreakSpace + bound.slice(at + 1);
}
