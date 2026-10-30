import { describe, expect, it, vi } from 'vitest';
import { howToUsePage, settingsSections, type Row, type SettingsContext } from './sections';
import { defaultKeys } from './shortcuts';
import { defaultSettings } from './stored';

function context(change: Partial<SettingsContext> = {}): SettingsContext {
  return {
    name: 'Kira',
    character: { line: 'English · Connected', portrait: null },
    talkMode: 'push-to-talk',
    talkKey: 'T',
    settings: defaultSettings,
    set: vi.fn(),
    setTalkMode: vi.fn(),
    openPicker: vi.fn(),
    answering: false,
    askClear: vi.fn(),
    microphones: [
      { value: '', label: 'Default · Studio USB' },
      { value: 'usb', label: 'Studio USB' },
    ],
    microphone: '',
    setMicrophone: vi.fn(),
    microphoneFailed: false,
    microphonesNamed: true,
    test: { phase: 'idle' },
    startTest: vi.fn(),
    apple: false,
    keys: defaultKeys,
    changeTalkKey: vi.fn(),
    askResetAll: vi.fn(),
    openSection: vi.fn(),
    openPage: vi.fn(),
    cameras: [
      { value: 'front', label: 'Front camera' },
      { value: 'desk', label: 'Desk camera' },
    ],
    camera: 'front',
    setCamera: vi.fn(),
    camerasNamed: true,
    version: '1.2.3',
    copied: null,
    copyVersion: vi.fn(),
    supportDetails: 'Convai Vision Assistant 1.2.3',
    copyDetails: vi.fn(),
    showWelcome: vi.fn(),
    showTips: vi.fn(),
    tipsAgain: false,
    tryTips: vi.fn(),
    compactSupported: true,
    ...change,
  };
}

/** Every section as "Title: group › row, row; group › row". */
function outline(given: SettingsContext): string[] {
  return settingsSections(given).map(
    (section) =>
      `${section.title}: ${section.groups
        .map((group) => `${group.label} › ${group.rows.map((row) => row.label).join(', ')}`)
        .join('; ')}`,
  );
}

function row(given: SettingsContext, id: string): Row {
  const found = settingsSections(given)
    .flatMap((section) => section.groups.flatMap((group) => group.rows))
    .find((one) => one.id === id);
  if (!found) throw new Error(`No row ${id}`);
  return found;
}

describe('the sections of Settings on the web', () => {
  it('show the rows the web can back, in the component’s order, and none it cannot', () => {
    expect(outline(context())).toEqual([
      'Talking: How you talk › Mode, Push to talk key; Kira’s words › Captions, Transcript style, Clear this conversation; Tips › Show tips again',
      'Audio: Microphone › Input device, Test your microphone; Speaker › Kira’s volume',
      'Accessibility: Reading › Text size, Stronger caption backing, Increase contrast; Motion › Reduce motion; Screen reader › Read Kira’s answers to the screen reader',
      'Shortcuts: Talking › Talk, Type a message, Stop Kira, Mute microphone, Hands free on or off; Panels › Transcript, Quick controls, Settings; From Vision Assistant › Characters, Pause vision',
      'Window:  › Compact on the web',
      'Vision: Sources › Camera, Mirror my camera',
      'Privacy: Sent to Convai, only during a conversation › What you say, What you type, Live video of what you share; Stays on this device › Your settings; Local recording › Pictures and recordings; Your choices › Camera, microphone and screen access',
      'About:  › Convai Vision Assistant; Help › How to use, Keyboard shortcuts; Legal › Open-source licenses;  › Show welcome again, Support details',
    ]);
  });

  it('draws the sidebar’s label above Window and a gap above Privacy, as the Part does', () => {
    const sections = settingsSections(context());
    expect(sections.map((one) => one.labelBefore ?? (one.gapBefore ? '(gap)' : ''))).toEqual([
      '',
      '',
      '',
      '',
      'Vision Assistant',
      '',
      '(gap)',
      '',
    ]);

    expect(sections.find((one) => one.id === 'vision')?.intro).toBe(
      'Kira sees what you share live, only while you share and it isn’t paused, with the mint Live dot on the source chip.',
    );
    expect(sections.find((one) => one.id === 'privacy')?.intro).toBe(
      'Kira hears you only while you talk.',
    );
  });

  it('shows the talk key only while it is held to talk', () => {
    expect(outline(context({ talkMode: 'hands-free' }))[0]).toBe(
      'Talking: How you talk › Mode; Kira’s words › Captions, Transcript style, Clear this conversation; Tips › Show tips again',
    );
    const given = context({ talkKey: 'V' });
    const key = row(given, 'talk-key');
    expect(key).toMatchObject({
      kind: 'link',
      keys: ['V'],
      description: 'Hold while this tab is in front. Change it in Shortcuts.',
    });
    if (key.kind !== 'link') throw new Error('talk-key');
    key.open();
    expect(given.changeTalkKey).toHaveBeenCalledOnce();
    // Left without a key, the row says so in place of a cap.
    const none = row(context({ talkKey: '' }), 'talk-key');
    expect(none).toMatchObject({ value: 'Not set' });
    expect(none).not.toHaveProperty('keys');
  });

  it('puts the character’s card on Talking, whose Change opens the picker', () => {
    const given = context();
    const [talking] = settingsSections(given);
    expect(talking?.card).toMatchObject({ name: 'Kira', line: 'English · Connected' });
    talking?.card?.change();
    expect(given.openPicker).toHaveBeenCalledOnce();
    expect(settingsSections(context({ character: null }))[0]?.card).toBeUndefined();
  });

  it('writes how you talk to the session and the rest to the store', () => {
    const given = context();
    const mode = row(given, 'mode');
    if (mode.kind !== 'segmented') throw new Error('mode');
    mode.set('hands-free');
    expect(given.setTalkMode).toHaveBeenCalledWith('hands-free');
    const captions = row(given, 'captions');
    if (captions.kind !== 'switch') throw new Error('captions');
    captions.set(false);
    expect(given.set).toHaveBeenCalledWith({ captions: false });
    const style = row(given, 'transcript-style');
    if (style.kind !== 'cards') throw new Error('style');
    style.set('conversation');
    expect(given.set).toHaveBeenCalledWith({ transcriptStyle: 'conversation' });
    const size = row(given, 'text-size');
    if (size.kind !== 'slider') throw new Error('size');
    expect(size).toMatchObject({ min: 0.9, max: 1.3, step: 0.05, value: 1 });

    expect(size.description).toBe(
      'Captions, the transcript and Settings; Quick controls changes the same value',
    );
    expect(size.format(1.15)).toBe('115%');
    size.set(1.2);
    expect(given.set).toHaveBeenCalledWith({ textScale: 1.2 });
    const contrast = row(given, 'contrast');
    if (contrast.kind !== 'segmented') throw new Error('contrast');
    contrast.set('on');
    expect(given.set).toHaveBeenCalledWith({ highContrast: 'on' });
    const read = row(given, 'read-answers');
    if (read.kind !== 'switch') throw new Error('read');
    expect(read.on).toBe(false);
  });

  it('holds Clear back while an answer is under way, saying why', () => {
    expect(row(context(), 'clear')).not.toHaveProperty('reason');
    expect(row(context({ answering: true }), 'clear')).toMatchObject({
      reason: 'Available when Kira finishes this answer',
    });
  });

  it('offers the default while the browser lists, and says why devices have no names', () => {
    const loading = row(context({ microphones: null }), 'input-device');
    expect(loading).toMatchObject({ options: [{ value: '', label: 'Default' }] });
    expect(loading).not.toHaveProperty('description');
    expect(row(context({ microphonesNamed: false }), 'input-device')).toMatchObject({
      description: 'Allow the microphone in the browser to choose a device by name.',
    });
    expect(row(context({ microphoneFailed: true }), 'input-device')).toMatchObject({
      warning: true,
    });
  });

  it('says there is no microphone in place of the device rows', () => {
    expect(outline(context({ microphones: [] }))[1]).toBe(
      'Audio: Microphone › No microphone found; Speaker › Kira’s volume',
    );
  });

  it('names each step of the microphone test on its button', () => {
    const words = (test: SettingsContext['test']) => {
      const one = row(context({ test }), 'test');
      return one.kind === 'button' ? [one.action, one.busy, one.description] : [];
    };
    expect(words({ phase: 'idle' })).toEqual([
      'Test',
      false,
      'Records 3 seconds, then plays them back',
    ]);
    expect(words({ phase: 'recording', left: 2 })[0]).toBe('Recording · 2');
    expect(words({ phase: 'playing' }).slice(0, 2)).toEqual(['Playing back', true]);
    expect(words({ phase: 'failed' })[2]).toBe(
      'Couldn’t open the microphone. Allow it in the browser’s site settings.',
    );
  });

  describe('Shortcuts (S4)', () => {
    const shortcut = (given: SettingsContext, id: string) => {
      const one = row(given, `shortcut-${id}`);
      if (one.kind !== 'shortcut') throw new Error(id);
      return one;
    };

    it('lists each key as it is now: Talk held, Hands free following it, the chords locked', () => {
      const given = context();
      expect(shortcut(given, 'talk')).toMatchObject({
        caps: ['T'],
        hold: true,
        changes: 'talk',
        changed: false,
        locked: false,
      });
      expect(shortcut(given, 'type').caps).toEqual(['/']);
      expect(shortcut(given, 'hands-free')).toMatchObject({
        caps: ['Shift', 'T'],
        changes: null,
        locked: false,
        description: 'Shift with the Talk key. Follows it.',
      });
      for (const [id, caps] of [
        ['stop', ['Esc']],
        ['settings', ['Ctrl', ',']],
        ['characters', ['Ctrl', 'K']],
        ['pause-vision', ['Alt', 'V']],
      ] as const)
        expect(shortcut(given, id)).toMatchObject({
          caps,
          changes: null,
          locked: true,
          description: 'Can’t be changed',
        });
      const apple = context({ apple: true });
      expect(shortcut(apple, 'settings').caps).toEqual(['⌘', ',']);
      expect(shortcut(apple, 'characters').caps).toEqual(['⌘', 'K']);
      expect(shortcut(apple, 'pause-vision').caps).toEqual(['⌥', 'V']);
    });

    it('marks a changed key, a key left without one, and Hands free following a new Talk key', () => {
      const given = context({ keys: { ...defaultKeys, talk: 'm', mute: '' } });
      expect(shortcut(given, 'talk')).toMatchObject({ caps: ['M'], changed: true });
      expect(shortcut(given, 'mute')).toMatchObject({ caps: [], changed: true });
      expect(shortcut(given, 'hands-free').caps).toEqual(['Shift', 'M']);
      expect(shortcut(context({ keys: { ...defaultKeys, talk: '' } }), 'hands-free').caps).toEqual(
        [],
      );
    });

    it('offers Reset all on From Vision Assistant, the last group, only once a key changed', () => {
      const groups = (given: SettingsContext) =>
        settingsSections(given).find((one) => one.id === 'shortcuts')?.groups ?? [];
      expect(groups(context()).some((group) => group.action)).toBe(false);
      const given = context({ keys: { ...defaultKeys, transcript: 'q' } });
      const [talking, panels, app] = groups(given);
      expect(talking?.action).toBeUndefined();
      expect(panels?.action).toBeUndefined();
      expect(app?.action?.label).toBe('Reset all shortcuts');
      app?.action?.run();
      expect(given.askResetAll).toHaveBeenCalledOnce();
    });
  });

  describe('Window (S1)', () => {
    it('says Compact is supported where the browser has floating windows', () => {
      expect(row(context(), 'compact')).toEqual({
        id: 'compact',
        kind: 'note',
        label: 'Compact on the web',
        description:
          'Uses this browser’s Picture-in-Picture window. Switch with Window mode at the top.',
        value: 'Supported',
        keywords: 'compact floating picture in picture pip small capsule mode',
      });
    });

    it('elsewhere says so, with the Compact card’s words in the character’s name', () => {
      expect(row(context({ compactSupported: false, name: 'Ada' }), 'compact')).toMatchObject({
        kind: 'note',
        value: 'Not in this browser',
        description:
          'Ada stays in this tab because this browser does not support floating windows. Try a desktop browser with Document Picture-in-Picture support.',
      });
    });

    it('has no way to change the mode: the title bar’s switch is the web’s', () => {
      const window = settingsSections(context()).find((one) => one.id === 'window');
      expect(window?.groups.flatMap((group) => group.rows).map((one) => one.kind)).toEqual([
        'note',
      ]);
    });
  });

  describe('Vision (S3)', () => {
    it('chooses the camera and keeps the mirror', () => {
      const given = context();
      const camera = row(given, 'camera');
      expect(camera).toMatchObject({ kind: 'select', value: 'front' });
      expect(camera).not.toHaveProperty('description');
      if (camera.kind !== 'select') throw new Error('camera');
      camera.set('desk');
      expect(given.setCamera).toHaveBeenCalledWith('desk');
      const mirror = row(given, 'mirror');
      expect(mirror).toMatchObject({
        kind: 'switch',
        on: true,
        description: 'The preview only; Kira sees the real image',
      });
      if (mirror.kind !== 'switch') throw new Error('mirror');
      mirror.set(false);
      expect(given.set).toHaveBeenCalledWith({ mirrorCamera: false });
    });

    it('offers the default while the browser lists, says why cameras have no names, or that there is none', () => {
      expect(row(context({ cameras: null }), 'camera')).toMatchObject({
        options: [{ value: '', label: 'Default' }],
      });
      expect(row(context({ camerasNamed: false }), 'camera')).toMatchObject({
        description: 'Allow the camera in the browser to choose one by name.',
      });
      expect(outline(context({ cameras: [] }))[5]).toBe(
        'Vision: Sources › No camera found, Mirror my camera',
      );
    });
  });

  describe('About (S7)', () => {
    it('says the version and copies it, saying when it did and when it could not', () => {
      const given = context();
      const version = row(given, 'version');
      expect(version).toMatchObject({
        kind: 'button',
        strong: true,
        description: 'Version 1.2.3 · Conversation by Convai',
        action: 'Copy version',
      });
      if (version.kind !== 'button') throw new Error('version');
      version.run();
      expect(given.copyVersion).toHaveBeenCalledOnce();
      expect(row(context({ copied: { row: 'version', ok: true } }), 'version')).toMatchObject({
        action: 'Copied',
      });
      // A failed copy keeps the version to select, and says so under it.
      expect(row(context({ copied: { row: 'version', ok: false } }), 'version')).toMatchObject({
        action: 'Copy version',
        description: 'Version 1.2.3 · Conversation by Convai',
        problem: 'Couldn’t copy. Select the version above and copy it instead.',
      });
      expect(row(context({ copied: { row: 'support', ok: false } }), 'support')).toMatchObject({
        problem: 'Couldn’t copy. Select the details below and copy them instead.',
        detail: 'Convai Vision Assistant 1.2.3',
      });
      expect(row(context(), 'support')).not.toHaveProperty('detail');
      // A copy of the other row says nothing here.
      expect(row(context({ copied: { row: 'support', ok: true } }), 'version')).toMatchObject({
        action: 'Copy version',
      });
    });

    it('opens How to use and the licenses as pages, the keys as their section, and the welcome', () => {
      const given = context();
      const open = (id: string) => {
        const one = row(given, id);
        if (one.kind === 'link') one.open();
        else if (one.kind === 'button') one.run();
        else throw new Error(id);
      };
      open('howto');
      open('licenses');
      expect(given.openPage).toHaveBeenNthCalledWith(1, 'howto');
      expect(given.openPage).toHaveBeenNthCalledWith(2, 'licenses');
      open('keyboard');
      expect(given.openSection).toHaveBeenCalledWith('shortcuts');
      open('welcome');
      expect(given.showWelcome).toHaveBeenCalledOnce();
      open('support');
      expect(given.copyDetails).toHaveBeenCalledOnce();
    });
  });

  describe('How to use (S8)', () => {
    const steps = (given: SettingsContext) =>
      howToUsePage(given).groups.flatMap((group) =>
        group.rows.flatMap((one) =>
          one.kind === 'step' ? [`${String(one.number)} ${one.label}: ${one.keys.join(' ')}`] : [],
        ),
      );

    it('numbers the steps with the person’s own keys', () => {
      expect(steps(context())).toEqual([
        '1 Just talk: T',
        '2 Stop Kira: Esc',
        '3 Mute or type: M /',
        '4 Pause vision: Alt V',
        '5 Characters: Ctrl K',
      ]);
      expect(
        steps(context({ keys: { talk: 'g', type: '', mute: 'q', transcript: 'r', quick: '' } })),
      ).toEqual([
        '1 Just talk: G',
        '2 Stop Kira: Esc',
        '3 Mute or type: Q',
        '4 Pause vision: Alt V',
        '5 Characters: Ctrl K',
      ]);
    });

    it('says how to talk without a talk key', () => {
      const [first] =
        howToUsePage(context({ keys: { ...defaultKeys, talk: '' } })).groups[0]?.rows ?? [];
      expect(first?.description).toBe(
        'Turn on Hands free, or give Talk a key in Shortcuts, and Kira listens.',
      );
      const [withKey] = howToUsePage(context()).groups[0]?.rows ?? [];
      expect(withKey?.description).toBe(
        'Hold T while this tab is in front, or turn on Hands free.',
      );
    });

    it('ends with Try it, the page’s one primary action, which shows the tips again', () => {
      const given = context();
      const tryIt = howToUsePage(given).groups.at(-1)?.rows[0];
      expect(tryIt).toMatchObject({
        id: 'try-tips',
        kind: 'button',
        label: 'Try it with Kira',
        description: 'Shows the tips again, from the first one',
        action: 'Try it',
        primary: true,
      });
      if (tryIt?.kind === 'button') tryIt.run();
      expect(given.tryTips).toHaveBeenCalledOnce();
    });
  });

  describe('Talking › Tips (S6)', () => {
    it('ends the section with Show tips again, which says when they start once pressed', () => {
      const given = context();
      const talking = settingsSections(given)[0];
      expect(talking?.groups.at(-1)?.label).toBe('Tips');
      const tips = row(given, 'tips');
      expect(tips).toMatchObject({
        kind: 'button',
        label: 'Show tips again',
        description: 'Replays the first-session tips, from the first one',
        action: 'Show again',
      });
      if (tips.kind === 'button') tips.run();
      expect(given.showTips).toHaveBeenCalledOnce();
      expect(row(context({ tipsAgain: true }), 'tips').description).toBe(
        'The tips start again when you close Settings',
      );
    });
  });
});
