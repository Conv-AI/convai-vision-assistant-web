import { describe, expect, it } from 'vitest';
import type { SessionState } from '../session/session';
import type { Turn } from '../session/turns';
import { earlierAnswers, tipSignals } from './signals';

function state(change: Partial<SessionState> = {}): SessionState {
  return {
    phase: 'live',
    everConnected: true,
    failure: null,
    slow: false,
    talk: 'ready',
    talkSince: 0,
    spokeUntil: 0,
    talkMode: 'push-to-talk',
    muted: false,
    microphone: 'ready',
    character: null,
    name: 'Kira',
    items: [],
    talks: 0,
    stops: 0,
    weak: false,
    switching: false,
    stranded: false,
    retrying: false,
    send: 'idle',
    ...change,
  };
}

function turn(id: number, change: Partial<Turn> = {}): Turn {
  return {
    kind: 'turn',
    id,
    question: 'What is this?',
    input: 'voice',
    at: 0,
    reply: '',
    replyId: null,
    status: 'waiting',
    ...change,
  };
}

describe('tipSignals', () => {
  it('reads talking from a push-to-talk hold let go, once with its turn', () => {
    const held = state({ talk: 'held' });
    const let_go = state({ talks: 1 });
    expect(tipSignals(held, let_go)).toEqual(['talked']);
    // Its spoken turn arrives after: talking was counted already.
    expect(tipSignals(let_go, state({ talks: 1, items: [turn(1)] }))).toEqual([]);
  });

  it('reads talking from a spoken question in hands free', () => {
    expect(tipSignals(state(), state({ talkMode: 'hands-free', items: [turn(1)] }))).toEqual([
      'talked',
    ]);
  });

  it('reads a typed question that was taken, and never a listening blip as talking', () => {
    const typed = state({ items: [turn(1, { input: 'typed' })] });
    expect(tipSignals(state(), typed)).toEqual(['typed']);
    expect(tipSignals(state(), state({ talk: 'listening' }))).toEqual([]);
  });

  it('reads an answer from its speech start to its end', () => {
    const asked = state({ items: [turn(1, { status: 'streaming' })] });
    const speaking = state({ talk: 'speaking', items: [turn(1, { status: 'streaming' })] });
    expect(tipSignals(asked, speaking)).toEqual(['speech-started']);
    const done = state({ items: [turn(1, { status: 'done' })] });
    expect(tipSignals(speaking, done)).toEqual(['answer-ended']);
  });

  it('never counts a greeting (a reply nobody asked for) as an answer', () => {
    const greeting = turn(1, { question: '', status: 'streaming' });
    const before = state({ items: [greeting] });
    const speaking = state({ talk: 'speaking', items: [greeting] });
    expect(tipSignals(state(), before)).toEqual([]);
    expect(tipSignals(before, speaking)).toEqual([]);
    expect(tipSignals(speaking, before)).toEqual([]);
  });

  it('reads a stopped answer once, its words all come or not', () => {
    const speaking = state({ talk: 'speaking', items: [turn(1, { status: 'done' })] });
    const stopped = state({ stops: 1, items: [turn(1, { status: 'done' })] });
    expect(tipSignals(speaking, stopped)).toEqual(['stopped', 'answer-ended']);
    expect(tipSignals(stopped, state({ stops: 1, items: [turn(1, { status: 'done' })] }))).toEqual(
      [],
    );
  });

  it('says nothing when the conversation is cleared by a switch', () => {
    const speaking = state({ talk: 'speaking', items: [turn(1, { status: 'streaming' })] });
    expect(tipSignals(speaking, state())).toEqual([]);
  });
});

describe('earlierAnswers', () => {
  it('counts the asked turns that ended before the tips loaded, never one still spoken', () => {
    const items = [
      turn(1, { status: 'done' }),
      turn(2, { question: '', status: 'done' }),
      turn(3, { status: 'stopped' }),
      turn(4, { status: 'failed' }),
      turn(5, { status: 'done' }),
    ];
    expect(earlierAnswers(state({ items })).map((one) => one.id)).toEqual([1, 3, 5]);
    expect(earlierAnswers(state({ items, talk: 'speaking' })).map((one) => one.id)).toEqual([1, 3]);
  });
});
