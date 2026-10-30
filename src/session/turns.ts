export type ReplyStatus =
  /** Asked; nothing back yet. */
  | 'waiting'
  | 'streaming'
  | 'done'
  /** Cut by the user; the text freezes where it was. */
  | 'stopped'
  /** The service could not take the question; Try again resends it. */
  | 'failed';

export interface Turn {
  kind: 'turn';
  id: number;
  /** Empty for a reply nobody asked for, such as a greeting. */
  question: string;
  /** How the question came: typed, or spoken. */
  input: 'typed' | 'voice';
  /** When the question was asked, in milliseconds since the epoch. */
  at: number;
  /** What the character saw as it was asked ("Camera"); absent with nothing shared. */
  seen?: string;
  /**
   * A still of what the character saw as it was asked (an image URL), kept for this session only
   * The thumbnail is a local still taken when the question ends.
   */
  picture?: string;
  reply: string;
  /** The transport's id for the reply, once one arrived. */
  replyId: string | null;
  status: ReplyStatus;
}

export interface Divider {
  kind: 'divider';
  id: number;
  label: 'Restarted';
}

export type TranscriptItem = Turn | Divider;

export function lastTurn(items: readonly TranscriptItem[]): Turn | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.kind === 'turn') return item;
  }
  return undefined;
}

function replaceTurn(items: readonly TranscriptItem[], turn: Turn): TranscriptItem[] {
  return items.map((item) => (item.id === turn.id ? turn : item));
}

/**
 * A question asked now; it waits for its reply. Speech the service heard in parts (a pause in hands
 * free) is one question: a spoken part that comes while the spoken turn before it still waits with
 * no words joins it, as the service answers them once.
 */
export function ask(
  items: readonly TranscriptItem[],
  id: number,
  question: string,
  input: Turn['input'],
  at: number,
  seen: string | null = null,
): TranscriptItem[] {
  const last = items.at(-1);
  if (
    input === 'voice' &&
    last?.kind === 'turn' &&
    last.input === 'voice' &&
    last.status === 'waiting' &&
    last.reply === ''
  )
    return replaceTurn(items, { ...last, question: `${last.question} ${question}`.trim() });
  return [
    ...items,
    {
      kind: 'turn',
      id,
      question,
      input,
      at,
      ...(seen === null ? {} : { seen }),
      reply: '',
      replyId: null,
      status: 'waiting',
    },
  ];
}

/** The still of what the character saw, on the turn that holds `id`; a turn keeps its first one. */
export function withPicture(
  items: readonly TranscriptItem[],
  id: number,
  picture: string,
): TranscriptItem[] {
  const turn = items.find((item) => item.kind === 'turn' && item.id === id);
  if (turn?.kind !== 'turn' || turn.picture !== undefined) return [...items];
  return replaceTurn(items, { ...turn, picture });
}

/**
 * The reply so far. It goes to the turn that already holds its id, or else to the newest turn still
 * waiting; a reply with neither starts a turn of its own. A stopped turn keeps its frozen text.
 */
export function reply(
  items: readonly TranscriptItem[],
  newId: number,
  replyId: string,
  text: string,
  streaming: boolean,
  at: number,
): TranscriptItem[] {
  const turns = items.filter((item): item is Turn => item.kind === 'turn');
  const held = turns.find((turn) => turn.replyId === replyId);
  // A reply with no words yet neither claims a question nor ends one: with video on, 2.0.1 runs an
  // empty reply, start to end, before the answer comes under a new id.
  if (text.trim() === '' && (!held || held.reply === '')) return [...items];
  const owner = held ?? turns.findLast((turn) => turn.status === 'waiting');
  if (!owner) {
    return [
      ...items,
      {
        kind: 'turn',
        id: newId,
        question: '',
        input: 'voice',
        at,
        reply: text,
        replyId,
        status: streaming ? 'streaming' : 'done',
      },
    ];
  }
  if (owner.status === 'stopped' || owner.status === 'failed') return [...items];
  return replaceTurn(items, {
    ...owner,
    replyId,
    reply: text,
    status: streaming ? 'streaming' : 'done',
  });
}

/** The newest turn that is still being answered stops where it is. */
export function stop(items: readonly TranscriptItem[]): TranscriptItem[] {
  const turn = lastTurn(items);
  if (!turn || (turn.status !== 'waiting' && turn.status !== 'streaming')) return [...items];
  return replaceTurn(items, { ...turn, status: 'stopped' });
}

/** The newest typed question that is still waiting could not be sent. */
export function fail(items: readonly TranscriptItem[]): TranscriptItem[] {
  const turn = lastTurn(items);
  if (turn?.status !== 'waiting') return [...items];
  return replaceTurn(items, { ...turn, status: 'failed' });
}

/** The newest turn still waiting ends without a reply: the service chose not to answer. */
export function settle(items: readonly TranscriptItem[]): TranscriptItem[] {
  const turn = lastTurn(items);
  if (turn?.status !== 'waiting') return [...items];
  return replaceTurn(items, { ...turn, status: 'done' });
}

/** A failed turn asked again: it waits once more, in its place. */
export function retry(items: readonly TranscriptItem[], id: number): TranscriptItem[] {
  const turn = items.find((item): item is Turn => item.kind === 'turn' && item.id === id);
  if (turn?.status !== 'failed') return [...items];
  return replaceTurn(items, { ...turn, status: 'waiting', reply: '', replyId: null });
}

/** Where the session restarted after a break; never two in a row, never before the first turn. */
export function restarted(items: readonly TranscriptItem[], id: number): TranscriptItem[] {
  if (items.at(-1)?.kind !== 'turn') return [...items];
  return [...items, { kind: 'divider', id, label: 'Restarted' }];
}

/** True when the question just echoed back by the service is the typed one already shown. */
export function isEcho(items: readonly TranscriptItem[], question: string): boolean {
  const turn = lastTurn(items);
  return (
    turn?.input === 'typed' && turn.status === 'waiting' && turn.question.trim() === question.trim()
  );
}
