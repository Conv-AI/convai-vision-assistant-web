import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Capsule } from './Capsule';
import {
  capsuleCopy,
  compactLabel,
  hintPieces,
  lensAction,
  type CapsuleState,
  type TalkMode,
} from './capsuleCopy';

describe('capsuleCopy', () => {
  it.each<[string, CapsuleState, TalkMode, string, string, string]>([
    [
      'K1a',
      'ready',
      'push-to-talk',
      'Ask Kira',
      'Hold T to talk · / to type',
      'Kira, ready. Hold T to talk.',
    ],
    [
      'K1b',
      'ready',
      'hands-free',
      'Ask Kira',
      'Just start talking · / to type',
      'Kira, ready. Listening for your voice.',
    ],
    ['K1c', 'listening', 'hands-free', 'Listening…', 'Pause when you’re done', 'Kira, listening'],
    [
      'K1d',
      'held',
      'push-to-talk',
      'Listening…',
      'Release T to send',
      'Kira, listening while you hold',
    ],
    ['K1e', 'thinking', 'hands-free', 'Thinking…', 'Esc to cancel', 'Kira, thinking'],
    ['K1f', 'speaking', 'push-to-talk', 'Kira is speaking', 'Esc to stop', 'Kira, speaking'],
    [
      'K1g',
      'muted',
      'hands-free',
      'Muted · Kira can’t hear you',
      'M to unmute · / to type',
      'Kira, muted',
    ],
    [
      'K1h',
      'connecting',
      'hands-free',
      'Connecting to Kira…',
      'You can keep working',
      'Connecting to Kira',
    ],
    [
      'K1i',
      'offline',
      'hands-free',
      'You’re offline',
      'Reconnects on its own',
      'Kira, offline. Reconnect, button.',
    ],
    [
      'K1j',
      'unavailable',
      'push-to-talk',
      'Kira is unavailable right now',
      'Check your connection and Convai account',
      'Kira is unavailable right now. Try again, button.',
    ],
  ])('%s', (_id, state, mode, label, hint, announce) => {
    const copy = capsuleCopy('Kira', state, mode);
    expect(copy).toMatchObject({ label, hint, announce });
  });

  it('drops the talk hint once the user has talked three times', () => {
    expect(capsuleCopy('Kira', 'ready', 'push-to-talk', { hasTalked: true }).hint).toBe(
      '/ to type',
    );
  });

  it('says the words are off when captions and the transcript both are', () => {
    expect(capsuleCopy('Kira', 'speaking', 'hands-free', { wordsOff: true }).hint).toBe(
      'Esc to stop · Words are off',
    );
  });

  it('gives a problem one action: Reconnect secondary, unavailable’s Try again primary', () => {
    expect(capsuleCopy('Kira', 'offline', 'hands-free')).toMatchObject({
      action: 'Reconnect',
      actionKind: 'secondary',
    });
    expect(capsuleCopy('Kira', 'unavailable', 'hands-free')).toMatchObject({
      action: 'Try again',
      actionKind: 'primary',
    });
    expect(capsuleCopy('Kira', 'ready', 'hands-free').action).toBeUndefined();
  });
});

describe('lensAction', () => {
  it('names what a click on the Lens does', () => {
    expect(lensAction('ready', 'hands-free')).toEqual({ label: 'Mute', key: 'M' });
    expect(lensAction('ready', 'push-to-talk')).toEqual({ label: 'Hold to talk', key: 'T' });
    expect(lensAction('muted', 'hands-free')).toEqual({ label: 'Unmute', key: 'M' });
    expect(lensAction('speaking', 'hands-free')).toEqual({ label: 'Stop', key: 'Esc' });
    expect(lensAction('connecting', 'hands-free')).toBeUndefined();
  });

  it('names the talk key the person chose, and asks for a microphone in hands free', () => {
    expect(lensAction('ready', 'push-to-talk', { talkKey: 'G' })).toEqual({
      label: 'Hold to talk',
      key: 'G',
    });
    expect(lensAction('ready', 'hands-free', { microphoneOff: true })).toEqual({
      label: 'Allow the microphone',
      key: '',
    });
    expect(lensAction('ready', 'push-to-talk', { microphoneOff: true })).toEqual({
      label: 'Hold to talk',
      key: 'T',
    });
  });
});

describe('capsuleCopy with another talk key', () => {
  it('says the key the person chose', () => {
    const options = { talkKey: 'G' };
    expect(capsuleCopy('Kira', 'ready', 'push-to-talk', options)).toMatchObject({
      hint: 'Hold G to talk · / to type',
      announce: 'Kira, ready. Hold G to talk.',
    });
    expect(capsuleCopy('Kira', 'held', 'push-to-talk', options).hint).toBe('Release G to send');
  });

  it('draws the chosen key on the Compact capsule', () => {
    render(<Capsule name="Kira" state="ready" mode="push-to-talk" compact talkKey="G" />);
    expect(document.querySelector('.convai-capsule__key')?.textContent).toBe('G');
  });
});

describe('the capsule with the keys Settings › Shortcuts gave (S4)', () => {
  it('names the Type and Mute keys there are, and none that were left without one', () => {
    const changed = { talkKey: 'M', typeKey: 'Q', muteKey: 'X' };
    expect(capsuleCopy('Kira', 'ready', 'push-to-talk', changed).hint).toBe(
      'Hold M to talk · Q to type',
    );
    expect(capsuleCopy('Kira', 'muted', 'hands-free', changed).hint).toBe(
      'X to unmute · Q to type',
    );
    expect(lensAction('listening', 'hands-free', changed)).toEqual({ label: 'Mute', key: 'X' });
    expect(lensAction('ready', 'hands-free', changed)).toEqual({ label: 'Mute', key: 'X' });
    expect(lensAction('muted', 'hands-free', changed)).toEqual({ label: 'Unmute', key: 'X' });
    const none = { talkKey: '', typeKey: '', muteKey: '' };
    expect(capsuleCopy('Kira', 'ready', 'push-to-talk', none)).toMatchObject({
      hint: 'Click and hold to talk',
      announce: 'Kira, ready. Click and hold to talk.',
    });
    expect(capsuleCopy('Kira', 'ready', 'push-to-talk', { ...none, hasTalked: true }).hint).toBe(
      '',
    );
    expect(capsuleCopy('Kira', 'held', 'push-to-talk', none).hint).toBe('Release to send');
    expect(capsuleCopy('Kira', 'muted', 'hands-free', none).hint).toBe('Click to unmute');
    expect(capsuleCopy('Kira', 'ready', 'hands-free', { ...none, microphoneOff: true }).hint).toBe(
      'Microphone off',
    );
    expect(lensAction('muted', 'hands-free', none)).toEqual({ label: 'Unmute', key: '' });
  });

  it('shows each tool’s key in its tooltip, and none for a tool left without one', () => {
    render(
      <Capsule
        name="Kira"
        state="ready"
        mode="hands-free"
        typeKey="Q"
        transcriptKey=""
        onType={vi.fn()}
        onTranscript={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Type' })).toHaveAttribute('aria-keyshortcuts', 'Q');
    expect(screen.getByRole('button', { name: 'Transcript' })).not.toHaveAttribute(
      'aria-keyshortcuts',
    );
  });

  it('draws no key cap on the Compact capsule while Talk has no key', () => {
    render(<Capsule name="Kira" state="ready" mode="push-to-talk" compact talkKey="" />);
    expect(document.querySelector('.convai-capsule__key')).toBeNull();
  });
});

describe('Capsule', () => {
  it('names its Lens button by what a click does and announces the state once', () => {
    render(<Capsule name="Kira" state="ready" mode="hands-free" onLens={vi.fn()} />);
    const lens = screen.getByRole('button', { name: 'Mute' });
    expect(lens).toHaveAttribute('aria-keyshortcuts', 'M');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Kira, ready. Listening for your voice.');
  });

  it('has no status region of its own when the app says its state', () => {
    render(<Capsule name="Kira" state="ready" mode="hands-free" onLens={vi.fn()} speaks={false} />);
    expect(screen.queryAllByRole('status')).toEqual([]);
  });

  it('offers Type, Transcript and Quick controls with their keys', () => {
    const onType = vi.fn();
    render(
      <Capsule
        name="Kira"
        state="ready"
        mode="hands-free"
        onType={onType}
        onTranscript={vi.fn()}
        onMore={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Type' }));
    expect(onType).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Transcript' })).toHaveAttribute(
      'aria-keyshortcuts',
      'R',
    );
    expect(screen.getByRole('button', { name: 'Quick controls' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Q',
    );
  });

  it('keeps one Lens button in every state, disabled and named as the character where a click does nothing', () => {
    const onLens = vi.fn();
    const { rerender } = render(
      <Capsule name="Kira" state="ready" mode="hands-free" onLens={onLens} />,
    );
    const lens = screen.getByRole('button', { name: 'Mute' });
    lens.focus();
    rerender(<Capsule name="Kira" state="connecting" mode="hands-free" onLens={onLens} />);
    const same = screen.getByRole('button', { name: 'Connecting to Kira' });
    expect(same).toBe(lens);
    expect(same).toHaveFocus();
    expect(same).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(same);
    expect(onLens).not.toHaveBeenCalled();
    rerender(<Capsule name="Kira" state="unavailable" mode="hands-free" onLens={onLens} />);
    expect(screen.getByRole('button', { name: 'Kira is unavailable right now' })).toBe(lens);
  });

  it('holds while the Lens is pressed and sends on release, by pointer or key, once', () => {
    const onLensPress = vi.fn();
    const onLensRelease = vi.fn();
    render(
      <Capsule
        name="Kira"
        state="ready"
        mode="push-to-talk"
        onLensPress={onLensPress}
        onLensRelease={onLensRelease}
      />,
    );
    const lens = screen.getByRole('button', { name: 'Hold to talk' });
    expect(lens).toHaveAttribute('aria-keyshortcuts', 'T');
    fireEvent.keyDown(lens, { key: ' ' });
    fireEvent.keyDown(lens, { key: ' ', repeat: true });
    fireEvent.keyUp(lens, { key: ' ' });
    fireEvent.pointerDown(lens);
    fireEvent.pointerUp(lens);
    expect(onLensPress).toHaveBeenCalledTimes(2);
    expect(onLensRelease).toHaveBeenCalledTimes(2);
  });

  it('names Esc as Escape for screen readers', () => {
    render(<Capsule name="Kira" state="speaking" mode="hands-free" onLens={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Escape',
    );
  });

  it('moves the focus from Reconnect to the Lens when the tools come back', () => {
    const { rerender } = render(<Capsule name="Kira" state="offline" mode="hands-free" />);
    screen.getByRole('button', { name: 'Reconnect' }).focus();
    rerender(<Capsule name="Kira" state="connecting" mode="hands-free" />);
    expect(screen.getByRole('button', { name: 'Connecting to Kira' })).toHaveFocus();
  });

  it('draws only the tools the app wires', () => {
    render(<Capsule name="Kira" state="ready" mode="push-to-talk" onType={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Type' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Transcript' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quick controls' })).toBeNull();
  });

  it('is calm with no character: its line, no hint, no tools, and a Lens that does nothing', () => {
    render(
      <Capsule
        name="Kira"
        state="no-character"
        mode="push-to-talk"
        onType={vi.fn()}
        onMore={vi.fn()}
      />,
    );
    expect(screen.getAllByText('No characters available')[0]).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Type' })).toBeNull();
    expect(screen.getByRole('button', { name: 'No characters available' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('says its short words when Compact, with the talk key, and never cuts them', () => {
    render(<Capsule name="Kira" state="speaking" mode="push-to-talk" compact onType={vi.fn()} />);
    expect(screen.getByText('Speaking')).toBeInTheDocument();
    expect(screen.queryByText('Esc to stop')).toBeNull();
    expect(screen.getByText('T')).toBeInTheDocument();
  });

  it.each([
    ['ready', 'Ask Kira'],
    ['listening', 'Listening…'],
    ['held', 'Listening…'],
    ['thinking', 'Thinking…'],
    ['speaking', 'Speaking'],
    ['muted', 'Muted'],
    ['connecting', 'Connecting…'],
    ['offline', 'Offline'],
    ['unavailable', 'Unavailable'],
    ['no-character', 'No character'],
  ] as const)('names %s as %s when Compact', (state, words) => {
    expect(compactLabel('Kira', state)).toBe(words);
  });

  it('says the microphone is off, and offers typing, when it cannot open', () => {
    render(
      <Capsule name="Kira" state="ready" mode="push-to-talk" microphoneOff onType={vi.fn()} />,
    );

    const hint = document.querySelector('.convai-capsule__hint');
    expect(hint).toHaveTextContent('Press / to type');
    expect(hint?.querySelector('kbd.convai-key-cap')).toHaveTextContent('/');
    expect(screen.getByRole('button', { name: 'Hold to talk' })).toBeInTheDocument();
  });

  it('puts the app’s tool between Type and Transcript, a toggle that keeps its glyph and says what a press does', () => {
    const onClick = vi.fn();
    const tool = {
      label: 'Pause vision',
      icon: 'view-off' as const,
      shortcut: 'Alt V',
      keyShortcuts: 'Alt+V',
      pressed: false,
      onClick,
    };
    const { rerender, container } = render(
      <Capsule
        name="Kira"
        state="ready"
        mode="hands-free"
        onType={vi.fn()}
        appTool={tool}
        onTranscript={vi.fn()}
      />,
    );
    const names = () =>
      [...container.querySelectorAll('.convai-capsule__tools button')].map((b) =>
        b.getAttribute('aria-label'),
      );
    expect(names()).toEqual(['Type', 'Pause vision', 'Transcript']);
    const pause = screen.getByRole('button', { name: 'Pause vision' });
    expect(pause).toHaveAttribute('aria-pressed', 'false');
    expect(pause).toHaveAttribute('aria-keyshortcuts', 'Alt+V');
    fireEvent.click(pause);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Capsule
        name="Kira"
        state="ready"
        mode="hands-free"
        onType={vi.fn()}
        appTool={{ ...tool, tooltip: 'Resume vision', pressed: true }}
      />,
    );
    // A toggle keeps its name: pressed says that it is on (APG); the tooltip says what a press does.
    const resume = screen.getByRole('button', { name: 'Pause vision' });
    expect(resume).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Resume vision' })).toBeNull();
    expect(resume.querySelector('svg')?.innerHTML).toBe(pause.querySelector('svg')?.innerHTML);
  });

  it('never dims the app’s tool while connecting, but dims it with its own reason; none without a character', () => {
    const tool = {
      label: 'Pause vision',
      icon: 'view-off' as const,
      pressed: false,
      onClick: vi.fn(),
    };
    const { rerender } = render(
      <Capsule name="Kira" state="connecting" mode="hands-free" onType={vi.fn()} appTool={tool} />,
    );
    expect(screen.getByRole('button', { name: 'Pause vision' })).not.toHaveAttribute(
      'aria-disabled',
    );
    rerender(
      <Capsule
        name="Kira"
        state="ready"
        mode="hands-free"
        appTool={{ ...tool, reason: 'Share something to pause vision' }}
      />,
    );
    const dimmed = screen.getByRole('button', { name: 'Pause vision' });
    expect(dimmed).toHaveAttribute('aria-disabled', 'true');
    expect(dimmed).toHaveAccessibleDescription('Share something to pause vision');
    fireEvent.click(dimmed);
    expect(tool.onClick).not.toHaveBeenCalled();
    rerender(<Capsule name="Kira" state="no-character" mode="hands-free" appTool={tool} />);
    expect(screen.queryByRole('button', { name: 'Pause vision' })).toBeNull();
  });

  it('dims the tools while connecting and says why', () => {
    render(<Capsule name="Kira" state="connecting" mode="hands-free" onType={vi.fn()} />);
    const type = screen.getByRole('button', { name: 'Type' });
    expect(type).toHaveAttribute('aria-disabled', 'true');
    expect(type).toHaveAccessibleDescription('Available once Kira is connected');
  });

  it('opens Quick controls from More and from a right-click on the Lens, which never talks', () => {
    const onMore = vi.fn();
    const onLensPress = vi.fn();
    const { rerender } = render(
      <Capsule
        name="Kira"
        state="ready"
        mode="push-to-talk"
        onMore={onMore}
        onLensPress={onLensPress}
        moreKey="K"
      />,
    );
    const more = screen.getByRole('button', { name: 'Quick controls' });
    expect(more).toHaveAttribute('aria-haspopup', 'dialog');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveAttribute('aria-keyshortcuts', 'K');
    fireEvent.click(more);
    expect(onMore).toHaveBeenCalledTimes(1);

    const lens = screen.getByRole('button', { name: 'Hold to talk' });
    fireEvent.pointerDown(lens, { button: 2 });
    const menu = fireEvent.contextMenu(lens);
    expect(menu).toBe(false);
    expect(onLensPress).not.toHaveBeenCalled();
    expect(onMore).toHaveBeenCalledTimes(2);

    rerender(<Capsule name="Kira" state="ready" mode="push-to-talk" onMore={onMore} moreOpen />);
    expect(screen.getByRole('button', { name: 'Quick controls' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('opens nothing from the Lens while More is dimmed or not wired', () => {
    const onMore = vi.fn();
    const { rerender } = render(
      <Capsule name="Kira" state="connecting" mode="push-to-talk" onMore={onMore} />,
    );
    fireEvent.contextMenu(screen.getByRole('button', { name: /Kira/ }));
    rerender(<Capsule name="Kira" state="ready" mode="push-to-talk" />);
    // Not wired: the browser's menu stays away all the same.
    expect(fireEvent.contextMenu(screen.getByRole('button', { name: 'Hold to talk' }))).toBe(false);
    expect(onMore).not.toHaveBeenCalled();
  });

  it('replaces the tools but More with Reconnect when offline (K1i: "their action and More only")', () => {
    const onAction = vi.fn();
    const onMore = vi.fn();
    render(
      <Capsule
        name="Kira"
        state="offline"
        mode="hands-free"
        onAction={onAction}
        onType={vi.fn()}
        onTranscript={vi.fn()}
        onMore={onMore}
        appTool={{ label: 'Pause vision', icon: 'view-off', pressed: false, onClick: vi.fn() }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Type' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Transcript' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause vision' })).toBeNull();
    const reconnect = screen.getByRole('button', { name: 'Reconnect' });
    expect(reconnect).toHaveClass('convai-button--secondary');
    fireEvent.click(reconnect);
    expect(onAction).toHaveBeenCalled();
    const more = screen.getByRole('button', { name: 'Quick controls' });
    // More comes after the action, at the capsule's end.
    expect(reconnect.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(more);
    expect(onMore).toHaveBeenCalled();
  });

  it('draws unavailable’s Try again primary, with the Lens’s warn dot (K1j)', () => {
    const { container, rerender } = render(
      <Capsule name="Kira" state="unavailable" mode="hands-free" onMore={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveClass('convai-button--primary');
    expect(screen.getByRole('button', { name: 'Quick controls' })).toBeInTheDocument();
    expect(container.querySelectorAll('.convai-lens__warning')).toHaveLength(1);
    rerender(<Capsule name="Kira" state="offline" mode="hands-free" onMore={vi.fn()} />);
    expect(container.querySelector('.convai-lens__warning')).toBeNull();
  });
});

describe('the hint’s key caps (Convai UI TalkCapsule: "Hold [T] to talk · [/] to type")', () => {
  it('names the keys each hint holds, in its order, and none where a key is not set', () => {
    expect(capsuleCopy('Kira', 'ready', 'push-to-talk').hintKeys).toEqual(['T', '/']);
    expect(capsuleCopy('Kira', 'ready', 'hands-free').hintKeys).toEqual(['/']);
    expect(capsuleCopy('Kira', 'held', 'push-to-talk', { talkKey: 'G' }).hintKeys).toEqual(['G']);
    expect(capsuleCopy('Kira', 'thinking', 'push-to-talk').hintKeys).toEqual(['Esc']);
    expect(capsuleCopy('Kira', 'speaking', 'push-to-talk', { wordsOff: true })).toMatchObject({
      hint: 'Esc to stop · Words are off',
      hintKeys: ['Esc'],
    });
    expect(capsuleCopy('Kira', 'muted', 'hands-free').hintKeys).toEqual(['M', '/']);
    expect(capsuleCopy('Kira', 'listening', 'hands-free').hintKeys).toEqual([]);
    const none = { talkKey: '', typeKey: '', muteKey: '' };
    expect(capsuleCopy('Kira', 'ready', 'push-to-talk', none).hintKeys).toEqual([]);
    expect(capsuleCopy('Kira', 'muted', 'hands-free', none).hintKeys).toEqual([]);
  });

  it('cuts a hint at its keys standing as words, never inside another word', () => {
    expect(hintPieces('Hold T to talk · / to type', ['T', '/'])).toEqual([
      { words: 'Hold ' },
      { key: 'T' },
      { words: ' to talk · ' },
      { key: '/' },
      { words: ' to type' },
    ]);
    // "T" first stands inside "To"; the cap is the key standing alone.
    expect(hintPieces('To talk, hold T', ['T'])).toEqual([
      { words: 'To talk, hold ' },
      { key: 'T' },
    ]);
    expect(hintPieces('Esc to stop', ['Esc'])).toEqual([{ key: 'Esc' }, { words: ' to stop' }]);
    // Nor at the end of one: "UNIT" holds a T before the space.
    expect(hintPieces('UNIT T to talk', ['T'])).toEqual([
      { words: 'UNIT ' },
      { key: 'T' },
      { words: ' to talk' },
    ]);
    expect(hintPieces('Pause when you’re done', [])).toEqual([{ words: 'Pause when you’re done' }]);
    // An empty key names nothing: the hint stays whole, and the cut ends (it once looped for ever).
    expect(hintPieces('Hold T to talk', ['', 'T'])).toEqual([
      { words: 'Hold ' },
      { key: 'T' },
      { words: ' to talk' },
    ]);
  });

  it('draws the keys as caps and reads as the same words', () => {
    render(<Capsule name="Kira" state="ready" mode="push-to-talk" onType={vi.fn()} />);
    const hint = document.querySelector('.convai-capsule__hint');
    expect(hint).toHaveTextContent('Hold T to talk · / to type');
    expect(
      [...(hint?.querySelectorAll('kbd.convai-key-cap') ?? [])].map((cap) => cap.textContent),
    ).toEqual(['T', '/']);
  });
});

describe('the condensed capsule', () => {
  it('keeps More alone: Type and the app’s tool wait in Quick controls', () => {
    const app = {
      label: 'Pause vision',
      icon: 'view-off' as const,
      pressed: false,
      onClick: vi.fn(),
    };
    const { rerender } = render(
      <Capsule
        name="Kira"
        state="speaking"
        mode="push-to-talk"
        onType={vi.fn()}
        onMore={vi.fn()}
        appTool={app}
      />,
    );
    expect(screen.getByRole('button', { name: /Type/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pause vision/ })).toBeInTheDocument();

    rerender(
      <Capsule
        name="Kira"
        state="speaking"
        mode="push-to-talk"
        compact
        onType={vi.fn()}
        onMore={vi.fn()}
        appTool={app}
      />,
    );
    expect(screen.queryByRole('button', { name: /Type/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Pause vision/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Quick controls/ })).toBeInTheDocument();
  });
});

describe('the floating window’s capsule', () => {
  it('says the state over what is seen, with the dot, and offers Mute alone', () => {
    const onMute = vi.fn();
    render(
      <Capsule
        name="Kira"
        state="listening"
        mode="hands-free"
        onType={vi.fn()}
        onMore={vi.fn()}
        floating={{ source: { mark: 'live', words: 'Browser tab' }, muted: false, onMute }}
      />,
    );
    expect(document.querySelector('.convai-capsule__label')).toHaveTextContent('Listening…');
    expect(document.querySelector('.convai-capsule__source')).toHaveTextContent('Browser tab');
    expect(document.querySelector('.convai-capsule__dot')).toHaveAttribute('data-mark', 'live');
    expect(document.querySelector('.convai-capsule__hint')).toBeNull();
    expect(screen.queryByRole('button', { name: /Type/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Quick controls/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }));
    expect(onMute).toHaveBeenCalledOnce();
  });

  it('says the hint where nothing is seen, and Unmute while muted', () => {
    render(
      <Capsule
        name="Kira"
        state="muted"
        mode="hands-free"
        floating={{ source: null, muted: true, onMute: vi.fn() }}
      />,
    );
    expect(document.querySelector('.convai-capsule__hint')).toHaveTextContent('M to unmute');
    expect(screen.getByRole('button', { name: 'Unmute microphone' })).toBeInTheDocument();
  });
});
