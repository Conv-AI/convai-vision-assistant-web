import { describe, expect, it, vi } from 'vitest';
import type { TalkMode } from '../kit/capsule/capsuleCopy';
import type { Access, Device } from './access';
import { FirstRunFlow, type FirstRunOptions } from './flow';

function flow(options: Partial<FirstRunOptions> = {}) {
  const answers: { device: Device; resolve: (access: Access) => void }[] = [];
  const onTalkMode = vi.fn<(mode: TalkMode) => void>();
  const onDone = vi.fn<() => void>();
  const onTalkKey = vi.fn<(key: string) => void>();
  const run = new FirstRunFlow({
    name: 'Kira',
    talkMode: null,
    talkKey: 't',
    microphone: 'not-asked',
    camera: 'not-asked',
    ask: (device) =>
      new Promise<Access>((resolve) => {
        answers.push({ device, resolve });
      }),
    onTalkMode,
    onTalkKey,
    onDone,
    ...options,
  });
  return { run, answers, onTalkMode, onDone, onTalkKey };
}

/** Lets the flow take a resolved prompt's answer. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function stepsOf(run: FirstRunFlow): string[] {
  const seen: string[] = [run.step];
  // Bounded: a run that cannot go on fails here rather than hanging.
  for (let i = 0; i < 8 && run.step !== 'all-set'; i++) {
    run.next();
    seen.push(run.step);
  }
  return seen;
}

describe('FirstRunFlow: the steps', () => {
  it('runs Welcome, How to talk, Permissions and All set with nothing chosen before', () => {
    const { run } = flow();
    expect(run.step).toBe('welcome');
    expect(run.talkMode).toBe('hands-free');
    run.next();
    run.next();
    expect(run.step).toBe('permissions');

    run.next();
    expect(run.step).toBe('all-set');
  });

  it('puts the talk key after How to talk while push to talk is chosen', () => {
    const { run } = flow({ microphone: 'allowed', camera: 'allowed' });
    run.next();
    run.choose('push-to-talk');
    expect(stepsOf(run)).toEqual(['how-to-talk', 'talk-key', 'all-set']);
  });

  it('takes the talk key away again when hands free is chosen after Back', () => {
    const { run } = flow({ talkMode: 'push-to-talk', microphone: 'allowed', camera: 'allowed' });
    run.next();
    run.next();
    expect(run.step).toBe('talk-key');
    run.back();
    run.choose('hands-free');
    run.next();
    expect(run.step).toBe('all-set');
  });

  it('starts from the way of talking chosen before', () => {
    expect(flow({ talkMode: 'push-to-talk' }).run.talkMode).toBe('push-to-talk');
  });

  it('leaves Permissions out when nothing is left to ask', () => {
    const { run } = flow({ microphone: 'allowed', camera: 'missing' });
    expect(stepsOf(run)).toEqual(['welcome', 'how-to-talk', 'all-set']);
  });

  it('leaves Permissions out when neither device is there', () => {
    const { run } = flow({ microphone: 'missing', camera: 'missing' });
    expect(stepsOf(run)).toEqual(['welcome', 'how-to-talk', 'all-set']);
  });

  it('keeps Permissions for an optional camera that was never asked', () => {
    const { run } = flow({ microphone: 'allowed', camera: 'not-asked' });
    expect(stepsOf(run)).toEqual(['welcome', 'how-to-talk', 'permissions', 'all-set']);
  });

  it('saves the way of talking when How to talk is left, also the preselected one', () => {
    const { run, onTalkMode } = flow();
    run.next();
    expect(onTalkMode).not.toHaveBeenCalled();
    run.next();
    expect(onTalkMode).toHaveBeenCalledExactlyOnceWith('hands-free');
  });

  it('ends with Start, once', () => {
    const { run, onDone } = flow({ microphone: 'allowed', camera: 'allowed' });
    run.next();
    run.next();
    run.next();
    run.next();
    expect(run.isDone).toBe(true);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('has Back on every step between Welcome and All set', () => {
    const { run } = flow({ talkMode: 'push-to-talk' });
    const back: boolean[] = [run.canGoBack];
    for (let i = 0; i < 3; i++) {
      run.next();
      back.push(run.canGoBack);
    }
    expect(run.step).toBe('permissions');
    run.next();
    back.push(run.canGoBack);
    expect(back).toEqual([false, true, true, true, false]);
    expect(run.back()).toBe(false);
  });

  it('counts the steps between Welcome and All set as the dashes', () => {
    const { run } = flow();
    expect(run.stepCount).toBe(2);
    expect(run.announcement).toBe('Show Kira what you see');
    run.next();
    expect(run.stepNumber).toBe(1);
    expect(run.announcement).toBe('Step 1 of 2, How do you want to talk?');
    run.next();
    expect(run.announcement).toBe('Step 2 of 2, Let Kira hear and see');
  });

  it('lights every dash on All set, which is no step of its own', () => {
    const { run } = flow({ talkMode: 'push-to-talk', compact: true });
    expect(stepsOf(run)).toEqual([
      'welcome',
      'how-to-talk',
      'talk-key',
      'permissions',
      'window',
      'all-set',
    ]);
    expect(run.stepCount).toBe(4);
    expect(run.stepNumber).toBe(4);
    expect(run.announcement).toBe('You’re all set');
  });

  it('counts only the steps this run has, and draws no dashes for one', () => {
    const { run } = flow({ microphone: 'allowed', camera: 'missing' });
    run.next();
    expect(run.stepCount).toBe(0);
    expect(run.announcement).toBe('How do you want to talk?');
    run.next();
    expect(run.step).toBe('all-set');
    expect(run.announcement).toBe('You’re all set');
  });

  it('shows Permissions for a microphone that is blocked from the start', () => {
    const { run } = flow({ microphone: 'blocked', camera: 'allowed' });
    expect(stepsOf(run)).toEqual(['welcome', 'how-to-talk', 'permissions', 'all-set']);
  });
});

describe('FirstRunFlow: How to talk', () => {
  it('names the choice on its button and the key in the card', () => {
    const { run } = flow({ talkKey: 'g' });
    run.next();
    expect(run.buttonLabel).toBe('Continue with Hands free');
    run.choose('push-to-talk');
    expect(run.buttonLabel).toBe('Continue with Push to talk');
    expect(run.modeLine('push-to-talk')).toBe('Hold G while you talk. Let go and Kira answers.');
    expect(run.modeLine('hands-free')).toBe('Just talk. Kira listens whenever you speak.');
  });

  it('says where to switch later: the Quick controls’ Hands free tile', () => {
    const { run } = flow();
    run.next();
    expect(run.body).toBe('You can switch any time in Quick controls.');
  });
});

describe('FirstRunFlow: Permissions', () => {
  it('offers Allow on the microphone and a live Continue', () => {
    const { run, answers } = flow();
    run.next();
    run.next();
    expect(run.title).toBe('Let Kira hear and see');
    expect(run.body).toBe(
      'Only the microphone is needed to start. The rest can wait until you first share.',
    );
    expect(run.note).toBe('Kira sees only what you share.');
    expect(run.buttonLabel).toBe('Continue');
    expect(run.buttonIsPrimary).toBe(true);
    const [microphone, camera] = run.rows;
    expect(microphone).toMatchObject({
      action: 'Allow',
      primary: true,
      warn: false,
      line: 'So you can just talk. You can type instead.',
    });
    expect(camera).toMatchObject({
      action: 'Allow',
      primary: false,
      line: 'To show Kira things in front of you. Optional.',
    });
    run.next();
    expect(run.step).toBe('all-set');
    expect(answers).toHaveLength(0);
  });

  it('asks the browser once for one press', async () => {
    const { run, answers } = flow();
    run.next();
    run.next();
    run.act('microphone');
    run.act('microphone');
    run.act('camera');
    expect(answers.map((answer) => answer.device)).toEqual(['microphone']);
    answers[0]?.resolve('allowed');
    await settle();
    expect(run.rows[0]).toMatchObject({ allowed: true, action: null });
    expect(run.buttonLabel).toBe('Continue');
    expect(run.buttonIsPrimary).toBe(true);
  });

  it('offers Try again after the prompt was closed, and typing as the large button', async () => {
    const { run, answers } = flow();
    run.next();
    run.next();
    run.act('microphone');
    answers[0]?.resolve('refused');
    await settle();
    expect(run.title).toBe('Talk or type, your choice');
    expect(run.body).toBe('Allow the microphone to just talk, or type your questions.');
    expect(run.note).toBe(
      'Try again to allow the microphone, or allow it in your browser’s site settings.',
    );
    expect(run.rows[0]).toMatchObject({
      line: 'Off. Kira can’t hear you',
      action: 'Try again',
      primary: true,
      warn: true,
    });
    expect(run.buttonLabel).toBe('Type instead');
    expect(run.buttonIsPrimary).toBe(false);
  });

  it('says where to allow a blocked microphone, with no button that opens nothing', async () => {
    const { run, answers } = flow();
    run.next();
    run.next();
    run.act('microphone');
    answers[0]?.resolve('blocked');
    await settle();
    expect(run.title).toBe('Talk or type, your choice');
    expect(run.body).toBe(
      'You can type now. To talk, allow the microphone in your browser’s site settings.',
    );
    expect(run.note).toBe('This page updates as soon as you allow it.');

    expect(run.rows.map((row) => row.device)).toEqual(['microphone', 'camera']);

    expect(run.rows[0]).toMatchObject({
      line: 'Vision Assistant needs your microphone',
      action: null,
      stateWord: 'Blocked',
      warn: true,
    });
    expect(run.buttonLabel).toBe('Type instead');
    expect(run.buttonIsPrimary).toBe(true);
    run.act('microphone');
    expect(answers).toHaveLength(1);
  });

  it('goes on by itself when access comes back and the camera was answered', () => {
    const { run } = flow({ microphone: 'blocked', camera: 'allowed' });
    run.next();
    run.next();
    expect(run.step).toBe('permissions');
    run.set('microphone', 'allowed');
    expect(run.step).toBe('all-set');
  });

  it('stays when access comes back while the camera row is unanswered', () => {
    const { run } = flow({ microphone: 'blocked', camera: 'not-asked' });
    run.next();
    run.next();
    run.set('microphone', 'allowed');
    expect(run.step).toBe('permissions');
    expect(run.rows).toHaveLength(2);
    expect(run.title).toBe('Let Kira hear and see');
  });

  it('names a microphone in use and lets the person try again', async () => {
    const { run, answers } = flow();
    run.next();
    run.next();
    run.act('microphone');
    answers[0]?.resolve('busy');
    await settle();
    expect(run.rows[0]).toMatchObject({
      line: 'Microphone in use by another app',
      action: 'Try again',
      warn: true,
    });
    expect(run.buttonLabel).toBe('Type instead');
  });

  it('shows a missing microphone as not connected and goes on with typing', () => {
    const { run } = flow({ microphone: 'missing' });
    run.next();
    run.next();
    expect(run.rows[0]).toMatchObject({ action: null, stateWord: 'No microphone' });
    expect(run.buttonLabel).toBe('Type instead');
  });

  it('asks the camera again after its prompt was closed', async () => {
    const { run, answers } = flow({ microphone: 'allowed' });
    run.next();
    run.next();
    run.act('camera');
    answers[0]?.resolve('refused');
    await settle();
    expect(run.accessOf('camera')).toBe('not-asked');
    expect(run.rows[1]).toMatchObject({ action: 'Allow' });
  });

  it('says a blocked camera is optional and blocked', () => {
    const { run } = flow({ microphone: 'not-asked', camera: 'blocked' });
    run.next();
    run.next();
    expect(run.body).toBe('Only the microphone is needed to start.');
    expect(run.rows[1]).toMatchObject({
      line: 'Optional. Blocked in your browser’s site settings.',
      action: null,
      stateWord: 'Blocked',
    });
  });

  it('calls a camera that is not there not connected', () => {
    const { run } = flow({ camera: 'missing' });
    run.next();
    run.next();
    expect(run.rows[1]).toMatchObject({ action: null, stateWord: 'Not connected' });
  });
});

describe('FirstRunFlow: All set', () => {
  function allSet(options: Partial<FirstRunOptions>) {
    const made = flow(options);
    const { run } = made;
    for (let i = 0; i < 8 && run.step !== 'all-set'; i++) run.next();
    expect(run.step).toBe('all-set');
    return made.run;
  }

  it('sums up push to talk with its key and the camera to come', () => {
    const run = allSet({ talkMode: 'push-to-talk', microphone: 'allowed' });
    expect(run.body).toBe('Hold T and ask Kira about what you share.');
    expect(run.chips).toEqual([
      { label: 'Push to talk · T', on: true },
      { label: 'Microphone', on: true },
      { label: 'Camera when you share', on: false },
    ]);
    expect(run.note).toBe('');
    expect(run.buttonLabel).toBe('Start');
  });

  it('says hands free is ready, not listening, before Start', () => {
    const run = allSet({ talkMode: 'hands-free', microphone: 'allowed', camera: 'allowed' });
    expect(run.body).toBe('Kira is ready. Start when you are.');
    expect(run.chips.map((chip) => chip.label)).toEqual(['Hands free', 'Microphone', 'Camera']);
  });

  it('past an unasked microphone keeps the way of talking and says when it is asked', () => {
    const run = allSet({ talkMode: 'push-to-talk', talkKey: 'g' });
    expect(run.body).toBe('Hold G and ask Kira about what you share.');
    expect(run.note).toBe('Kira asks for the microphone the first time you hold G.');
    expect(run.chips.slice(0, 2)).toEqual([
      { label: 'Push to talk · G', on: true },
      { label: 'Microphone when you talk', on: false },
    ]);
  });

  it('past an unasked microphone in hands free points at the microphone button', () => {
    const run = allSet({ talkMode: 'hands-free' });
    expect(run.body).toBe('Kira is ready. Start when you are.');
    expect(run.note).toBe('Kira asks for the microphone when you press the microphone button.');
    expect(run.chips[0]).toEqual({ label: 'Hands free', on: true });
  });

  it('after Type instead on a refused microphone goes on with typing', async () => {
    const { run, answers } = flow({ talkMode: 'push-to-talk' });
    for (let i = 0; i < 8 && run.step !== 'permissions'; i++) run.next();
    run.act('microphone');
    answers[0]?.resolve('refused');
    await settle();
    run.next();
    for (let i = 0; i < 8 && run.step !== 'all-set'; i++) run.next();
    expect(run.body).toBe('Press / to type to Kira.');
    expect(run.chips.slice(0, 2)).toEqual([
      { label: 'Typing', on: true },
      { label: 'Microphone off', on: false },
    ]);
  });

  it('names the site settings once the microphone was refused or blocked', () => {
    expect(allSet({ microphone: 'blocked' }).note).toBe(
      'To talk later, allow the microphone in your browser’s site settings.',
    );
  });

  it('says why there is no voice when no microphone is there', () => {
    const run = allSet({ microphone: 'missing', camera: 'missing' });
    expect(run.body).toBe('No microphone. Press / to type to Kira.');
    expect(run.chips).toEqual([
      { label: 'Typing', on: true },
      { label: 'No microphone', on: false },
    ]);
  });

  it('marks a blocked camera with where to mend it', () => {
    const run = allSet({ microphone: 'allowed', camera: 'blocked' });
    expect(run.chips[2]).toEqual({
      label: 'Camera blocked',
      on: false,
      tooltip: 'Blocked in your browser’s site settings',
    });
    expect(run.allSetNotes).toEqual([
      'Allow the camera in your browser’s site settings to let Kira see.',
    ]);
  });
});

describe('FirstRunFlow: the welcome shown again (Settings › About)', () => {
  it('shows Welcome and How to talk only, from the way of talking now, and ends with Done', () => {
    const { run, onDone, onTalkMode } = flow({
      replay: true,
      talkMode: 'push-to-talk',
      microphone: 'blocked',
      camera: 'not-asked',
    });
    expect(run.isReplay).toBe(true);
    expect(run.step).toBe('welcome');
    expect(run.buttonLabel).toBe('Get started');
    run.next();
    expect(run.step).toBe('how-to-talk');
    expect(run.talkMode).toBe('push-to-talk');
    // No dashes for one step after Welcome; Back goes to Welcome.
    expect(run.stepCount).toBe(0);
    expect(run.canGoBack).toBe(true);
    expect(run.buttonLabel).toBe('Done');
    // Choosing a card changes nothing that is kept, also with the talk key's step in another run.
    run.choose('hands-free');
    run.choose('push-to-talk');
    expect(run.buttonLabel).toBe('Done');
    run.next();
    expect(run.isDone).toBe(true);
    expect(onDone).toHaveBeenCalledOnce();
    expect(onTalkMode).not.toHaveBeenCalled();
  });

  it('runs every step as before when it is no replay', () => {
    const { run } = flow({ talkMode: 'push-to-talk', microphone: 'allowed', camera: 'allowed' });
    expect(run.isReplay).toBe(false);
    expect(stepsOf(run)).toEqual(['welcome', 'how-to-talk', 'talk-key', 'all-set']);
  });
});

describe('FirstRunFlow: Where should Kira stay (F4)', () => {
  it('stands after Permissions and before All set where Compact can open', () => {
    const { run } = flow({ compact: true, talkMode: 'push-to-talk' });
    run.next();
    run.next();
    run.next();
    expect(run.step).toBe('permissions');
    run.next();
    expect(run.step).toBe('window');
    expect(run.stepNumber).toBe(4);
    expect(run.stepCount).toBe(4);
    expect(run.announcement).toBe('Step 4 of 4, Where should Kira stay?');
    run.next();
    expect(run.step).toBe('all-set');
  });

  it('stands before All set also in a run without Permissions', () => {
    const { run } = flow({ compact: true, microphone: 'allowed', camera: 'allowed' });
    expect(stepsOf(run)).toEqual(['welcome', 'how-to-talk', 'window', 'all-set']);
  });

  it('keeps its place when the way of talking changes the steps after How to talk', () => {
    const { run } = flow({ compact: true, microphone: 'allowed', camera: 'allowed' });
    run.next();
    run.choose('push-to-talk');
    expect(stepsOf(run)).toEqual(['how-to-talk', 'talk-key', 'window', 'all-set']);
  });

  it('is left out where the browser has no floating window: one mode is no choice', () => {
    const { run } = flow({ compact: false, microphone: 'allowed', camera: 'allowed' });
    expect(stepsOf(run)).toEqual(['welcome', 'how-to-talk', 'all-set']);
    expect(run.chips.map((chip) => chip.label)).toEqual(['Hands free', 'Microphone', 'Camera']);
  });

  it('says where to change it, offers both modes and starts at the full window', () => {
    const { run } = flow({ compact: true, microphone: 'allowed', camera: 'allowed' });
    run.next();
    run.next();
    expect(run.title).toBe('Where should Kira stay?');
    expect(run.body).toBe('Switch any time from the title bar.');
    expect(run.buttonLabel).toBe('Continue');
    expect(run.buttonIsPrimary).toBe(true);
    expect(run.canGoBack).toBe(true);
    expect(run.windowMode).toBe('full');
    expect([run.windowName('full'), run.windowLine('full')]).toEqual([
      'Full window',
      'A big stage for your camera, with the conversation beside it.',
    ]);
    expect([run.windowName('compact'), run.windowLine('compact')]).toEqual([
      'Compact',
      'A small capsule that floats over any app.',
    ]);
  });

  it('starts at the mode chosen before', () => {
    const { run } = flow({ compact: true, windowMode: 'compact' });
    expect(run.windowMode).toBe('compact');
  });

  it('hands the mode on when its step is left, and names it on All set', () => {
    const onWindowMode = vi.fn<(mode: 'full' | 'compact') => void>();
    const { run, onDone } = flow({
      compact: true,
      microphone: 'allowed',
      camera: 'allowed',
      onWindowMode,
    });
    run.next();
    run.next();
    run.chooseWindow('compact');
    run.chooseWindow('compact');
    expect(onWindowMode).not.toHaveBeenCalled();
    run.next();
    expect(onWindowMode).toHaveBeenCalledExactlyOnceWith('compact');
    expect(run.chips).toEqual([
      { label: 'Hands free', on: true },
      { label: 'Microphone', on: true },
      { label: 'Camera', on: true },
      { label: 'Compact', on: true },
    ]);
    expect(onDone).not.toHaveBeenCalled();
    run.next();
    expect(onDone).toHaveBeenCalledOnce();
    expect(run.windowMode).toBe('compact');
  });

  it('tells its listeners of a real change only', () => {
    const { run } = flow({ compact: true });
    let told = 0;
    run.subscribe(() => {
      told++;
    });
    run.chooseWindow('full');
    run.chooseWindow('compact');
    expect(told).toBe(1);
  });

  it('in a replay is the last step, from the mode the window is in, and ends with Done', () => {
    const onWindowMode = vi.fn<(mode: 'full' | 'compact') => void>();
    const { run, onDone } = flow({
      replay: true,
      compact: true,
      windowMode: 'compact',
      microphone: 'not-asked',
      onWindowMode,
    });
    run.next();
    expect(run.step).toBe('how-to-talk');
    expect(run.buttonLabel).toBe('Continue with Hands free');
    expect(run.stepCount).toBe(2);
    run.next();
    expect(run.step).toBe('window');
    expect(run.windowMode).toBe('compact');
    expect(run.buttonLabel).toBe('Done');
    run.chooseWindow('full');
    run.next();
    expect(run.isDone).toBe(true);
    expect(run.windowMode).toBe('full');
    expect(onDone).toHaveBeenCalledOnce();
    // The replay's Done acts on the choice itself; nothing is kept for a later run.
    expect(onWindowMode).not.toHaveBeenCalled();
  });
});
