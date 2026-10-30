import { describe, expect, it, vi } from 'vitest';
import { defaultSettings, SettingsStore, settingsKeys } from './stored';

function memory(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  return {
    values,
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => {
      values.set(name, value);
    },
  };
}

describe('the settings store', () => {
  it('starts from the defaults on a new device', () => {
    expect(new SettingsStore(memory()).state).toEqual(defaultSettings);
    expect(new SettingsStore(null).state).toEqual(defaultSettings);
  });

  it('keeps a change on the device and reads it back', () => {
    const storage = memory();
    const store = new SettingsStore(storage);
    store.set({ textScale: 1.15, aiColor: 'cyan', captions: false, volume: 0.4 });
    store.set({ transcriptStyle: 'conversation', microphone: 'usb-1' });
    const again = new SettingsStore(storage).state;
    expect(again).toMatchObject({
      textScale: 1.15,
      aiColor: 'cyan',
      captions: false,
      volume: 0.4,
      transcriptStyle: 'conversation',
      microphone: 'usb-1',
    });
    expect(storage.values.get(settingsKeys.transcriptStyle)).toBe('conversation');
  });

  it('reads the transcript style the panel stored before Settings', () => {
    const store = new SettingsStore(memory({ [settingsKeys.transcriptStyle]: 'continuum' }));
    expect(store.state.transcriptStyle).toBe('continuum');
  });

  it('brings values into range and drops ones it cannot read', () => {
    const store = new SettingsStore(
      memory({
        [settingsKeys.preferences]: JSON.stringify({
          textScale: 2,
          aiColor: 'purple',
          highContrast: 'maybe',
          volume: -1,
          captions: 'yes',
        }),
      }),
    );
    expect(store.state).toMatchObject({
      textScale: 1.3,
      aiColor: 'mint',
      highContrast: 'system',
      volume: 0,
      captions: true,
    });
    expect(new SettingsStore(memory({ [settingsKeys.preferences]: '{' })).state).toEqual(
      defaultSettings,
    );
    store.set({ textScale: 1.03, volume: 0.42 });
    expect(store.state.textScale).toBe(1.05);
    expect(store.state.volume).toBe(0.4);
  });

  it('tells its listeners of a change, and only of a change', () => {
    const store = new SettingsStore(memory());
    const heard = vi.fn();
    const stop = store.subscribe(heard);
    const before = store.state;
    store.set({ captions: true });
    expect(heard).not.toHaveBeenCalled();
    expect(store.state).toBe(before);
    store.set({ captions: false });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(store.state).not.toBe(before);
    stop();
    store.set({ captions: true });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('keeps a value for the page when storage refuses it', () => {
    const store = new SettingsStore({
      getItem: () => {
        throw new Error('off');
      },
      setItem: () => {
        throw new Error('off');
      },
    });
    store.set({ readAnswers: true });
    expect(store.state.readAnswers).toBe(true);
  });
});
