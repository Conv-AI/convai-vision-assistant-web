import type { ChatMessage, ConvaiClientState, ServerResponse } from '@convai/web-sdk/core';
import { describe, expect, it, vi } from 'vitest';
import {
  clientConfig,
  connectFailure,
  ConvaiTransport,
  isQuestionFailure,
  isQuestionTaken,
  messageEvents,
  microphoneFailure,
  type ConvaiClientLike,
} from './convaiTransport';
import { LevelMeter } from './levels';
import type { TransportEvent } from './transport';

/** Where the last AudioRenderer was told to put the character's voice elements. */
const speakers = vi.hoisted(() => ({ container: null as HTMLElement | null }));

vi.mock('@convai/web-sdk/vanilla', () => ({
  AudioRenderer: class {
    destroy = vi.fn();
    constructor(_room: unknown, options?: { container?: HTMLElement }) {
      speakers.container = options?.container ?? null;
    }
  },
}));

function message(type: ChatMessage['type'], content: string, isStreaming?: boolean): ChatMessage {
  return {
    id: `${type}-1`,
    type,
    content,
    timestamp: '2026-10-23T09:00:00Z',
    ...(isStreaming === undefined ? {} : { isStreaming }),
  };
}

describe('clientConfig', () => {
  it('leaves `url` out entirely, so the SDK dials its own default', () => {
    const config = clientConfig({ token: 't', characterId: 'c', endUserId: 'u' });

    expect('url' in config).toBe(false);
    expect(config).toEqual({
      authToken: 't',
      characterId: 'c',
      endUserId: 'u',
      startWithAudioOn: false,
      enableVideo: true,
      startWithVideoOn: false,
    });
  });

  it('leaves `endUserId` out when the server sent none', () => {
    expect('endUserId' in clientConfig({ token: 't', characterId: 'c' })).toBe(false);
  });
});

describe('messageEvents', () => {
  it('reads the typed question 2.0.1 sends back as user-llm-text', () => {
    expect(messageEvents(message('user-llm-text', 'What is this?'))).toEqual([
      { type: 'question', text: 'What is this?' },
    ]);
  });

  it('reads speech only once its words are final', () => {
    expect(messageEvents(message('user-transcription', 'What is', true))).toEqual([]);
    expect(messageEvents(message('user-transcription', 'What is this?', false))).toEqual([
      { type: 'question', text: 'What is this?' },
    ]);
  });

  it('reads the reply as it streams and when it ends', () => {
    expect(messageEvents(message('bot-llm-text', '', true))).toEqual([
      { type: 'reply', id: 'bot-llm-text-1', text: '', streaming: true },
    ]);
    expect(messageEvents(message('bot-llm-text', 'Paris.', false))).toEqual([
      { type: 'reply', id: 'bot-llm-text-1', text: 'Paris.', streaming: false },
    ]);
  });

  it('reads an abstention as no reply', () => {
    expect(messageEvents(message('llm-no-response', ''))).toEqual([{ type: 'no-reply' }]);
  });

  it.each(['emotion', 'action', 'bot-emotion', 'idle-warning', 'bot-output'] as const)(
    'ignores %s',
    (type) => {
      expect(messageEvents(message(type, 'x'))).toEqual([]);
    },
  );

  it('ignores the empty message 2.0.1 once emitted, and empty questions', () => {
    expect(messageEvents(undefined)).toEqual([]);
    expect(messageEvents(message('user-llm-text', '  '))).toEqual([]);
  });
});

describe('failures', () => {
  it('reads a refused typed question, and nothing else, as a failed question', () => {
    expect(
      isQuestionFailure({
        event_type: 'user_text_message',
        status: 'error',
        message: 'x',
        extras: {},
      }),
    ).toBe(true);
    expect(
      isQuestionFailure({
        event_type: 'user_text_message',
        status: 'success',
        message: 'x',
        extras: {},
      }),
    ).toBe(false);
    expect(
      isQuestionFailure({ event_type: 'interrupt-bot', status: 'error', message: 'x', extras: {} }),
    ).toBe(false);
    // Still on its way is not refused.
    expect(
      isQuestionFailure({
        event_type: 'user_text_message',
        status: 'processing',
        message: 'x',
        extras: {},
      }),
    ).toBe(false);
  });

  it('reads the service’s success for a typed question, and nothing else, as taken', () => {
    const response = (event_type: string, status: ServerResponse['status']) => ({
      event_type,
      status,
      message: 'x',
      extras: {},
    });
    expect(isQuestionTaken(response('user_text_message', 'success'))).toBe(true);
    expect(isQuestionTaken(response('user_text_message', 'error'))).toBe(false);
    expect(isQuestionTaken(response('update-emotion', 'success'))).toBe(false);
  });

  it('blames the network when offline or when fetch failed, and the service otherwise', () => {
    expect(connectFailure(new Error('x'), false).failure).toBe('network');
    expect(connectFailure(new TypeError('Failed to fetch'), true).failure).toBe('network');
    expect(connectFailure(new Error('401'), true).failure).toBe('service');
  });

  it.each([
    ['NotAllowedError', 'blocked'],
    ['SecurityError', 'blocked'],
    ['NotFoundError', 'none'],
    ['OverconstrainedError', 'none'],
    ['NotReadableError', 'busy'],
    ['AbortError', 'busy'],
  ] as const)('reads a microphone %s as %s', (name, outcome) => {
    expect(microphoneFailure(new DOMException('x', name))).toBe(outcome);
  });
});

/** Just enough of `ConvaiClient` for the transport. */
class FakeClient {
  private readonly handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  readonly room = {
    state: 'connected',
    on: vi.fn(),
    off: vi.fn(),
    switchActiveDevice: vi.fn<(kind: string, id: string, exact?: boolean) => Promise<boolean>>(() =>
      Promise.resolve(true),
    ),
  };
  readonly audioControls = {
    isAudioEnabled: false,
    isAudioMuted: true,
    audioLevel: 0,
    enableAudio: vi.fn(() => {
      this.audioControls.isAudioEnabled = true;
      return Promise.resolve();
    }),
    unmuteAudio: vi.fn(() => {
      this.audioControls.isAudioMuted = false;
      return Promise.resolve();
    }),
    muteAudio: vi.fn(() => {
      this.audioControls.isAudioMuted = true;
      return Promise.resolve();
    }),
    startAudioLevelMonitoring: vi.fn(),
  };
  readonly videoControls = {
    publishVideoTrack: vi.fn<(track: MediaStreamTrack, options?: unknown) => Promise<object>>(() =>
      Promise.resolve({}),
    ),
    unpublishVisionSource: vi.fn(() => Promise.resolve()),
  };
  connect = vi.fn(() => Promise.resolve());
  disconnect = vi.fn(() => Promise.resolve());
  sendUserTextMessage = vi.fn();
  sendInterruptMessage = vi.fn();
  on(event: string, handler: (...args: unknown[]) => void): () => void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return () => {
      this.handlers.set(
        event,
        (this.handlers.get(event) ?? []).filter((h) => h !== handler),
      );
    };
  }
  fire(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }
}

function transportWith(client: FakeClient) {
  const transport = new ConvaiTransport(() => client as unknown as ConvaiClientLike);
  const events: TransportEvent[] = [];
  transport.subscribe((event) => events.push(event));
  return { transport, events };
}

const state = (agentState: ConvaiClientState['agentState']) => ({ agentState });

describe('ConvaiTransport', () => {
  it('maps the client’s states to activities', async () => {
    const client = new FakeClient();
    const { transport, events } = transportWith(client);
    await transport.connect({ token: 't', characterId: 'c' });

    for (const s of ['connected', 'listening', 'thinking', 'speaking', 'disconnected'] as const)
      client.fire('stateChange', state(s));

    expect(events).toEqual([
      { type: 'activity', activity: 'idle' },
      { type: 'activity', activity: 'listening' },
      { type: 'activity', activity: 'thinking' },
      { type: 'activity', activity: 'speaking' },
    ]);
  });

  it('reports a session the service ended, but not one it was asked to end', async () => {
    const client = new FakeClient();
    const { transport, events } = transportWith(client);
    await transport.connect({ token: 't', characterId: 'c' });

    client.fire('disconnect', 1);
    expect(events).toEqual([]);
    client.fire('disconnect', 3);
    expect(events).toEqual([{ type: 'ended' }]);

    await transport.disconnect();
    client.fire('disconnect', 3);
    expect(events).toEqual([{ type: 'ended' }]);
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('hears nothing from a client after disconnecting it', async () => {
    const client = new FakeClient();
    const { transport, events } = transportWith(client);
    await transport.connect({ token: 't', characterId: 'c' });
    await transport.disconnect();

    client.fire('stateChange', state('speaking'));
    client.fire('message', message('bot-llm-text', 'late', false));
    expect(events).toEqual([]);
    // Nor does anything reach it.
    expect(transport.sendText('Hello?')).toBe(false);
    transport.interrupt();
    expect(client.sendUserTextMessage).not.toHaveBeenCalled();
    expect(client.sendInterruptMessage).not.toHaveBeenCalled();
  });

  it('turns a failed connect into a TransportError and cleans up', async () => {
    const client = new FakeClient();
    client.connect.mockRejectedValueOnce(new Error('HTTP 401'));
    const { transport } = transportWith(client);

    await expect(transport.connect({ token: 't', characterId: 'c' })).rejects.toMatchObject({
      name: 'TransportError',
      failure: 'service',
    });
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('opens the microphone by enabling and unmuting it, and closes it by muting', async () => {
    const client = new FakeClient();
    const { transport } = transportWith(client);
    await transport.connect({ token: 't', characterId: 'c' });

    await expect(transport.setMicrophone(true)).resolves.toBe('on');
    expect(client.audioControls.enableAudio).toHaveBeenCalledOnce();
    expect(client.audioControls.isAudioMuted).toBe(false);

    await transport.setMicrophone(false);
    expect(client.audioControls.isAudioMuted).toBe(true);
    await transport.setMicrophone(true);
    expect(client.audioControls.enableAudio).toHaveBeenCalledOnce();
  });

  it('reads a refused microphone as blocked', async () => {
    const client = new FakeClient();
    client.audioControls.enableAudio.mockRejectedValueOnce(
      new DOMException('no', 'NotAllowedError'),
    );
    const { transport } = transportWith(client);
    await transport.connect({ token: 't', characterId: 'c' });

    await expect(transport.setMicrophone(true)).resolves.toBe('blocked');
  });

  it('passes typed text and Stop on to the client', async () => {
    const client = new FakeClient();
    const { transport } = transportWith(client);
    await transport.connect({ token: 't', characterId: 'c' });

    expect(transport.sendText('Hello')).toBe(true);
    transport.interrupt();
    expect(client.sendUserTextMessage).toHaveBeenCalledWith('Hello');
    expect(client.sendInterruptMessage).toHaveBeenCalledOnce();
  });

  it('says a typed question cannot leave with no client or a room that is down', async () => {
    const client = new FakeClient();
    const { transport } = transportWith(client);
    expect(transport.sendText('Before the connect')).toBe(false);

    await transport.connect({ token: 't', characterId: 'c' });
    client.room.state = 'disconnected';
    expect(transport.sendText('While the room is down')).toBe(false);
    expect(client.sendUserTextMessage).not.toHaveBeenCalled();
    client.room.state = 'reconnecting';
    expect(transport.sendText('While it reconnects')).toBe(true);
  });

  it('tells the service’s answer to a typed question: taken or refused', async () => {
    const client = new FakeClient();
    const { transport, events } = transportWith(client);
    await transport.connect({ token: 't', characterId: 'c' });
    const response = (status: ServerResponse['status'], text?: string) => ({
      event_type: 'user_text_message',
      status,
      message: 'x',
      extras: text === undefined ? {} : { text },
    });

    // As 2.0.1 gives it: the acknowledgement names the question it is for.
    client.fire('serverResponse', response('success', 'Is it dishwasher safe?'));
    client.fire('serverResponse', response('processing', 'Is it dishwasher safe?'));
    client.fire('serverResponse', response('error', 'Is it dishwasher safe?'));
    client.fire('serverResponse', response('success'));
    expect(events).toEqual([
      { type: 'question-taken', text: 'Is it dishwasher safe?' },
      { type: 'question-failed', text: 'Is it dishwasher safe?' },
      { type: 'question-taken' },
    ]);
  });

  it('feeds the character’s voice track to the Lens level, on LiveKit and WebSocket', async () => {
    const client = new FakeClient();
    const { transport } = transportWith(client);
    const attach = vi.spyOn(transport.characterLevel, 'attach').mockImplementation(() => undefined);
    await transport.connect({ token: 't', characterId: 'c' });
    const livekit = { kind: 'audio' } as MediaStreamTrack;
    const websocket = { kind: 'audio' } as MediaStreamTrack;

    client.fire('characterAudioTrack', { membershipId: null, track: livekit });
    client.fire('botAudioTrack', websocket);
    expect(attach.mock.calls).toEqual([[livekit], [websocket]]);
  });
});

describe('ConvaiTransport vision', () => {
  const camera = { kind: 'video', label: 'Integrated Camera' } as MediaStreamTrack;
  const tab = { kind: 'video', label: 'web-contents-media-stream://1' } as MediaStreamTrack;

  it('publishes the picture as the kind it is, and never stops the track on unpublish', async () => {
    const client = new FakeClient();
    const { transport } = transportWith(client);
    await transport.connect({ token: 't', characterId: 'c' });

    await transport.setVision({ track: camera, kind: 'camera' });
    expect(client.videoControls.publishVideoTrack).toHaveBeenCalledWith(camera, {
      source: 'camera',
      stopTrackOnUnpublish: false,
    });

    await transport.setVision(null);
    expect(client.videoControls.unpublishVisionSource).toHaveBeenCalledOnce();
  });

  it('keeps a picture chosen before the connect and publishes it once connected', async () => {
    const client = new FakeClient();
    const { transport } = transportWith(client);

    await transport.setVision({ track: camera, kind: 'camera' });
    expect(client.videoControls.publishVideoTrack).not.toHaveBeenCalled();

    await transport.connect({ token: 't', characterId: 'c' });
    await vi.waitFor(() => {
      expect(client.videoControls.publishVideoTrack).toHaveBeenCalledWith(camera, {
        source: 'camera',
        stopTrackOnUnpublish: false,
      });
    });
  });

  it('publishes the picture again on the new client after the session was restarted', async () => {
    const first = new FakeClient();
    const second = new FakeClient();
    const clients = [first, second];
    const transport = new ConvaiTransport(() => clients.shift() as unknown as ConvaiClientLike);
    await transport.connect({ token: 't', characterId: 'c' });
    await transport.setVision({ track: tab, kind: 'screen_share' });
    first.fire('disconnect', 3);

    await transport.connect({ token: 't', characterId: 'c' });
    await vi.waitFor(() => {
      expect(second.videoControls.publishVideoTrack).toHaveBeenCalledWith(tab, {
        source: 'screen_share',
        stopTrackOnUnpublish: false,
      });
    });
  });

  it('publishes nothing after the picture was taken back before the connect', async () => {
    const client = new FakeClient();
    const { transport } = transportWith(client);
    await transport.setVision({ track: camera, kind: 'camera' });
    await transport.setVision(null);

    await transport.connect({ token: 't', characterId: 'c' });
    await Promise.resolve();
    expect(client.videoControls.publishVideoTrack).not.toHaveBeenCalled();
  });

  it('applies changes in order and skips a picture a newer change replaced', async () => {
    const client = new FakeClient();
    let release: () => void = () => undefined;
    client.videoControls.publishVideoTrack.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve({});
          };
        }),
    );
    const { transport } = transportWith(client);
    await transport.connect({ token: 't', characterId: 'c' });

    const firstDone = transport.setVision({ track: camera, kind: 'camera' });
    await vi.waitFor(() => {
      expect(client.videoControls.publishVideoTrack).toHaveBeenCalledOnce();
    });
    const tabDone = transport.setVision({ track: tab, kind: 'screen_share' });
    const noneDone = transport.setVision(null);
    release();
    await Promise.all([firstDone, tabDone, noneDone]);

    // The camera was on its way; the tab was replaced before its turn; nothing is what stands.
    expect(client.videoControls.publishVideoTrack.mock.calls.map(([track]) => track)).toEqual([
      camera,
    ]);
    expect(client.videoControls.unpublishVisionSource).toHaveBeenCalledOnce();
  });

  it('rejects a publish that failed, so the sources can say so', async () => {
    const client = new FakeClient();
    client.videoControls.publishVideoTrack.mockRejectedValueOnce(new Error('publish failed'));
    const { transport } = transportWith(client);
    await transport.connect({ token: 't', characterId: 'c' });

    await expect(transport.setVision({ track: camera, kind: 'camera' })).rejects.toThrow(
      'publish failed',
    );
  });

  it('reports a picture that could not go out again after a reconnect', async () => {
    const client = new FakeClient();
    client.videoControls.publishVideoTrack.mockRejectedValueOnce(new Error('publish failed'));
    const { transport, events } = transportWith(client);
    await transport.setVision({ track: camera, kind: 'camera' });

    await transport.connect({ token: 't', characterId: 'c' });
    await vi.waitFor(() => {
      expect(events).toContainEqual({ type: 'vision-failed' });
    });
  });
});

describe('ConvaiTransport microphone and volume (Settings › Audio)', () => {
  it('keeps a microphone chosen before the connect and moves to it once connected, opening nothing', async () => {
    const client = new FakeClient();
    const { transport } = transportWith(client);
    await transport.setMicrophoneDevice('usb-1');
    expect(client.room.switchActiveDevice).not.toHaveBeenCalled();
    await transport.connect({ token: 't', characterId: 'c' });
    await Promise.resolve();
    expect(client.room.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'usb-1', true);
    expect(client.audioControls.enableAudio).not.toHaveBeenCalled();
    expect(client.audioControls.unmuteAudio).not.toHaveBeenCalled();
  });

  it('moves at once while connected, asks loosely for the default, and says when it failed', async () => {
    const client = new FakeClient();
    const { transport } = transportWith(client);
    await transport.connect({ token: 't', characterId: 'c' });
    expect(client.room.switchActiveDevice).not.toHaveBeenCalled();
    await transport.setMicrophoneDevice('usb-1');
    await transport.setMicrophoneDevice(null);
    expect(client.room.switchActiveDevice.mock.calls).toEqual([
      ['audioinput', 'usb-1', true],
      ['audioinput', 'default', false],
    ]);
    client.room.switchActiveDevice.mockRejectedValueOnce(new Error('gone'));
    await expect(transport.setMicrophoneDevice('gone')).rejects.toThrow('gone');
  });

  it('plays every voice element at the chosen volume, ones added later too', async () => {
    const client = new FakeClient();
    const { transport } = transportWith(client);
    transport.setVolume(0.4);
    await transport.connect({ token: 't', characterId: 'c' });
    const container = speakers.container;
    expect(container?.isConnected).toBe(true);
    const voice = document.createElement('audio');
    container?.append(voice);
    await vi.waitFor(() => {
      expect(voice.volume).toBeCloseTo(0.4);
    });
    transport.setVolume(0.8);
    expect(voice.volume).toBeCloseTo(0.8);
    transport.setVolume(3);
    expect(voice.volume).toBe(1);
  });
});

describe('LevelMeter', () => {
  it('scales a reading onto 0 to 1 and marks the rise out of quiet as an onset', () => {
    const readings = [0, 0.1, 0.12, 0.01, 0.5];
    const meter = new LevelMeter(() => readings.shift() ?? 0);

    expect([1, 2, 3, 4, 5].map(() => meter.sample())).toEqual([
      { level: 0, onset: false },
      { level: 0.4, onset: true },
      { level: 0.48, onset: false },
      { level: 0.04, onset: false },
      { level: 1, onset: true },
    ]);
  });
});
