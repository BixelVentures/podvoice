// Svar on HA: the PodVoice add-on's saved answers, read through our integration's podvoice.answers_snapshot
// (custom_components/podvoice/addon_bridge.py), never from the add-on directly. HA does not push them, so the page
// reads them: when Svar opens, every 30 s while it is open, and after a resync. Each saved answer is validated by
// the wall page's own owner model (owner-answers.js historicalAnswers) before it is drawn; an add-on that is
// stopped or busy is an honest state, and the answers already read stay on screen.
import {keepPreviousData, useQuery} from '@tanstack/react-query';
import {z} from 'zod';
import {historicalAnswers} from '../../../owner-answers.js';
import type {Answer, AnswerSnapshot} from '../../screens/answers/types';
import {haKeys, serviceResponse} from './transport';

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

// What the screen draws: the saved answers (newest first, as the add-on keeps them), or why there are none.
export type AnswersRead = {ok: true; answers: Answer[]} | {ok: false; error: string};

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
export const ANSWERS_REFRESH_MS = 30_000;

// `room` is the PodVoice endpoint of the page's room (the add-on's room id); null lets the add-on use its only room.
export function useAnswers(room: string | null, generation: number, enabled: boolean) {
  return useQuery({
    queryKey: answersKey(room ?? '', generation),
    enabled,
    staleTime: 10_000,
    gcTime: 5 * 60_000,
    retry: false,
    // A failed read keeps the answers already shown (»De kendte svar er bevaret«).
    placeholderData: keepPreviousData,
    refetchInterval: enabled ? ANSWERS_REFRESH_MS : false,
    queryFn: async (): Promise<AnswersRead> => {
      const result = await serviceResponse(
        {domain: 'podvoice', service: 'answers_snapshot', data: room ? {room} : {}, returnResponse: true},
        answersReplySchema,
      );
      if (!result.ok) throw Object.assign(new Error(result.reason || result.outcome), {outcome: result.outcome});
      return readAnswers(result.value);
    },
  });
}
