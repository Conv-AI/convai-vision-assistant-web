import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterList } from '../characters/list';
import { Compact } from '../compact/compact';
import { RecentCharacters } from '../characters/recent';
import type { Character } from '../credentials/characters';
import { FirstRunStore } from '../firstrun/stored';
import { NotificationQueue } from '../kit/island/queue';
import { Session } from '../session/session';
import { DeviceList, type DeviceInfo } from '../settings/microphones';
import { MicrophoneTest, type RecorderMedia } from '../settings/microphoneTest';
import { ShortcutMap } from '../settings/shortcuts';
import { SettingsStore } from '../settings/stored';
import { FakeTransport, flush } from '../session/test/fakeTransport';
import { silence } from '../session/transport';
import { ShareCard } from '../vision/shareCard';
import { FakeMedia } from '../vision/test/fakeMedia';
import { Vision } from '../vision/vision';
import { launchCopy, turnMeta } from './copy';
import { ReplyNotices } from '../notify/replies';
import type { Runtime } from './runtime';
import { FirstRun } from './FirstRun';
import { SessionWindow } from './SessionWindow';
import type { AccessBrowser } from '../firstrun/access';
import type { PictureWindows } from '../compact/pip';

/** Two microphones as Chrome lists them once the microphone is allowed. */
const microphones: DeviceInfo[] = [
  { kind: 'audioinput', deviceId: 'default', label: 'Default - Studio USB' },
  { kind: 'audioinput', deviceId: 'usb-1', label: 'Studio USB' },
  { kind: 'audioinput', deviceId: 'built-in', label: 'Built-in microphone' },
];

/** Recording waits for this; a test that looks at a run in progress holds it. */
let recordingHeld: Promise<void> = Promise.resolve();

/** A recorder that records and plays at once, unless a test holds the recording. */
const recorder: RecorderMedia = {
  open: () => Promise.resolve({ getTracks: () => [] } as unknown as MediaStream),
  record: () => recordingHeld.then(() => new Blob()),
  play: () => Promise.resolve(),
};

function runtime(
  characters: Character[] = [{ id: 'kira', name: 'Kira', languages: [], portrait: null }],
) {
  const transport = new FakeTransport();
  const queue = new NotificationQueue(() => performance.now() / 1000);
  const list = new CharacterList(() => Promise.resolve(characters));
  const session = new Session({
    transport,
    tokens: { getToken: () => Promise.resolve({ token: 't' }) },
    characters: () => list.load(),
    notices: {
      post: (n) => {
        queue.post(n);
      },
      close: (key) => {
        queue.close(key);
      },
    },
  });
  const media = new FakeMedia();
  const vision = new Vision({
    transport,
    media,
    notices: {
      post: (n) => {
        queue.post(n);
      },
      close: (key) => {
        queue.close(key);
      },
    },
    conversation: session,
    name: () => session.state.name,
  });
  const firstRun = new FirstRunStore(null);
  const parts: Runtime = {
    session,
    vision,
    queue,
    shareCard: new ShareCard(window.localStorage),
    transport,
    level: silence,
    characters: list,
    recent: new RecentCharacters(null),
    firstRun,
    settings: new SettingsStore(null),
    shortcuts: new ShortcutMap(null, firstRun),
    devices: new DeviceList({
      list: () => Promise.resolve(microphones),
      watch: () => () => undefined,
    }),
    microphoneTest: new MicrophoneTest(recorder),

    compact: new Compact({
      supported: false,
      open: () => Promise.reject(new Error('no floating windows')),
    }),
    // jsdom has no notifications.
    replies: new ReplyNotices({
      browser: {
        permission: () => null,
        request: () => undefined,
        hidden: () => false,
        onVisible: () => () => undefined,
        show: () => null,
        focus: () => undefined,
      },
      conversation: session,
      floating: () => false,
      storage: null,
    }),
  };
  return { parts, transport, session, vision, media };
}

async function started(characters?: Character[], compact?: Compact) {
  const { parts, transport, session, vision, media } = runtime(characters);
  if (compact) parts.compact = compact;
  const made = { parts, transport, session, vision, media };
  render(<SessionWindow runtime={parts} />);
  await act(async () => {
    void session.start();
    vision.start();
    await flush();
  });
  return made;
}

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('SessionWindow', () => {
  it('names the app in a heading and shows the launch state while connecting', async () => {
    await started();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Convai Vision Assistant' }),
    ).toBeInTheDocument();
    expect(document.querySelector('.va-launch')).not.toBeNull();
    expect(document.querySelector('.convai-capsule')).toBeNull();
  });

  it('opens the capsule and the nothing-shared stage once live', async () => {
    const { transport } = await started();
    await act(async () => {
      await transport.accept();
    });
    expect(screen.getByText('Ask Kira')).toBeInTheDocument();
    expect(screen.getByText('Show Kira something')).toBeInTheDocument();
    expect(screen.getByText('Kira')).toBeInTheDocument();
  });

  it('types with /, sends with Return, and shows the question in the transcript', async () => {
    const { transport } = await started();
    await act(async () => {
      await transport.accept();
    });
    fireEvent.keyDown(window, { key: '/' });
    const field = await screen.findByRole('textbox', { name: 'Message Kira' });
    fireEvent.change(field, { target: { value: 'What is this?' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(transport.sent).toEqual(['What is this?']);
    expect(screen.queryByRole('textbox')).toBeNull();
    const panel = screen.getByRole('region', { name: 'Transcript' });
    expect(panel).toHaveTextContent('What is this?');
  });

  it('keeps Send disabled while the field is empty, and says why', async () => {
    const { transport } = await started();
    await act(async () => {
      await transport.accept();
    });
    fireEvent.keyDown(window, { key: '/' });
    const send = await screen.findByRole('button', { name: 'Type a message first' });
    expect(send).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(send);
    expect(transport.sent).toEqual([]);
  });

  it('stops a spoken reply on Esc', async () => {
    const { transport, session } = await started();
    await act(async () => {
      await transport.accept();
    });
    act(() => {
      session.send('Tell me a story.');
      transport.emit({ type: 'activity', activity: 'speaking' });
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(transport.interrupts).toBe(1);
  });

  it('shows the no-character state without a way to type', async () => {
    await started([]);
    expect(screen.getAllByText('No characters available')[0]).toBeInTheDocument();
    expect(screen.getByText('Create a character to get started')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Convai account' })).toHaveAttribute(
      'href',
      'https://convai.com/',
    );
    expect(screen.getByRole('button', { name: 'Reload characters' })).toBeInTheDocument();
    // No stand-in name, and no promise that voice and text work.
    expect(screen.queryByText(/Character/)).toBeNull();
    expect(screen.queryByText(/Voice and text work/)).toBeNull();
    fireEvent.keyDown(window, { key: '/' });
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('Settings', () => {
  async function live() {
    const made = await started();
    await act(async () => {
      await made.transport.accept();
    });
    return made;
  }

  const gear = () => screen.getByRole('button', { name: 'Settings' });
  const dialog = () =>
    screen.queryByRole('dialog', { name: /Talking|Audio|Accessibility|Results|Settings/ });

  it('opens from the gear on Talking with the focus on its section, and Esc gives it back', async () => {
    await live();
    fireEvent.click(gear());
    expect(dialog()).not.toBeNull();
    expect(gear()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Talking' })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Talking' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(gear());
  });

  it('opens and closes with Ctrl , and holds the window’s letters while open', async () => {
    const { session } = await live();
    fireEvent.keyDown(window, { key: ',', code: 'Comma', ctrlKey: true });
    expect(dialog()).not.toBeNull();
    fireEvent.keyDown(window, { key: 'm' });
    expect(session.state.muted).toBe(false);
    fireEvent.keyDown(window, { key: ',', code: 'Comma', ctrlKey: true });
    expect(dialog()).toBeNull();
  });

  it('changes how you talk for the session and the next visit, and shows the key only for push to talk', async () => {
    const { session, parts } = await live();
    fireEvent.click(gear());
    expect(screen.getByText('Push to talk key')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Hands free' }));
    expect(session.state.talkMode).toBe('hands-free');
    expect(parts.firstRun.talkMode).toBe('hands-free');
    expect(screen.queryByText('Push to talk key')).toBeNull();
  });

  it('turns a switch from anywhere on its row, and keeps the change', async () => {
    const { parts } = await live();
    fireEvent.click(gear());
    const captions = screen.getByRole('switch', { name: 'Captions' });
    expect(captions).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByText('On the stage when the Transcript panel is closed'));
    expect(captions).toHaveAttribute('aria-checked', 'false');
    expect(parts.settings.state.captions).toBe(false);
  });

  it('changes the transcript panel’s style from its cards, and the panel’s picker the cards', async () => {
    const { parts } = await live();
    fireEvent.click(gear());
    fireEvent.click(screen.getByRole('radio', { name: /Conversation/ }));
    expect(parts.settings.state.transcriptStyle).toBe('conversation');
    expect(screen.getByRole('radio', { name: /Conversation/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    act(() => {
      parts.settings.set({ transcriptStyle: 'moments' });
    });
    expect(screen.getByRole('radio', { name: /Moments/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('asks before it clears the conversation, and Keep it keeps it', async () => {
    const { session, transport } = await live();
    act(() => {
      session.send('What is this?');
      transport.emit(
        { type: 'reply', id: 'r1', text: 'A mug.', streaming: false },
        { type: 'activity', activity: 'idle' },
      );
    });
    expect(session.state.items).toHaveLength(1);
    fireEvent.click(gear());
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    const ask = screen.getByRole('alertdialog', { name: 'Clear this conversation?' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep it' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(ask).not.toBeInTheDocument();
    expect(dialog()).not.toBeNull();
    expect(session.state.items).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Clear' }));
    expect(session.state.items).toHaveLength(0);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('holds Clear back while an answer is under way, saying why', async () => {
    const { session, transport } = await live();
    act(() => {
      session.send('Tell me a story.');
      transport.emit({ type: 'activity', activity: 'speaking' });
    });
    fireEvent.click(gear());
    const clear = screen.getByRole('button', { name: 'Clear' });
    expect(clear).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Available when Kira finishes this answer')).toBeInTheDocument();
    fireEvent.click(clear);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('finds rows by their words, says how many, and Show in opens the section on the row', async () => {
    await live();
    fireEvent.click(gear());
    const field = screen.getByRole('searchbox', { name: 'Search settings' });
    fireEvent.change(field, { target: { value: 'mic' } });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Results for “mic”' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('5 settings. Each row works here; its section opens with the link.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Audio › Microphone')).toBeInTheDocument();
    expect(screen.getByText('Shortcuts › Talking')).toBeInTheDocument();
    expect(screen.getByText('Privacy › Your choices')).toBeInTheDocument();
    expect(
      screen.getAllByRole('tab').every((tab) => tab.getAttribute('aria-selected') === 'false'),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show in Audio' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Audio' })).toBeInTheDocument();
    expect(field).toHaveValue('');
    expect(document.querySelector('[data-row="input-device"]')).toHaveAttribute('data-lit');
  });

  it('says when nothing matches, and Esc clears the words, leaves the field, then closes', async () => {
    await live();
    fireEvent.click(gear());
    const field = screen.getByRole('searchbox', { name: 'Search settings' });
    field.focus();
    fireEvent.change(field, { target: { value: 'lighting' } });
    expect(await screen.findByText('No settings match “lighting”')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(field).toHaveValue('');
    expect(document.activeElement).toBe(field);
    expect(screen.getByRole('heading', { level: 2, name: 'Talking' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Talking' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dialog()).toBeNull();
  });

  it('moves from the search into the first row of the results with ↓', async () => {
    await live();
    fireEvent.click(gear());
    const field = screen.getByRole('searchbox', { name: 'Search settings' });
    fireEvent.change(field, { target: { value: 'mic' } });
    await screen.findByRole('heading', { level: 2, name: 'Results for “mic”' });
    field.focus();
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(
      await screen.findByRole('button', { name: /^Input device/ }),
    );
  });

  it('titles a search that finds nothing Search', async () => {
    await live();
    fireEvent.click(gear());
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search settings' }), {
      target: { value: 'lighting' },
    });
    expect(await screen.findByRole('heading', { level: 2, name: 'Search' })).toBeInTheDocument();
  });

  it('moves between sections with the arrows', async () => {
    await live();
    fireEvent.click(gear());
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Talking' }), { key: 'ArrowDown' });
    expect(screen.getByRole('heading', { level: 2, name: 'Audio' })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Audio' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Audio' }), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Talking' }), { key: 'ArrowUp' });
    expect(screen.getByRole('heading', { level: 2, name: 'About' })).toBeInTheDocument();
  });

  it('chooses the microphone the browser lists, and the conversation moves to it', async () => {
    const { transport, parts } = await live();
    fireEvent.click(gear());
    fireEvent.click(screen.getByRole('tab', { name: 'Audio' }));
    const field = await screen.findByRole('button', { name: /Input device Default · Studio USB/ });
    fireEvent.click(field);
    fireEvent.click(screen.getByRole('option', { name: 'Built-in microphone' }));
    expect(parts.settings.state.microphone).toBe('built-in');
    expect(transport.devices).toEqual(['built-in']);
  });

  it('returns the select to what works when the browser cannot use the chosen microphone', async () => {
    const { transport, parts } = await live();
    fireEvent.click(gear());
    fireEvent.click(screen.getByRole('tab', { name: 'Audio' }));
    const field = await screen.findByRole('button', { name: /Input device Default · Studio USB/ });
    transport.deviceError = new DOMException('busy', 'NotReadableError');
    fireEvent.click(field);
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'Built-in microphone' }));
      await flush();
    });
    expect(transport.devices).toEqual(['built-in']);
    expect(parts.settings.state.microphone).toBeNull();
    expect(field).toHaveTextContent('Default · Studio USB');
    // Under the row's label, and said once to a screen reader.
    expect(
      screen.getAllByText(
        'Couldn’t use that microphone, so the one before is kept. Check it’s connected, or choose another.',
      ),
    ).toHaveLength(2);
    expect(
      within(screen.getByRole('dialog', { name: 'Audio' })).getByRole('alert'),
    ).toHaveTextContent('Couldn’t use that microphone');
  });

  it('mutes an open hands-free microphone while it tests the microphone', async () => {
    const { session, transport } = await live();
    act(() => {
      session.microphoneAllowed();
      session.setTalkMode('hands-free');
    });
    await act(async () => {
      await flush();
    });
    expect(session.state.microphone).toBe('open');
    fireEvent.click(gear());
    fireEvent.click(screen.getByRole('tab', { name: 'Audio' }));
    let release: () => void = () => undefined;
    recordingHeld = new Promise((resolve) => {
      release = resolve;
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
      await flush();
    });
    expect(session.state.muted).toBe(true);
    expect(transport.microphoneCalls.at(-1)).toBe(false);
    expect(screen.getByRole('button', { name: /Recording · 3/ })).toBeInTheDocument();
    await act(async () => {
      release();
      await flush();
    });
    expect(session.state.muted).toBe(false);
    expect(transport.microphoneCalls.at(-1)).toBe(true);
    expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument();
  });

  it('reads a finished answer to a screen reader only when asked to', async () => {
    const { session, transport, parts } = await live();
    const answer = () => {
      act(() => {
        session.send('What is this?');
        transport.emit(
          {
            type: 'reply',
            id: `r${String(session.state.items.length)}`,
            text: 'A mug.',
            streaming: false,
          },
          { type: 'activity', activity: 'idle' },
        );
      });
    };
    answer();
    await new Promise((resolve) => setTimeout(resolve, 600));
    const said = () =>
      [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent).join('|');
    expect(said()).not.toContain('Kira: A mug.');
    act(() => {
      parts.settings.set({ readAnswers: true });
    });
    answer();
    await vi.waitFor(() => {
      expect(said()).toContain('Kira: A mug.');
    });
  });

  it('becomes a select of the sections under 720 wide', async () => {
    const width = window.innerWidth;
    window.innerWidth = 640;
    try {
      await live();
      fireEvent.click(gear());
      expect(screen.queryByRole('tab')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Sections Talking' }));
      fireEvent.click(screen.getByRole('option', { name: 'Accessibility' }));
      expect(screen.getByRole('heading', { level: 2, name: 'Accessibility' })).toBeInTheDocument();
    } finally {
      window.innerWidth = width;
    }
  });

  it('opens the picker over Settings from Change, and Esc closes the picker first', async () => {
    await live();
    fireEvent.click(gear());
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await waitFor(() => {
      expect(document.querySelector('.va-picker')).not.toBeNull();
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('.va-picker')).toBeNull();
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change' }));
  });
});

describe('copy', () => {
  it('says nothing on L1, "Connecting to Kira…" on L2 and wakes the chosen one on L5', () => {
    expect(launchCopy('boot', 'Kira', { failure: null })).toEqual({});
    expect(launchCopy('connecting', 'Kira', { failure: null })).toEqual({
      title: 'Connecting to Kira…',
    });
    expect(launchCopy('switching', 'Elena', { failure: null })).toEqual({
      kicker: 'Waking up',
      title: 'Elena',
    });
  });

  it('names the cause on Couldn’t connect, with one action', () => {
    expect(launchCopy('failed', 'Kira', { failure: 'network' })).toEqual({
      title: 'Couldn’t connect',
      body: 'Check your internet connection, then try again.',
      action: 'Try again',
    });
    expect(launchCopy('failed', 'Kira', { failure: 'service' }).title).toBe(
      'Kira is unavailable right now',
    );
  });

  it('says how a question came, and when', () => {
    const at = new Date(2026, 9, 23, 9, 41).getTime();
    const turn = {
      kind: 'turn',
      id: 1,
      question: 'Hi',
      reply: '',
      replyId: null,
      status: 'waiting',
      at,
    } as const;
    expect(turnMeta({ ...turn, input: 'typed' })).toMatch(/^Typed · 9:41/);
    expect(turnMeta({ ...turn, input: 'voice' })).toMatch(/^Spoken · 9:41/);

    expect(turnMeta({ ...turn, input: 'voice', seen: 'Camera' })).toMatch(/^Camera · 9:41/);
  });
});

describe('Settings, part 3b: Shortcuts, Vision, About', () => {
  async function live() {
    const made = await started();
    await act(async () => {
      await made.transport.accept();
    });
    return made;
  }

  const gear = () => screen.getByRole('button', { name: 'Settings' });
  const settings = () => document.querySelector('dialog.va-settings');
  const openSection = (name: string) => {
    fireEvent.click(gear());
    fireEvent.click(screen.getByRole('tab', { name }));
  };
  const rowOf = (id: string) => {
    const row = document.querySelector<HTMLElement>(`[data-row="${id}"]`);
    if (!row) throw new Error(`No row ${id}`);
    return row;
  };
  /** A key pressed where the focus is, as the browser sends it: down, then up. */
  const press = (key: string, init: KeyboardEventInit = {}) => {
    const target = document.activeElement ?? document.body;
    fireEvent.keyDown(target, { key, ...init });
    fireEvent.keyUp(target, { key, ...init });
  };

  it('records a new talk key in Shortcuts, and the window talks with it at once (S4)', async () => {
    const { session } = await live();
    const talk = vi.spyOn(session, 'pressTalk');
    openSection('Shortcuts');
    fireEvent.click(within(rowOf('shortcut-talk')).getByRole('button', { name: 'Change Talk, T' }));
    expect(rowOf('shortcut-talk')).toHaveTextContent('Press the key you want. Esc cancels.');
    expect(rowOf('shortcut-talk')).toHaveTextContent('Press a key…');
    press('g', { code: 'KeyG' });
    expect(rowOf('shortcut-talk')).toHaveTextContent('Changed');
    expect(rowOf('shortcut-talk')).toHaveTextContent('G');
    expect(rowOf('shortcut-hands-free')).toHaveTextContent('ShiftG');
    // The focus stays on the row, and its name says the new key.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change Talk, G' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(settings()).toBeNull();
    fireEvent.keyDown(window, { key: 't' });
    expect(talk).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'g' });
    expect(talk).toHaveBeenCalledOnce();
    fireEvent.keyUp(window, { key: 'g' });
  });

  it('asks before taking another shortcut’s key, then leaves that one without a key (S4b)', async () => {
    const { session, parts } = await live();
    const talk = vi.spyOn(session, 'pressTalk');
    openSection('Shortcuts');
    fireEvent.click(within(rowOf('shortcut-talk')).getByRole('button', { name: 'Change Talk, T' }));
    press('m', { code: 'KeyM' });
    expect(rowOf('shortcut-talk')).toHaveTextContent(
      'M is already Mute microphone. Use it for Talk and leave Mute without a key?',
    );
    expect(parts.shortcuts.keys.talk).toBe('t');
    const use = screen.getByRole('button', { name: 'Use M for Talk' });
    expect(document.activeElement).toBe(use);
    fireEvent.click(use);
    expect(parts.shortcuts.keys).toMatchObject({ talk: 'm', mute: '' });
    expect(rowOf('shortcut-mute')).toHaveTextContent('Not set · Changed');
    expect(
      within(rowOf('shortcut-mute')).getByRole('button', { name: 'Reset Mute microphone' }),
    ).toBeInTheDocument();
    // Reset finds M taken by Talk now and asks again.
    fireEvent.click(screen.getByRole('button', { name: 'Reset Mute microphone' }));
    expect(rowOf('shortcut-mute')).toHaveTextContent(
      'M is already Talk. Use it for Mute microphone and leave Talk without a key?',
    );
    fireEvent.click(within(rowOf('shortcut-mute')).getByRole('button', { name: 'Cancel' }));
    expect(parts.shortcuts.keys).toMatchObject({ talk: 'm', mute: '' });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'm' });
    expect(talk).toHaveBeenCalledOnce();
    expect(session.state.muted).toBe(false);
  });

  it('says a refusal to a screen reader each time, and ties the question to its answer (S4b, S4c)', async () => {
    await live();
    openSection('Shortcuts');
    fireEvent.click(within(rowOf('shortcut-talk')).getByRole('button', { name: 'Change Talk, T' }));
    const said = () =>
      [...document.querySelectorAll('dialog.va-settings [role="status"]')]
        .map((one) => one.textContent)
        .join(' ');
    const wait = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
      });
    press('Tab');
    await wait();
    expect(said()).toContain('Tab moves between controls. Choose another key.');
    const first = said();
    press('Tab');
    await wait();
    // The same refusal again is new to the region, so it is said again.
    expect(said()).not.toBe(first);
    expect(said()).toContain('Tab moves between controls.');
    press('m', { code: 'KeyM' });
    const take = screen.getByRole('button', { name: 'Use M for Talk' });
    const question = document.getElementById(take.getAttribute('aria-describedby') ?? '');
    expect(question).toHaveTextContent(
      'M is already Mute microphone. Use it for Talk and leave Mute without a key?',
    );
  });

  it('refuses in place what the browser keeps, and Esc ends the wait before it closes Settings (S4c)', async () => {
    const { parts } = await live();
    openSection('Shortcuts');
    fireEvent.click(
      within(rowOf('shortcut-type')).getByRole('button', { name: 'Change Type a message, Slash' }),
    );
    press('Tab');
    expect(rowOf('shortcut-type')).toHaveTextContent(
      'Tab moves between controls. Choose another key.',
    );
    // Ctrl , belongs to Settings: refused, and Settings stays.
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: ',',
      code: 'Comma',
      ctrlKey: true,
    });
    expect(settings()).not.toBeNull();
    expect(rowOf('shortcut-type')).toHaveTextContent(
      'Ctrl+, is Settings and can’t be changed. Choose another key.',
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(settings()).not.toBeNull();
    expect(rowOf('shortcut-type')).not.toHaveTextContent('Press a key…');
    expect(parts.shortcuts.keys.type).toBe('/');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(settings()).toBeNull();
  });

  it('changes the talk key from Talking: the row opens Shortcuts with Talk waiting (S6)', async () => {
    await live();
    fireEvent.click(gear());
    fireEvent.click(screen.getByRole('button', { name: /^Push to talk key/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Shortcuts' })).toBeInTheDocument();
    expect(rowOf('shortcut-talk')).toHaveAttribute('data-recording');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change Talk, T' }));
  });

  it('turns Hands free on and off with Shift and the talk key, and says so', async () => {
    const { session, parts } = await live();
    expect(session.state.talkMode).toBe('push-to-talk');
    fireEvent.keyDown(window, { key: 'T', code: 'KeyT', shiftKey: true });
    expect(session.state.talkMode).toBe('hands-free');
    expect(parts.firstRun.talkMode).toBe('hands-free');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(screen.getByText('Hands free on')).toBeInTheDocument();
    fireEvent.keyUp(window, { key: 'T', code: 'KeyT', shiftKey: true });
    fireEvent.keyDown(window, { key: 'T', code: 'KeyT', shiftKey: true });
    expect(session.state.talkMode).toBe('push-to-talk');
  });

  it('resets every key after asking, from the group’s action', async () => {
    const { parts } = await live();
    parts.shortcuts.move('talk', 'm');
    openSection('Shortcuts');
    fireEvent.click(screen.getByRole('button', { name: 'Reset all shortcuts' }));
    const question = screen.getByRole('alertdialog', { name: 'Reset all shortcuts?' });
    expect(document.activeElement).toBe(
      within(question).getByRole('button', { name: 'Keep my keys' }),
    );
    fireEvent.click(within(question).getByRole('button', { name: 'Reset all' }));
    expect(parts.shortcuts.keys).toEqual({
      talk: 't',
      type: '/',
      mute: 'm',
      transcript: 'r',
      quick: 'q',
    });
    expect(screen.queryByRole('button', { name: 'Reset all shortcuts' })).toBeNull();
  });

  it('switches a camera shared now from Vision, and keeps the choice for the next share (S3)', async () => {
    const { parts, vision, media } = await live();
    await act(async () => {
      vision.choose({ kind: 'camera', deviceId: 'cam-1' });
      await flush();
      media.open();
      await flush();
    });
    openSection('Vision');
    const field = screen.getByRole('button', { name: /^Camera Integrated Camera/ });
    fireEvent.click(field);
    fireEvent.click(screen.getByRole('option', { name: 'Logitech C920' }));
    expect(media.starts.map((start) => start.deviceId)).toEqual(['cam-2']);
    expect(parts.settings.state.camera).toBe('cam-2');
  });

  it('turns the camera preview’s mirror off and on (S3)', async () => {
    const { parts } = await live();
    const window_ = document.querySelector('.va-window');
    expect(window_).not.toHaveAttribute('data-mirror');
    openSection('Vision');
    fireEvent.click(screen.getByRole('switch', { name: 'Mirror my camera' }));
    expect(parts.settings.state.mirrorCamera).toBe(false);
    expect(window_).toHaveAttribute('data-mirror', 'off');
  });

  it('shows the welcome again over the conversation, keeping everything, until Done or Esc', async () => {
    const { parts, transport } = await live();
    // jsdom has no media queries; the welcome asks whether motion is reduced.
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
    openSection('About');
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(settings()).toBeNull();
    const welcome = screen.getByRole('dialog', { name: 'Show Kira what you see' });
    expect(within(welcome).getByRole('button', { name: 'Get started' })).toBeInTheDocument();
    // The window's letters wait: T does not talk under the welcome.
    const talk = vi.spyOn(parts.session, 'pressTalk');
    fireEvent.keyDown(window, { key: 't' });
    expect(talk).not.toHaveBeenCalled();
    fireEvent.click(within(welcome).getByRole('button', { name: 'Get started' }));
    fireEvent.click(within(welcome).getByRole('radio', { name: /Hands free/ }));
    fireEvent.click(within(welcome).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Show Kira what you see' })).toBeNull();
    expect(document.activeElement).toBe(gear());
    // Nothing was asked or kept, and the conversation went on.
    expect(parts.session.state.talkMode).toBe('push-to-talk');
    expect(parts.firstRun.talkMode).toBeNull();
    expect(transport.disconnects).toBe(0);
    // Esc closes it from any step.
    fireEvent.click(gear());
    fireEvent.click(screen.getByRole('tab', { name: 'About' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Show Kira what you see' })).toBeNull();
  });

  it('copies the version and says it did, or that it could not (S7)', async () => {
    await live();
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    openSection('About');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy version' }));
      await flush();
    });
    expect(writeText).toHaveBeenCalledWith('Version 0.0.0 · Conversation by Convai');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    writeText.mockImplementation(() => Promise.reject(new Error('denied')));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
      await flush();
    });
    expect(rowOf('support')).toHaveTextContent(
      'Couldn’t copy. Select the details below and copy them instead.',
    );
    expect(rowOf('support').querySelector('pre')).toHaveTextContent('Character: kira');
    const details = writeText.mock.calls.at(-1)?.[0] ?? '';
    expect(details).toContain('Character: kira');
    expect(details).toContain('Browser: ');
  });

  it('pushes How to use and the licenses over About, each with Back (S8, S10)', async () => {
    await live();
    openSection('About');
    fireEvent.click(screen.getByRole('button', { name: 'How to use' }));
    expect(screen.getByRole('heading', { level: 2, name: 'How to use' })).toBeInTheDocument();
    expect(rowOf('step-1')).toHaveTextContent('Just talk');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Back to About' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('heading', { level: 2, name: 'About' })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'How to use' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open-source licenses' }));
    const react = await screen.findByRole('button', { name: /^react MIT/ }, { timeout: 20000 });
    expect(screen.getByRole('button', { name: /^Inter SIL OFL 1\.1/ })).toBeInTheDocument();
    fireEvent.click(react);
    expect(screen.getByRole('heading', { level: 2, name: 'react' })).toBeInTheDocument();
    expect(document.querySelector('.va-settings__license')).toHaveTextContent('MIT License');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Open-source licenses' }));
    expect(
      screen.getByRole('heading', { level: 2, name: 'Open-source licenses' }),
    ).toBeInTheDocument();
  }, 30000);
});

/** A browser with floating windows: each open gives a window with its own document, at once. */
function floatingWindows() {
  /** Each window's close, in the order they opened. */
  const closes: (() => void)[] = [];
  const open = vi.fn<PictureWindows['open']>(() => {
    const close = vi.fn();
    closes.push(close);
    const view = Object.assign(new EventTarget(), {
      document: document.implementation.createHTMLDocument('Compact'),
      close,
    }) as unknown as Window;
    return Promise.resolve(view);
  });
  return { open, closes, compact: new Compact({ supported: true, open }) };
}

/** jsdom has no media queries or resize observers; the first run's pages ask for both. */
function stubLayout() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
}

describe('Where Kira stays (F4)', () => {
  /** Everything allowed already: the run is Welcome, How to talk, Where, All set. */
  const allowed: AccessBrowser = {
    permission: () => Promise.resolve('granted'),
    watchPermission: () => () => undefined,
    hasDevice: () => Promise.resolve(true),
    watchDevices: () => () => undefined,
    open: () => Promise.resolve(),
    now: () => 0,
  };

  async function firstRun(
    compact: Compact,
    order: string[] = [],
    chosenBefore?: 'full' | 'compact',
  ) {
    stubLayout();
    const { parts } = runtime();
    parts.compact = compact;
    if (chosenBefore) parts.firstRun.setWindowMode(chosenBefore);
    const onDone = vi.fn(() => {
      order.push('done');
    });
    render(<FirstRun runtime={parts} onDone={onDone} access={allowed} />);
    await act(async () => {
      await flush();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    fireEvent.click(screen.getByRole('button', { name: /^Continue with/ }));
    return { parts, onDone };
  }

  it('opens the floating window in Start’s press, before the session window comes', async () => {
    const { open, compact } = floatingWindows();
    const order: string[] = [];
    open.mockImplementation(() => {
      order.push('open');
      return new Promise<Window>(() => undefined);
    });
    const { parts, onDone } = await firstRun(compact, order);
    expect(screen.getByRole('heading', { name: /Where should Kira stay\?/ })).toBeInTheDocument();
    const cards = screen.getByRole('radiogroup', { name: 'Where should Kira stay?' });
    expect(within(cards).getByRole('radio', { name: /Full window/ })).toBeChecked();
    // Each card is named by its mode alone; its line is the description.
    expect(within(cards).getByRole('radio', { name: 'Compact' })).toHaveAccessibleDescription(
      'A small capsule that floats over any app.',
    );
    fireEvent.click(within(cards).getByRole('radio', { name: /Compact/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(parts.firstRun.windowMode).toBe('compact');
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByText('Compact')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(order).toEqual(['open', 'done']);
    expect(onDone).toHaveBeenCalledOnce();
    expect(parts.compact.state.opening).toBe(true);
  });

  it('opens nothing when the full window was kept', async () => {
    const { open, compact } = floatingWindows();
    const { parts, onDone } = await firstRun(compact);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(parts.firstRun.windowMode).toBe('full');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onDone).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });

  it('starts at the mode chosen before, as a run left halfway', async () => {
    const { compact } = floatingWindows();
    await firstRun(compact, [], 'compact');
    const cards = screen.getByRole('radiogroup', { name: 'Where should Kira stay?' });
    expect(within(cards).getByRole('radio', { name: /Compact/ })).toBeChecked();
  });

  it('is not in a run where the browser has no floating window', async () => {
    // Even with Compact chosen in an earlier run, Start opens nothing here.
    const { parts, onDone } = await firstRun(
      new Compact({ supported: false, open: () => Promise.reject(new Error('none')) }),
      [],
      'compact',
    );
    expect(screen.queryByRole('radiogroup', { name: 'Where should Kira stay?' })).toBeNull();
    expect(screen.getByRole('heading', { name: /You’re all set/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onDone).toHaveBeenCalledOnce();
    // The card that explains Compact never opens from Start.
    expect(parts.compact.state.card).toBe(false);
  });

  async function replay(compact: Compact) {
    const made = await started(undefined, compact);
    await act(async () => {
      await made.transport.accept();
    });
    stubLayout();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('tab', { name: 'About' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    const welcome = screen.getByRole('dialog', { name: 'Show Kira what you see' });
    fireEvent.click(within(welcome).getByRole('button', { name: 'Get started' }));
    fireEvent.click(within(welcome).getByRole('button', { name: /^Continue with/ }));
    return { ...made, welcome };
  }

  it('ends the welcome shown again with Done, which goes to the mode chosen in its press', async () => {
    const { open, compact } = floatingWindows();
    const { welcome, parts } = await replay(compact);
    const cards = within(welcome).getByRole('radiogroup', { name: 'Where should Kira stay?' });
    expect(within(cards).getByRole('radio', { name: /Full window/ })).toBeChecked();
    fireEvent.click(within(cards).getByRole('radio', { name: /Compact/ }));
    fireEvent.click(within(welcome).getByRole('button', { name: 'Done' }));
    expect(open).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Show Kira what you see' })).toBeNull();
    // Nothing is kept for a later run.
    expect(parts.firstRun.windowMode).toBeNull();
    await act(async () => {
      await flush();
    });
    expect(parts.compact.state.mode).toBe('compact');
  });

  it('starts at Compact while the window floats, and Full window brings it back', async () => {
    const { compact, closes } = floatingWindows();
    const made = await started(undefined, compact);
    await act(async () => {
      await made.transport.accept();
      compact.enter();
      await flush();
    });
    expect(compact.state.mode).toBe('compact');
    const { welcome } = await (async () => {
      stubLayout();
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      fireEvent.click(screen.getByRole('tab', { name: 'About' }));
      fireEvent.click(screen.getByRole('button', { name: 'Show' }));
      const shown = screen.getByRole('dialog', { name: 'Show Kira what you see' });
      fireEvent.click(within(shown).getByRole('button', { name: 'Get started' }));
      fireEvent.click(within(shown).getByRole('button', { name: /^Continue with/ }));
      await flush();
      return { welcome: shown };
    })();
    const cards = within(welcome).getByRole('radiogroup', { name: 'Where should Kira stay?' });
    expect(within(cards).getByRole('radio', { name: /Compact/ })).toBeChecked();
    fireEvent.click(within(cards).getByRole('radio', { name: /Full window/ }));
    fireEvent.click(within(welcome).getByRole('button', { name: 'Done' }));
    expect(compact.state.mode).toBe('full');
    expect(closes[0]).toHaveBeenCalledOnce();
  });
});

describe('Quick controls', () => {
  async function live() {
    const made = await started();
    await act(async () => {
      await made.transport.accept();
    });
    return made;
  }
  const panel = () => screen.queryByRole('dialog', { name: 'Quick controls' });

  it('opens on Q, mutes from its tile and stays open, and the Type tile leaves for the field', async () => {
    const { session } = await live();
    fireEvent.keyDown(window, { key: 'q', code: 'KeyQ' });
    const shown = panel();
    if (!shown) throw new Error('No panel.');
    fireEvent.click(within(shown).getByRole('button', { name: /^Mute/ }));
    expect(session.state.muted).toBe(true);
    expect(panel()).not.toBeNull();
    fireEvent.click(within(shown).getByRole('button', { name: /^Type/ }));
    expect(panel()).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message Kira' })).toBeInTheDocument();
  });

  it('is not offered on a stage too low even for All settings alone: Q opens Settings (K37)', async () => {
    // The stage is laid out 120 high: 120 − 88 (capsule) − 8 − 64 (the band and 8) leaves no room.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        readonly callback: () => void;
        constructor(callback: () => void) {
          this.callback = callback;
        }
        observe = () => {
          this.callback();
        };
        disconnect = vi.fn();
      },
    );
    const box = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        return { height: this.classList.contains('va-stage') ? 120 : 0 } as DOMRect;
      });
    try {
      await live();
      fireEvent.keyDown(window, { key: 'q', code: 'KeyQ' });
      expect(panel()).toBeNull();
      expect(document.querySelector('dialog.va-settings')).not.toBeNull();
    } finally {
      box.mockRestore();
    }
  });
});
