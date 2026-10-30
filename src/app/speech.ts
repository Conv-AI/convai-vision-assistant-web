import { noticeKeys } from '../session/notices';

/**
 * The Island's notices whose words already say what the capsule's state would: while one of them is
 * up, the Island speaks for the change and the capsule says nothing (Offline, Back online, a
 * microphone that cannot open). Unavailable has no notice: the capsule says it.
 */
export const islandTellsKeys: readonly string[] = [
  noticeKeys.offline,
  noticeKeys.backOnline,
  noticeKeys.micBlocked,
  noticeKeys.micBusy,
  noticeKeys.micNone,
];

/**
 * The window's capsule region: `held` is what it holds now, `told` the capsule words a notice of the
 * Island said in its place (null when none did).
 */
export interface CapsuleSpeech {
  held: string;
  told: string | null;
}

export function capsuleSpeech(
  now: CapsuleSpeech,
  words: string | null,
  islandTells: boolean,
): CapsuleSpeech {
  if (words === null) return now;
  if (islandTells) return now.told === words ? now : { held: now.held, told: words };
  if (words === now.told) return now;
  if (words === now.held) return now.told === null ? now : { held: now.held, told: null };
  return { held: words, told: null };
}
