import { describe, expect, it, vi } from 'vitest';
import type { SessionState } from '../session/session';
import type { Turn } from '../session/turns';
import {
  askedKey,
  firstLine,
  ReplyNotices,
  type Conversation,
  type NotifyBrowser,
} from './replies';

type State = Pick<SessionState, 'items' | 'talk' | 'name'>;

function conversation(initial: Partial<State> = {}) {
  const listeners = new Set<() => void>();
  const start: State = { items: [], talk: 'ready', name: 'Kira', ...initial };
  const c = {
    state: start,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: Partial<State>) {
      c.state = { ...c.state, ...next };
      for (const listener of listeners) listener();
    },
    listeners,
  };
  return c satisfies Conversation;
}

function browser(permission: NotificationPermission | null = 'granted') {
  const visible = new Set<() => void>();
  const made: {
    title: string;
    body: string;
    click: () => void;
    close: ReturnType<typeof vi.fn>;
  }[] = [];
  const b = {
    permitted: permission,
    isHidden: true,
    requests: 0,
    focused: 0,
    made,
    permission: () => b.permitted,
    request: () => {
      b.requests++;
    },
    hidden: () => b.isHidden,
    onVisible: (listener: () => void) => {
      visible.add(listener);
      return () => visible.delete(listener);
    },
    show: (title: string, body: string, click: () => void) => {
      const shown = { title, body, click, close: vi.fn() };
      made.push(shown);
      return shown;
    },
    focus: () => {
      b.focused++;
    },
    becomeVisible() {
      b.isHidden = false;
      for (const listener of visible) listener();
    },
  };
  return b satisfies NotifyBrowser;
}

function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

let ids = 0;
function turn(input: Turn['input'], reply: string, status: Turn['status'] = 'done'): Turn {
  return {
    kind: 'turn',
    id: ++ids,
    question: 'What is this?',
    input,
    at: 0,
    reply,
    replyId: 'r',
    status,
  };
}

function setup(
  options: { permission?: NotificationPermission | null; floating?: boolean; items?: Turn[] } = {},
) {
  const c = conversation({ items: options.items ?? [] });
  const b = browser(options.permission === undefined ? 'granted' : options.permission);
  const storage = memory();
  let floating = options.floating ?? false;
  const notices = new ReplyNotices({
    browser: b,
    conversation: c,
    floating: () => floating,
    storage,
  });
  return {
    c,
    b,
    storage,
    notices,
    float: (value: boolean) => {
      floating = value;
    },
  };
}

describe('a typed question answered while the tab is hidden', () => {
  it('sends one notification: "{name} replied" and the answer’s first line', () => {
    const { c, b } = setup();
    const t = turn('typed', 'A ceramic mug.\nMatte glaze outside.', 'streaming');
    c.set({ items: [t] });
    expect(b.made).toHaveLength(0);
    c.set({ items: [{ ...t, status: 'done' }] });
    c.set({ items: [{ ...t, status: 'done' }], talk: 'speaking' });
    expect(b.made.map((n) => [n.title, n.body])).toEqual([['Kira replied', 'A ceramic mug.']]);
  });

  it('uses the character’s own name', () => {
    const { c, b } = setup();
    c.set({ name: 'Vision Spike', items: [turn('typed', 'I am Vision Spike.')] });
    expect(b.made[0]?.title).toBe('Vision Spike replied');
  });

  it('sends nothing for a voice answer, a visible tab, while talking, or with Compact floating', () => {
    const voice = setup();
    voice.c.set({ items: [turn('voice', 'Yes.')] });
    expect(voice.b.made).toHaveLength(0);

    const visible = setup();
    visible.b.isHidden = false;
    visible.c.set({ items: [turn('typed', 'Yes.')] });
    expect(visible.b.made).toHaveLength(0);

    for (const talk of ['listening', 'held'] as const) {
      const talking = setup();
      talking.c.set({ talk, items: [turn('typed', 'Yes.')] });
      expect(talking.b.made).toHaveLength(0);
    }

    const floating = setup({ floating: true });
    floating.c.set({ items: [turn('typed', 'Yes.')] });
    expect(floating.b.made).toHaveLength(0);
  });

  it('sends nothing without the permission', () => {
    for (const permission of ['default', 'denied', null] as const) {
      const { c, b } = setup({ permission });
      c.set({ items: [turn('typed', 'Yes.')] });
      expect(b.made).toHaveLength(0);
    }
  });

  it('considers each answer once, and none answered before it started', () => {
    const before = turn('typed', 'Earlier.');
    const { c, b } = setup({ items: [before] });
    const t = turn('typed', 'Now.');
    c.set({ items: [before, t] });
    c.set({ items: [before, { ...t }], talk: 'ready' });
    expect(b.made.map((n) => n.body)).toEqual(['Now.']);
  });

  it('does not tell an answer that came while the tab was visible once it is hidden', () => {
    const { c, b } = setup();
    b.isHidden = false;
    const t = turn('typed', 'Seen.');
    c.set({ items: [t] });
    b.isHidden = true;
    c.set({ items: [t], talk: 'speaking' });
    expect(b.made).toHaveLength(0);
  });

  it('a newer answer replaces the one still standing', () => {
    const { c, b } = setup();
    const one = turn('typed', 'One.');
    const two = turn('typed', 'Two.');
    c.set({ items: [one] });
    c.set({ items: [one, two] });
    expect(b.made).toHaveLength(2);
    expect(b.made[0]?.close).toHaveBeenCalledTimes(1);
    expect(b.made[1]?.close).not.toHaveBeenCalled();
  });

  it('a click brings the tab forward and closes it; coming back closes it too', () => {
    const { c, b } = setup();
    c.set({ items: [turn('typed', 'One.')] });
    b.made[0]?.click();
    expect(b.focused).toBe(1);
    expect(b.made[0]?.close).toHaveBeenCalledTimes(1);

    const other = setup();
    other.c.set({ items: [turn('typed', 'Two.')] });
    other.b.becomeVisible();
    expect(other.b.made[0]?.close).toHaveBeenCalledTimes(1);
  });

  it('stops listening when disposed', () => {
    const { c, b, notices } = setup();
    notices.dispose();
    c.set({ items: [turn('typed', 'Late.')] });
    expect(b.made).toHaveLength(0);
    expect(c.listeners.size).toBe(0);
  });
});

describe('the permission', () => {
  it('is asked once on this device, only while the browser has not been answered', () => {
    const { b, storage, notices } = setup({ permission: 'default' });
    notices.askOnce();
    notices.askOnce();
    expect(b.requests).toBe(1);
    expect(storage.getItem(askedKey)).toBe('1');
  });

  it('is not asked again on a later visit after it was dismissed', () => {
    const first = setup({ permission: 'default' });
    first.notices.askOnce();
    const later = new ReplyNotices({
      browser: first.b,
      conversation: conversation(),
      floating: () => false,
      storage: first.storage,
    });
    later.askOnce();
    expect(first.b.requests).toBe(1);
  });

  it('is not asked when given, refused, or missing', () => {
    for (const permission of ['granted', 'denied', null] as const) {
      const { b, storage, notices } = setup({ permission });
      notices.askOnce();
      expect(b.requests).toBe(0);
      expect(storage.getItem(askedKey)).toBeNull();
    }
  });
});

describe('firstLine', () => {
  it('takes the first line', () => {
    expect(firstLine('  Row 5.\nThe August column.')).toBe('Row 5.');
  });

  it('cuts a long line on its last whole word with the ellipsis attached', () => {
    const words = 'Marketing the Launch campaign row jumps in August, which is most of it';
    expect(firstLine(words, 40)).toBe('Marketing the Launch campaign row jumps…');
    expect(firstLine(words, 46)).toBe('Marketing the Launch campaign row jumps in…');
    expect(firstLine('x'.repeat(50), 10)).toBe(`${'x'.repeat(10)}…`);
    expect(firstLine('exactly ten', 11)).toBe('exactly ten');
  });
});
