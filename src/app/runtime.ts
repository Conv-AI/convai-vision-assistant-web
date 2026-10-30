import { CharacterList } from '../characters/list';
import { RecentCharacters } from '../characters/recent';
import { getCharacters } from '../credentials/characters';
import { createHttpTokenSource } from '../credentials/tokenSource';
import { Compact } from '../compact/compact';
import { browserPictureWindows } from '../compact/pip';
import { FirstRunStore } from '../firstrun/stored';
import type { Notification } from '../kit/island/notification';
import { NotificationQueue } from '../kit/island/queue';
import { browserNotify, ReplyNotices } from '../notify/replies';
import type { LevelSource } from '../kit/lens/voice';
import { LazyTransport } from '../session/lazyTransport';
import { Session } from '../session/session';
import { browserDevices, DeviceList } from '../settings/microphones';
import { browserRecorder, MicrophoneTest } from '../settings/microphoneTest';
import { ShortcutMap } from '../settings/shortcuts';
import { SettingsStore } from '../settings/stored';
import type { SessionTransport } from '../session/transport';
import { browserMedia } from '../vision/media';
import { pageStorage, ShareCard } from '../vision/shareCard';
import { Vision } from '../vision/vision';

export interface TestHooks {
  createTransport?: () => SessionTransport;
}

declare global {
  interface Window {
    convaiVisionTest?: TestHooks;
  }
}

/** The app's long-lived parts: the conversation, the Island's queue, and what carries the voice. */
export interface Runtime {
  session: Session;
  /** What the character sees: one source at a time. */
  vision: Vision;
  queue: NotificationQueue;

  shareCard: ShareCard;
  transport: SessionTransport;
  /** The voice the capsule's Lens follows: the character's while it speaks, else the user's. */
  level: LevelSource;

  characters: CharacterList;
  /** The characters talked to on this device, newest first. */
  recent: RecentCharacters;
  /** What the first run left: whether it is done, how the person talks, the talk key. */
  firstRun: FirstRunStore;
  /** What Settings changes: text size, contrast, motion, captions, volume, the microphone. */
  settings: SettingsStore;
  /** The window's keys as Settings › Shortcuts has them; the Talk key is the first run's. */
  shortcuts: ShortcutMap;
  /** The microphones the browser lists, for Settings › Audio. */
  devices: DeviceList;
  /** Settings › Audio › Test your microphone. */
  microphoneTest: MicrophoneTest;

  compact: Compact;

  replies: ReplyNotices;
}

export function createRuntime(): Runtime {
  const transport =
    (import.meta.env.MODE === 'e2e' ? window.convaiVisionTest?.createTransport?.() : undefined) ??
    new LazyTransport(
      async () => new (await import('../session/convaiTransport')).ConvaiTransport(),
    );
  const queue = new NotificationQueue(() => performance.now() / 1000);
  const notices = {
    post: (notification: Notification) => {
      queue.post(notification);
    },
    close: (key: string, now?: boolean) => {
      queue.close(key, now);
    },
  };
  // The session asks the sources what is seen for each question; they are made next.
  let vision: Vision | null = null;
  const characters = new CharacterList((signal) => getCharacters(undefined, signal));
  let initialCharacters = true;
  const recent = new RecentCharacters(pageStorage());
  const firstRun = new FirstRunStore(pageStorage());
  const settings = new SettingsStore(pageStorage());
  // The voice plays at the chosen volume from the first connect on, through the chosen microphone.
  transport.setVolume(settings.state.volume);
  if (settings.state.microphone !== null) {
    transport.setMicrophoneDevice(settings.state.microphone).catch(() => undefined);
  }
  let volume = settings.state.volume;
  settings.subscribe(() => {
    if (settings.state.volume === volume) return;
    volume = settings.state.volume;
    transport.setVolume(volume);
  });
  const session = new Session({
    transport,
    tokens: createHttpTokenSource(),
    characters: () => {
      const result = initialCharacters ? characters.loadInitial() : characters.load();
      initialCharacters = false;
      return result;
    },
    notices,
    seeing: () => vision?.seeing() ?? null,
    still: () => vision?.still() ?? Promise.resolve(null),
    preferred: () => recent.list[0] ?? null,

    talkMode: firstRun.talkMode ?? 'push-to-talk',
  });
  // The character talked to now is the newest recent one, whether chosen or started with.
  session.subscribe(() => {
    const id = session.state.character?.id;
    if (id !== undefined) recent.remember(id);
  });
  vision = new Vision({
    transport,
    media: browserMedia,
    notices,
    conversation: session,
    name: () => session.state.name,
    preferredCamera: () => settings.state.camera,
  });
  // The camera shared last is the one Settings › Vision shows, and the next share opens.
  const sources = vision;
  sources.subscribe(() => {
    const { share, source } = sources.state;
    if (share === 'live' && source?.kind === 'camera' && source.deviceId)
      settings.set({ camera: source.deviceId });
  });
  const level: LevelSource = {
    sample: (now) =>
      (session.state.talk === 'speaking' ? transport.characterLevel : transport.userLevel).sample(
        now,
      ),
  };
  const compact = new Compact(browserPictureWindows(), { page: document });
  return {
    session,
    vision,
    queue,
    shareCard: new ShareCard(pageStorage()),
    transport,
    level,
    characters,
    recent,
    firstRun,
    settings,
    shortcuts: new ShortcutMap(pageStorage(), firstRun),
    devices: new DeviceList(browserDevices),
    microphoneTest: new MicrophoneTest(browserRecorder),
    compact,
    replies: new ReplyNotices({
      browser: browserNotify,
      conversation: session,
      floating: () => compact.state.mode === 'compact',
      storage: pageStorage(),
    }),
  };
}
