import type { SessionState } from '../session/session';
import type { Turn } from '../session/turns';

/** The browser's notifications and the page's visibility, as the notices use them. */
export interface NotifyBrowser {
  /** The site's permission, or null where the browser has no notifications. */
  permission(): NotificationPermission | null;
  /** Asks for the permission. Called in a press: some browsers ask only with a user gesture. */
  request(): void;
  hidden(): boolean;
  /** Calls `listener` each time the page becomes visible again; returns how to stop. */
  onVisible(listener: () => void): () => void;
  /** Shows a notification; null when the browser refused to make one. */
  show(title: string, body: string, onClick: () => void): Shown | null;
  /** Brings this tab and its window to the front. */
  focus(): void;
}

export interface Shown {
  close(): void;
}

/** What the notices read of the conversation. */
export interface Conversation {
  readonly state: Pick<SessionState, 'items' | 'talk' | 'name'>;
  subscribe(listener: () => void): () => void;
}

export interface ReplyNoticeOptions {
  browser: NotifyBrowser;
  conversation: Conversation;
  /** True while the floating window (Compact) stands: it shows the answer, so nothing is sent. */
  floating: () => boolean;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
}

/** Set once the permission was asked on this device: it is never asked again. */
export const askedKey = 'va.notifications-asked';

/** The tag every reply notification carries, so a newer one replaces the one still standing. */
export const replyTag = 'va-reply';

/** The longest first line a notification carries; the system may cut it shorter. */
export const firstLineMax = 120;

export function firstLine(text: string, max = firstLineMax): string {
  const line = (text.trim().split('\n')[0] ?? '').trim();
  if (line.length <= max) return line;
  const room = line.slice(0, max);
  const at = room.lastIndexOf(' ');
  return `${(at > 0 ? room.slice(0, at) : room).replace(/[\s,;:.]+$/, '')}…`;
}

const answered = (item: SessionState['items'][number]): item is Turn =>
  item.kind === 'turn' && item.status === 'done' && item.reply.trim() !== '';

export class ReplyNotices {
  private readonly options: ReplyNoticeOptions;
  /** Turns already answered, told or not: each answer is considered once. */
  private readonly seen = new Set<number>();
  private shown: Shown | null = null;
  private readonly stops: (() => void)[] = [];

  constructor(options: ReplyNoticeOptions) {
    this.options = options;
    for (const item of options.conversation.state.items) if (answered(item)) this.seen.add(item.id);
    this.stops.push(
      options.conversation.subscribe(() => {
        this.check();
      }),
      // Back on the tab, the notification has said what it had to.
      options.browser.onVisible(() => {
        this.close();
      }),
    );
  }

  /**
   * The first typed question on this device: the permission is asked now, in its press, once. A
   * permission already given or refused is not asked for.
   */
  askOnce(): void {
    const { browser, storage } = this.options;
    if (browser.permission() !== 'default' || storage?.getItem(askedKey) === '1') return;
    try {
      storage?.setItem(askedKey, '1');
    } catch {
      // Storage can be off; the browser then asks again on a later visit.
    }
    browser.request();
  }

  dispose(): void {
    for (const stop of this.stops.splice(0)) stop();
    this.close();
  }

  private check() {
    const { conversation, browser, floating } = this.options;
    const { items, talk, name } = conversation.state;
    for (const item of items) {
      if (!answered(item) || this.seen.has(item.id)) continue;
      this.seen.add(item.id);
      if (item.input !== 'typed' || !browser.hidden() || floating()) continue;
      if (talk === 'listening' || talk === 'held') continue;
      if (browser.permission() !== 'granted') continue;
      this.close();
      this.shown = browser.show(`${name} replied`, firstLine(item.reply), () => {
        browser.focus();
        this.close();
      });
    }
  }

  private close() {
    this.shown?.close();
    this.shown = null;
  }
}

/** The browser's own notifications and visibility. */
export const browserNotify: NotifyBrowser = {
  permission: () => (typeof Notification === 'undefined' ? null : Notification.permission),
  request: () => {
    Notification.requestPermission().catch(() => undefined);
  },
  hidden: () => document.visibilityState === 'hidden',
  onVisible: (listener) => {
    const changed = () => {
      if (document.visibilityState === 'visible') listener();
    };
    document.addEventListener('visibilitychange', changed);
    return () => {
      document.removeEventListener('visibilitychange', changed);
    };
  },
  show: (title, body, onClick) => {
    try {
      const notification = new Notification(title, { body, tag: replyTag });
      notification.onclick = onClick;
      return notification;
    } catch {
      // Some browsers make notifications only through a service worker.
      return null;
    }
  },
  focus: () => {
    window.focus();
  },
};
