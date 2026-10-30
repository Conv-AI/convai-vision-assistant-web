import { describe, expect, it } from 'vitest';
import { noticeKeys } from '../session/notices';
import { capsuleSpeech, islandTellsKeys, type CapsuleSpeech } from './speech';

const ready = 'Kira, ready. Hold T to talk.';
const offline = 'Kira, offline. Reconnect, button.';

/** Runs a sequence of (words, island tells) through the rule; returns what the region held each time. */
function run(steps: [string | null, boolean][]): string[] {
  let now: CapsuleSpeech = { held: '', told: null };
  return steps.map(([words, tells]) => (now = capsuleSpeech(now, words, tells)).held);
}

describe('capsuleSpeech', () => {
  it('says the capsule’s first state once it appears, and each change after', () => {
    expect(
      run([
        [null, false],
        [ready, false],
        ['Kira, speaking', false],
        [ready, false],
      ]),
    ).toEqual(['', ready, 'Kira, speaking', ready]);
  });

  it('says nothing while the Island tells the change, nor when the state comes back to it', () => {
    // Offline, then back online: the Island says both; the capsule's ready is what it held.
    expect(
      run([
        [ready, false],
        [offline, true],
        [ready, true],
        [ready, false],
      ]),
    ).toEqual([ready, ready, ready, ready]);
  });

  it('does not say the state the Island told once its notice has gone (Offline’s 4 s toast)', () => {
    expect(
      run([
        [ready, false],
        [offline, true],
        [offline, false],
        [offline, false],
      ]),
    ).toEqual([ready, ready, ready, ready]);
  });

  it('says the next change after a told state, and a state that comes back after that', () => {
    expect(
      run([
        [ready, false],
        [offline, true],
        [ready, true],
        [ready, false],
        ['Kira, speaking', false],
        [ready, false],
      ]),
    ).toEqual([ready, ready, ready, ready, 'Kira, speaking', ready]);
  });

  it('keeps what it held with no capsule in the tab (launching, Compact)', () => {
    expect(
      run([
        [ready, false],
        [null, false],
        ['Kira, speaking', false],
      ]),
    ).toEqual([ready, ready, 'Kira, speaking']);
  });

  it('lets the Island speak for Offline, Back online and the microphone’s problems', () => {
    expect([...islandTellsKeys].sort()).toEqual(
      [
        noticeKeys.offline,
        noticeKeys.backOnline,
        noticeKeys.micBlocked,
        noticeKeys.micBusy,
        noticeKeys.micNone,
      ].sort(),
    );
  });
});
