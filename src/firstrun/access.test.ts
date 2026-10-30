import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  askAccess,
  browserAccess,
  followRead,
  readAccess,
  unaskedRefusalMs,
  type AccessBrowser,
} from './access';

describe('browsers without device or permission APIs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('can read access and subscribe without crashing the welcome screen', async () => {
    vi.stubGlobal('navigator', {});
    expect(await browserAccess.permission('microphone')).toBeNull();
    expect(await browserAccess.hasDevice('camera')).toBeNull();
    const stopDevices = browserAccess.watchDevices(() => undefined);
    const stopPermission = browserAccess.watchPermission('camera', () => undefined);
    expect(() => {
      stopDevices();
      stopPermission();
    }).not.toThrow();
  });
});

function browser(options: {
  permission?: PermissionState | null;
  has?: boolean | null;
  /** The DOMException name open() rejects with, or nothing to succeed. */
  error?: string;
  /** How long the browser takes to answer, in ms. */
  takes?: number;
  /** The permission after the answer. */
  after?: PermissionState | null;
}): AccessBrowser {
  let clock = 0;
  let answered = false;
  return {
    permission: () =>
      Promise.resolve(
        answered && 'after' in options ? (options.after ?? null) : (options.permission ?? 'prompt'),
      ),
    watchPermission: () => () => undefined,
    hasDevice: () => Promise.resolve(options.has ?? true),
    watchDevices: () => () => undefined,
    open: () => {
      clock += options.takes ?? 1000;
      answered = true;
      return options.error === undefined
        ? Promise.resolve()
        : Promise.reject(new DOMException('no', options.error));
    },
    now: () => clock,
  };
}

describe('readAccess', () => {
  it('reads granted, denied and prompt', async () => {
    expect(await readAccess(browser({ permission: 'granted' }), 'microphone')).toBe('allowed');
    expect(await readAccess(browser({ permission: 'denied' }), 'microphone')).toBe('blocked');
    expect(await readAccess(browser({ permission: 'prompt' }), 'camera')).toBe('not-asked');
  });

  it('says missing when no such device is there', async () => {
    expect(await readAccess(browser({ has: false }), 'camera')).toBe('missing');
  });

  it('asks where the browser cannot say', async () => {
    expect(await readAccess(browser({ permission: null, has: null }), 'microphone')).toBe(
      'not-asked',
    );
  });
});

describe('followRead', () => {
  it('keeps a closed prompt and a busy device that a later look cannot see', () => {
    expect(followRead('refused', 'not-asked')).toBe('refused');
    expect(followRead('busy', 'allowed')).toBe('busy');
    expect(followRead('busy', 'not-asked')).toBe('busy');
  });

  it('takes what the browser says otherwise', () => {
    expect(followRead('refused', 'blocked')).toBe('blocked');
    expect(followRead('refused', 'allowed')).toBe('allowed');
    expect(followRead('blocked', 'allowed')).toBe('allowed');
    expect(followRead('busy', 'missing')).toBe('missing');
    expect(followRead('not-asked', 'missing')).toBe('missing');
  });
});

describe('askAccess', () => {
  it('is allowed when the device opens', async () => {
    expect(await askAccess(browser({}), 'microphone')).toBe('allowed');
  });

  it('is refused when the person closed the prompt and the browser can ask again', async () => {
    expect(
      await askAccess(browser({ error: 'NotAllowedError', after: 'prompt' }), 'microphone'),
    ).toBe('refused');
  });

  it('is blocked when the site settings deny it', async () => {
    expect(
      await askAccess(browser({ error: 'NotAllowedError', after: 'denied' }), 'microphone'),
    ).toBe('blocked');
  });

  it('is blocked when the browser refused at once, without asking', async () => {
    const fast = browser({ error: 'NotAllowedError', after: null, takes: unaskedRefusalMs - 1 });
    expect(await askAccess(fast, 'microphone')).toBe('blocked');
    const slow = browser({ error: 'NotAllowedError', after: null, takes: unaskedRefusalMs });
    expect(await askAccess(slow, 'microphone')).toBe('refused');
  });

  it('tells a device in use and a missing one apart', async () => {
    expect(await askAccess(browser({ error: 'NotReadableError' }), 'microphone')).toBe('busy');
    expect(await askAccess(browser({ error: 'NotFoundError' }), 'camera')).toBe('missing');
  });
});
