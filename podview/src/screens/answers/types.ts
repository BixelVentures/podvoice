// Svar: the shapes the answer screens read. Answers come from the owner model (owner-answers.js, plain JS) or, in
// the preview, from the scene model; every field is optional because the two sources fill different ones.

export interface AnswerRow {
  id?: string;
  label?: string;
  value?: unknown;
  detail?: string;
  text?: string;
  time?: string;
  values?: unknown[];
  checked?: boolean;
  sourceId?: string;
}

export interface AnswerContent {
  summary?: string;
  facts?: AnswerRow[];
  events?: AnswerRow[];
  nodes?: AnswerRow[];
  items?: AnswerRow[];
  steps?: AnswerRow[];
  columns?: {id?: string; label?: string}[];
  unit?: string;
  unitSingular?: string;
  sources?: {id?: string; kind?: string; receiptId?: string; label?: string; scope?: string; url?: string}[];
  image?: {caption?: string; kind?: string};
  illustration?: {caption?: string};
}

export interface TranscriptSegment {
  segmentId?: string;
  sessionId?: string;
  role?: string;
  ts: number;
  text: string;
}

export interface Answer {
  id: string;
  kind: string;
  title?: string;
  status?: string;
  readStatus?: string;
  live?: boolean;
  historical?: boolean;
  presentation?: boolean;
  hidden?: boolean;
  exampleOnly?: boolean;
  observedAt?: number;
  validUntil?: number;
  receiptId?: string;
  revision?: number;
  sessionId?: string;
  turnId?: string;
  taskId?: string;
  inputRevision?: number;
  readConnected?: boolean;
  readContext?: string | null;
  displaySuggested?: boolean;
  ownerReceiptIds?: string[];
  allowedActions?: unknown[];
  provenance?: {kind?: string; validUntil?: number};
  weatherPresentation?: {kind?: string};
  reviewPresentation?: {returnLabel?: string; previousAnswer?: boolean};
  transcriptSegment?: TranscriptSegment;
  content?: AnswerContent;
  selected?: string;
  filter?: string;
  checked?: string[];
  step?: number;
}

// What a card is shown in: the shell's scene plus the connection the card reads.
export interface AnswerScene {
  connected?: boolean;
  connectionNoticeVisible?: boolean;
  focus?: string;
  sessionId?: string;
  voicePreviewPhase?: string;
}

export interface AnswerGroup {
  items: Answer[];
}

export interface AnswerSnapshot {
  bootId?: string;
  roomId?: string;
  voice?: {sessionId?: string | null; active?: boolean};
  capabilities?: {answerRead?: boolean; researchVisual?: boolean};
  answers?: {
    sessionId?: string;
    turnId?: string;
    taskId?: string;
    inputRevision?: number;
    revision?: number;
    sessionEpoch?: number;
    providerGeneration?: number;
    answerRevision?: number;
    readOnlyCompleted?: boolean;
  };
  answerHistoryRevision?: number;
  answerHistoryRemovalRevision?: number;
  answerHistoryReceiptIds?: string[];
}

export interface OwnedSource {
  summary: string;
  sourceText?: string;
  observedAt: number;
  facts: {label: string; value: string; detail: string}[];
  events?: {time: string; label: string; detail: string}[];
  provenance: {kind: string; retrievedAt?: string};
}
