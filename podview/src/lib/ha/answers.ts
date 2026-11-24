// Svar on HA: the PodVoice add-on's answers through our integration, never from the add-on directly. HA pushes them
// over its websocket (podvoice/answers_subscribe, custom_components/podvoice/answers_live.py): the answer GPT-Live is
// giving right now, not yet saved (the add-on's live projection, podview.answers.v1, with the identity fields it is
// checked against), and the saved answers whenever their history moves. Nothing is polled and no service call is
// recorded. Each answer is validated by the wall page's own owner model (owner-answers.js: ownedAnswers for the live
// ones, historicalAnswers for the saved ones) before it is drawn; an add-on that is stopped or busy is an honest
// state, and the answers already read stay on screen. An integration without the subscription is read once through
// podvoice.answers_snapshot.
import {useQuery, useQueryClient} from '@tanstack/react-query';
import type {QueryClient} from '@tanstack/react-query';
import {useEffect} from 'react';
import {z} from 'zod';
import {historicalAnswers, ownedAnswers} from '../../../owner-answers.js';
import type {Answer, AnswerSnapshot} from '../../screens/answers/types';
import {haKeys, serviceResponse, subscribeHa, transport as appTransport} from './transport';
import type {HaTransport} from './transport';

const historySchema = z.looseObject({
  schema: z.literal('podview.answer-history.v1'),
  roomId: z.string().min(1).max(160),
  bootId: z.string().min(1).max(160),
  revision: z.number().int().min(0),
  removalRevision: z.number().int().min(0),
  receiptIds: z.array(z.string()).max(20),
  items: z.array(z.unknown()).max(20),
});

export const answersReplySchema = z.union([
  z.looseObject({ok: z.literal(true), history: historySchema}),
  z.looseObject({ok: z.literal(false), error: z.string().max(80)}),
]);
export type AnswersReply = z.infer<typeof answersReplySchema>;

// What the screen draws: the saved answers (newest first, as the add-on keeps them) and the live ones, or why there
// are none.
export type AnswersRead = {ok: true; answers: Answer[]; live?: Answer[]} | {ok: false; error: string};

// The history envelope is self-describing (boot, room, revisions, receipt order), so it is checked against itself
// exactly as the wall page checks it against its snapshot.
export function readAnswers(reply: AnswersReply): AnswersRead {
  if (!reply.ok) return {ok: false, error: reply.error};
  const history = reply.history;
  const snapshot: AnswerSnapshot = {
    bootId: history.bootId,
    roomId: history.roomId,
    capabilities: {answerRead: true},
    answerHistoryRevision: history.revision,
    answerHistoryRemovalRevision: history.removalRevision,
    answerHistoryReceiptIds: history.receiptIds,
  };
  try {
    return {ok: true, answers: historicalAnswers(history, snapshot).items};
  } catch {
    return {ok: false, error: 'unreadable'};
  }
}

export const answersKey = (room: string, generation: number) => [...haKeys.read, 'answers', room, generation] as const;

const pushSchema = z.union([
  z.looseObject({
    ok: z.literal(true),
    snapshot: z.looseObject({}),
    live: z.unknown().nullable(),
    history: historySchema.nullable(),
  }),
  z.looseObject({ok: z.literal(false), error: z.string().max(80)}),
]);
export type AnswersPush = z.infer<typeof pushSchema>;

// The live answers of one push, as the wall page admits them (owner-answers.js ownedAnswers); none when they do not
// belong to the voice session the push names.
export function liveAnswers(push: Extract<AnswersPush, {ok: true}>, now = Date.now()): Answer[] {
  if (!push.live) return [];
  try {
    const owned = ownedAnswers(push.live, push.snapshot, 0, now) as {items: Answer[]};
    return owned.items.filter(answer => !answer.hidden);
  } catch {
    return [];
  }
}

// The cache value after one push: a push without the history (it did not move, or it could not be read) keeps the
// saved answers already read.
export function applyPush(previous: AnswersRead | undefined, push: AnswersPush, now = Date.now()): AnswersRead {
  if (!push.ok) return previous?.ok ? previous : {ok: false, error: push.error};
  const saved = push.history ? readAnswers({ok: true, history: push.history}) : null;
  const answers = saved?.ok ? saved.answers : previous?.ok ? previous.answers : null;
  if (!answers) return {ok: false, error: saved && !saved.ok ? saved.error : 'unreadable'};
  return {ok: true, answers, live: liveAnswers(push, now)};
}

const live = new Map<string, {count: number; stop: () => void}>();

async function readOnce(client: QueryClient, key: readonly unknown[], room: string | null, source: HaTransport) {
  const result = await serviceResponse(
    {domain: 'podvoice', service: 'answers_snapshot', data: room ? {room} : {}, returnResponse: true},
    answersReplySchema,
    source,
  );
  // A service HA does not have (or refuses) means the history is not available here, not that the add-on is down.
  const error = result.ok ? null : result.outcome === 'rejected' ? 'service_unavailable' : 'addon_unavailable';
  client.setQueryData<AnswersRead>(key, result.ok ? readAnswers(result.value) : {ok: false, error: error ?? ''});
}

// One subscription per room and resync generation, however many components read it.
export function subscribeAnswers(
  client: QueryClient,
  room: string | null,
  generation: number,
  source: HaTransport = appTransport,
): () => void {
  const key = answersKey(room ?? '', generation);
  const id = `${room ?? ''}\u0000${String(generation)}`;
  const held = live.get(id);
  if (held) held.count += 1;
  else {
    const stop = subscribeHa(
      {type: 'podvoice/answers_subscribe', ...(room ? {room} : {})},
      message => {
        const parsed = pushSchema.safeParse(message);
        if (parsed.success)
          client.setQueryData<AnswersRead>(key, previous => applyPush(previous, parsed.data));
      },
      // An integration without the subscription (older than 0.1.28): the saved answers are read once.
      () => void readOnce(client, key, room, source).catch(() => undefined),
      source,
    );
    live.set(id, {count: 1, stop});
  }
  return () => {
    const entry = live.get(id);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    live.delete(id);
    entry.stop();
  };
}

// Svar's answers: pushed while the screen exists, the last value kept between pushes (and for a minute after).
export function useAnswers(room: string | null, generation: number, enabled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    return subscribeAnswers(client, room, generation);
  }, [client, room, generation, enabled]);
  return useQuery<AnswersRead>({
    queryKey: answersKey(room ?? '', generation),
    // Fed by the subscription only: nothing is fetched by the query itself.
    enabled: false,
    staleTime: Infinity,
    gcTime: 60_000,
    queryFn: () => Promise.reject(new Error('pushed')),
  });
}
