export const timing = {
  connectingWords: 1500,

  connectGiveUp: 10_000,

  sendGiveUp: 10_000,
  /**
   * The service's echo of a typed question it took comes within this long (0.05 s recorded 25 Oct):
   * the same words spoken later are a question of their own.
   */
  echoWithin: 10_000,

  silentReconnect: 2000,

  offlineAfter: 3000,

  strandedAfter: 30_000,

  retryFirst: 4000,
  retryMost: 30_000,
  /** A finished reply's voice may start this long after its text; until then it is still Thinking. */
  voiceGap: 1500,

  holdThreshold: 150,
  /** The microphone stays open this long after the talk key is let go, so the last word is kept. */
  releaseTail: 250,

  restartedSeconds: 3,
  backOnlineSeconds: 2,
} as const;

/** The wait before retry number `attempt` (0 for the first) after a lost session. */
export function retryDelay(attempt: number): number {
  return Math.min(timing.retryMost, timing.retryFirst * 2 ** Math.max(0, attempt));
}
