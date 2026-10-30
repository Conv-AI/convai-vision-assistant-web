import type { Page } from '@playwright/test';

/**
 * The browser's notifications and the tab's visibility, faked before the app loads: a headless page
 * cannot be hidden from a script, and a real notification would reach the desktop. Each
 * notification made and each permission asked is recorded, with whether the page had a user's
 * press at that moment (`navigator.userActivation.isActive`).
 */

export interface FakeNotification {
  title: string;
  body: string;
  tag: string;
  closed: boolean;
}

export interface NotifyRecord {
  made: FakeNotification[];
  /** One entry per `requestPermission`: whether a press was active when it was asked. */
  asked: boolean[];
  /** How many times the page asked to be brought forward. */
  focused: number;
}

declare global {
  interface Window {
    fakeNotify?: {
      record: NotifyRecord;
      permission: NotificationPermission;
      /** What the next `requestPermission` answers. */
      answer: NotificationPermission;
      hidden: boolean;
      click: (index: number) => void;
    };
  }
}

export async function fakeNotify(
  page: Page,
  permission: NotificationPermission = 'default',
  answer: NotificationPermission = 'granted',
): Promise<void> {
  await page.addInitScript(
    ({ permission, answer }) => {
      const record = { made: [], asked: [], focused: 0 } as NotifyRecord;
      const shown: { onclick: (() => void) | null; close: () => void }[] = [];
      const state = {
        record,
        permission,
        answer,
        hidden: false,
        click: (index: number) => {
          shown[index]?.onclick?.();
        },
      };
      window.fakeNotify = state;
      class Fake {
        static get permission() {
          return state.permission;
        }
        static requestPermission() {
          record.asked.push(navigator.userActivation.isActive);
          state.permission = state.answer;
          return Promise.resolve(state.permission);
        }
        onclick: (() => void) | null = null;
        private readonly entry: FakeNotification;
        constructor(title: string, options: NotificationOptions = {}) {
          this.entry = { title, body: options.body ?? '', tag: options.tag ?? '', closed: false };
          record.made.push(this.entry);
          shown.push(this);
        }
        close() {
          this.entry.closed = true;
        }
      }
      Object.defineProperty(window, 'Notification', { value: Fake, configurable: true });
      Object.defineProperty(document, 'visibilityState', {
        get: () => (state.hidden ? 'hidden' : 'visible'),
        configurable: true,
      });
      Object.defineProperty(document, 'hidden', { get: () => state.hidden, configurable: true });
      window.focus = () => {
        record.focused++;
      };
    },
    { permission, answer },
  );
}

/** Hides or shows the tab, as switching to another tab or minimising the window does. */
export async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((value) => {
    if (!window.fakeNotify) throw new Error('fakeNotify is not installed.');
    window.fakeNotify.hidden = value;
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

export async function notifyRecord(page: Page): Promise<NotifyRecord> {
  return page.evaluate(() => {
    if (!window.fakeNotify) throw new Error('fakeNotify is not installed.');
    return window.fakeNotify.record;
  });
}
