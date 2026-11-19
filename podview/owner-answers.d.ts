// Types for the pre-React answer owner model (owner-answers.js), used by src/screens/answers. The model stays plain
// JS: the server tests run it directly in Node.
import type {Answer, AnswerGroup, AnswerSnapshot, OwnedSource, TranscriptSegment} from './src/screens/answers/types';

export function answerSession(snapshot: AnswerSnapshot | null | undefined): string | null;
export function ownedAnswers(value: unknown, snapshot: AnswerSnapshot, previousRevision?: number, now?: number):
  {revision: number; items: Answer[]};
export function ownedSource(value: unknown, id: string, now?: number, snapshot?: AnswerSnapshot | null): OwnedSource;
export function historicalAnswers(value: unknown, snapshot: AnswerSnapshot, now?: number):
  {revision: number; items: Answer[]};
export function transcriptHistory(value: unknown, snapshot: AnswerSnapshot): {items: TranscriptSegment[]};
export function answerThread(answers: readonly Answer[], focusId: string | undefined):
  {sessionId: string; items: Answer[]} | null;
export function groupAnswerHistory(items: readonly Answer[], view?: unknown): AnswerGroup[];
