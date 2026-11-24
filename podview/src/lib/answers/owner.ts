// The add-on's answers as the Svar screen admits them: the current turn's owner answers (podview.answers.v1), the
// saved history (podview.answer-history.v1) and one answer's source (podview.*source.v1). A source receipt is an
// opaque read reference; it never authorizes an action. No runtime imports beyond relative .ts files: the server
// tests run these models in plain Node (type stripping).
import {
  BICYCLE_ILLUSTRATION,
  isTypedFamily,
  isVisualFamily,
  list,
  record,
  validateTypedAnswerContent,
  validateVisualContent,
} from './content.ts';
import type {Json, TypedContent, VisualContent} from './content.ts';
import {researchAnswer} from './research.ts';
import type {ResearchProvenance} from './research.ts';

const text = (v: unknown, n = 160): v is string => typeof v === 'string' && v.length > 0 && v.length <= n;
const receipt = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const date = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : NaN);
const clock = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit'});

export type Provenance =
  | {kind: 'tool_result'}
  | {kind: 'ha_weather'; source: string; retrievedAt: string; stateUpdatedAt: string; validUntil: number}
  | {kind: 'owner_sources'; receiptIds: string[]}
  | {kind: 'ai_explanation'}
  | ResearchProvenance;

export interface OwnedAnswer {
  id: string;
  kind: string;
  title?: string;
  meta?: string;
  status: 'ready';
  live: true;
  presentation?: true;
  historical?: true;
  hidden?: boolean;
  displaySuggested?: boolean;
  content: VisualContent | TypedContent;
  ownerReceiptIds: string[];
  allowedActions?: [];
  observedAt: number;
  validUntil?: number;
  provenance: Provenance;
  receiptId?: string;
  sessionId?: string;
  turnId?: string;
  taskId?: string;
  inputRevision?: number;
  revision?: number;
  readContext?: null;
  readConnected?: boolean;
  readStatus?: 'ready';
  weatherDisplayFactIds?: string[];
}

function sourceProvenance(raw: unknown, now: number): Provenance {
  const v = record(raw);
  if (v?.kind === 'tool_result') return {kind: 'tool_result'};
  if (v?.kind !== 'ha_weather' || !text(v.source, 120) || !Number.isFinite(date(v.retrievedAt)) ||
    !Number.isFinite(date(v.stateUpdatedAt)) || !finite(v.validUntil)) throw Error('invalid_source_provenance');
  const retrieved = date(v.retrievedAt);
  const updated = date(v.stateUpdatedAt);
  if (retrieved > now + 5000 || updated > now + 5000 || v.validUntil * 1000 <= now ||
    v.validUntil * 1000 > Math.min(retrieved + 900000, updated + 7200000)) throw Error('expired_weather_source');
  return {kind: 'ha_weather', source: v.source, retrievedAt: v.retrievedAt as string,
    stateUpdatedAt: v.stateUpdatedAt as string, validUntil: v.validUntil};
}

// The voice session the answers belong to, or null when the snapshot does not bind one.
export function answerSession(raw: unknown): string | null {
  const snapshot = record(raw);
  const answers = record(snapshot?.answers);
  const voice = record(snapshot?.voice);
  const id = answers?.sessionId;
  if (!text(id)) return null;
  if (answers?.readOnlyCompleted === true) return voice?.active === false && voice.sessionId === null ? id : null;
  return voice?.sessionId === id ? id : null;
}

const content = (family: string, raw: unknown, options: {ownerReceiptIds: string[]; allowConversation: boolean}) =>
  isTypedFamily(family) ? validateTypedAnswerContent(family, raw, options) : validateVisualContent(family, raw, options);

// An AI explanation never carries measured facts, a chart, an observed event or a ticked item, and only the app's own
// illustration.
function explanationAdmitted(family: unknown, raw: unknown, art: unknown): boolean {
  const body = record(raw);
  if (family === 'fact-card' || family === 'chart') return false;
  if (family === 'answer-timeline' && (list(body?.events) ?? []).some(e => record(e)?.status !== 'planned')) {
    return false;
  }
  if (family === 'checklist' && (list(body?.items) ?? []).some(i => record(i)?.checked !== false)) return false;
  const picture = record(art);
  return !picture || (picture.url === BICYCLE_ILLUSTRATION && picture.kind === 'illustration');
}

function presentationAnswer(raw: unknown, context: Json, now: number) {
  const row = record(raw);
  const fields = ['roomId', 'sessionId', 'turnId', 'taskId'];
  const revisions = ['inputRevision', 'answerRevision', 'providerGeneration'];
  if (row?.schema !== 'podview.presentation.v1' || !fields.every(key => text(row[key]) && row[key] === context[key]) ||
    !revisions.every(key => Number.isSafeInteger(row[key]) && (row[key] as number) >= 0 && row[key] === context[key]) ||
    !finite(row.sessionEpoch) || row.sessionEpoch !== context.sessionEpoch || !receipt(row.receiptId) ||
    !finite(row.observedAt) || row.observedAt * 1000 > now + 5000 || row.observedAt * 1000 < now - 120000 ||
    !finite(row.validUntil) || row.validUntil * 1000 <= now || row.validUntil > row.observedAt + 120 ||
    row.displaySuggested !== true || list(row.allowedActions)?.length !== 0 || !text(row.title, 160) ||
    !(isVisualFamily(row.family) || isTypedFamily(row.family))) throw Error('invalid_presentation_binding');
  const {receiptId, family, title, observedAt, validUntil} = row;
  const p = record(row.provenance);
  const ai = p?.kind === 'ai_explanation';
  const body = record(row.content);
  if (ai) {
    const art = family === 'sourced-image' ? body?.image : body?.illustration;
    if (Object.keys(p).length !== 1 || !explanationAdmitted(family, body, undefined)) {
      throw Error('invalid_explanation_provenance');
    }
    if (!explanationAdmitted('', undefined, art)) throw Error('unadmitted_explanation_image');
  } else {
    const ids = list(p?.receiptIds);
    if (p?.kind !== 'owner_sources' || Object.keys(p).some(key => !['kind', 'receiptIds'].includes(key)) || !ids?.length ||
      ids.length > 8 || ids.some(id => !receipt(id) || id === receiptId) || new Set(ids).size !== ids.length) {
      throw Error('invalid_presentation_sources');
    }
  }
  const sources = list(body?.sources);
  const scope = ai ? 'conversation_answer' : 'tool_result';
  if (sources?.length !== 1 || sources.some(s => {
    const source = record(s);
    return source?.kind !== 'owner_receipt' || source.receiptId !== receiptId || source.scope !== scope;
  })) throw Error('invalid_presentation_receipt');
  const receiptIds = (list(p.receiptIds) ?? []).filter(receipt);
  return {
    id: `receipt:${receiptId}`,
    kind: family,
    title,
    status: 'ready' as const,
    live: true as const,
    presentation: true as const,
    content: content(family, row.content, {ownerReceiptIds: [receiptId], allowConversation: ai}),
    ownerReceiptIds: [receiptId],
    allowedActions: [] as [],
    observedAt,
    validUntil,
    provenance: (ai ? {kind: 'ai_explanation'} : {kind: 'owner_sources', receiptIds}) as Provenance,
  };
}

const factsOf = (answer: OwnedAnswer) => ('facts' in answer.content ? (answer.content.facts ?? []) : []);

export function ownedAnswers(raw: unknown, snapshotRaw: unknown, previousRevision = 0, now = Date.now()) {
  const value = record(raw);
  const snapshot = record(snapshotRaw) ?? {};
  const answers = record(snapshot.answers) ?? {};
  const capabilities = record(snapshot.capabilities);
  const items = list(value?.items);
  if (value?.schema !== 'podview.answers.v1' || value.roomId !== snapshot.roomId || !Number.isInteger(value.revision) ||
    (value.revision as number) < previousRevision || value.revision !== answers.revision || !items ||
    items.length > 3) throw Error('invalid_owned_answers');
  const revision = value.revision as number;
  const seen = new Set<string>();
  const admitted: OwnedAnswer[] = items.map((entry): OwnedAnswer => {
    const row = record(entry) ?? {};
    if (!receipt(row.receiptId) || seen.has(row.receiptId) || !text(row.sessionId) ||
      row.sessionId !== answerSession(snapshot) || row.sessionId !== answers.sessionId || !text(row.turnId) ||
      row.turnId !== answers.turnId || !text(row.taskId) || row.taskId !== answers.taskId ||
      row.inputRevision !== answers.inputRevision || !Number.isInteger(row.inputRevision) ||
      (row.inputRevision as number) < 0 || !finite(row.observedAt) || row.observedAt * 1000 > now + 5000 ||
      row.observedAt * 1000 < now - 120000 ||
      (row.family !== 'fact-card' && row.schema !== 'podview.research.v1' &&
        row.schema !== 'podview.presentation.v1') ||
      typeof row.displaySuggested !== 'boolean') throw Error('invalid_owned_answer');
    const {receiptId, sessionId, turnId, taskId, observedAt} = row;
    const inputRevision = row.inputRevision as number;
    seen.add(receiptId);
    const binding = {receiptId, sessionId, turnId, taskId, inputRevision, revision};
    const context = {...answers, roomId: snapshot.roomId};
    if (row.schema === 'podview.presentation.v1') {
      if (capabilities?.answerRead !== true) throw Error('presentation_not_admitted');
      const parsed = presentationAnswer(row, context, now);
      const meta = parsed.provenance.kind === 'ai_explanation' ? 'AI-forklaring' : 'Svar fra PodVoice';
      return {...parsed, ...binding, meta, hidden: false, displaySuggested: true};
    }
    if (row.schema === 'podview.research.v1') {
      if (capabilities?.researchVisual !== true) throw Error('research_not_admitted');
      const parsed = researchAnswer(row, context, now);
      return {...parsed, ...binding, title: 'Svar fra PodVoice', meta: clock(observedAt), hidden: false,
        displaySuggested: true};
    }
    const sources = list(record(row.content)?.sources);
    if (!sources || sources.some(s => record(s)?.kind !== 'owner_receipt' || record(s)?.receiptId !== receiptId)) {
      throw Error('unbound_source_receipt');
    }
    const provenance = sourceProvenance(row.provenance, now);
    return {
      id: `receipt:${receiptId}`,
      ...binding,
      observedAt,
      kind: row.family as string,
      title: 'Svar fra PodVoice',
      meta: clock(observedAt),
      status: 'ready',
      live: true,
      hidden: false,
      displaySuggested: row.displaySuggested,
      content: validateVisualContent(row.family, row.content, {ownerReceiptIds: [receiptId]}),
      ownerReceiptIds: [receiptId],
      provenance,
    };
  });
  // UI-only display binding, derived from admitted rows in this exact owner envelope, never from model labels or a
  // wire-supplied display hint. Canonical content stays raw.
  for (const answer of admitted) {
    const p = answer.provenance;
    if (answer.presentation !== true || answer.kind !== 'fact-card' || p.kind !== 'owner_sources') continue;
    const weather = admitted.filter(source => source.receiptId !== undefined &&
      p.receiptIds.includes(source.receiptId) && source.kind === 'fact-card' && source.provenance.kind === 'ha_weather');
    answer.weatherDisplayFactIds = factsOf(answer)
      .filter(fact => fact.detail === 'Aktuel måling' && weather.some(source => factsOf(source).some(original =>
        original.detail === 'Aktuel måling' && original.label === fact.label && original.value === fact.value)))
      .map(fact => fact.id);
  }
  return {revision, items: admitted};
}

// One answer's source, opened from its card: the presentation's or research's own receipt, or a tool's facts.
export function ownedSource(raw: unknown, id: unknown, now = Date.now(), snapshotRaw: unknown = null) {
  const value = record(raw);
  const snapshot = record(snapshotRaw);
  const context = {...(record(snapshot?.answers) ?? {}), roomId: snapshot?.roomId};
  const capabilities = record(snapshot?.capabilities);
  const excerpt = () => {
    if (value?.sourceText !== undefined && !text(value.sourceText, 1200)) throw Error('invalid_source_excerpt');
    return value?.sourceText === undefined ? {} : {sourceText: value.sourceText};
  };
  if (value?.schema === 'podview.presentation.source.v1') {
    if (!receipt(id) || value.receiptId !== id || capabilities?.answerRead !== true ||
      value.sessionId !== answerSession(snapshot)) throw Error('invalid_presentation_source');
    const parsed = presentationAnswer({...value, schema: 'podview.presentation.v1'}, context, now);
    const body = parsed.content as VisualContent;
    return {receiptId: id, summary: body.summary, observedAt: parsed.observedAt, validUntil: parsed.validUntil,
      provenance: parsed.provenance, family: parsed.kind, facts: body.facts ?? [], events: body.events ?? [],
      ...excerpt()};
  }
  if (value?.schema === 'podview.research.source.v1') {
    if (!receipt(id) || value.receiptId !== id || value.kind !== 'owner_receipt' ||
      value.externalSourcesProvided !== false || !text(value.toolName) || capabilities?.researchVisual !== true ||
      value.sessionId !== answerSession(snapshot)) throw Error('invalid_research_source');
    const parsed = researchAnswer({...value, schema: 'podview.research.v1'}, context, now);
    return {receiptId: id, toolName: value.toolName, summary: parsed.content.summary, observedAt: parsed.observedAt,
      validUntil: parsed.validUntil, provenance: parsed.provenance, family: parsed.kind,
      facts: parsed.content.facts ?? [], events: parsed.content.events ?? [], ...excerpt()};
  }
  const facts = list(value?.facts);
  if (!receipt(id) || value?.schema !== 'podview.source.v1' || value.kind !== 'owner_receipt' ||
    value.receiptId !== id || value.externalSourcesProvided !== false || !text(value.toolName) ||
    !text(value.summary, 600) || !finite(value.observedAt) || value.observedAt * 1000 < now - 120000 ||
    value.observedAt * 1000 > now + 5000 || !facts?.length || facts.length > 6) throw Error('invalid_owned_source');
  const seen = new Set<string>();
  const rows = facts.map(entry => {
    const row = record(entry);
    if (!row || !text(row.id, 80) || seen.has(row.id) || !text(row.label, 80) || !text(row.value, 80) ||
      !text(row.detail, 200)) throw Error('invalid_source_fact');
    seen.add(row.id);
    return {id: row.id, label: row.label, value: row.value, detail: row.detail};
  });
  return {provenance: sourceProvenance(value.provenance, now), receiptId: id, toolName: value.toolName,
    summary: value.summary, observedAt: value.observedAt, facts: rows};
}

const HISTORY_KEYS = 'bootId,items,receiptIds,removalRevision,revision,roomId,schema';
const ROW_KEYS = [
  'content,family,observedAt,provenance,receiptId,title',
  'content,family,observedAt,provenance,receiptId,sessionId,title',
  'content,family,observedAt,provenance,receiptId,sessionId,title,turnId',
];
const PROVENANCE_KINDS = ['tool_result', 'ha_weather', 'owner_sources', 'ai_explanation'];

// Archived display is separate from current receipt/source authority; timestamps stay original.
export function historicalAnswers(raw: unknown, snapshotRaw: unknown, now = Date.now()) {
  const value = record(raw);
  const snapshot = record(snapshotRaw);
  const items = list(value?.items);
  const receiptIds = list(value?.receiptIds);
  const known = list(snapshot?.answerHistoryReceiptIds);
  if (value?.schema !== 'podview.answer-history.v1' || Object.keys(value).sort().join(',') !== HISTORY_KEYS ||
    !snapshot || value.bootId !== snapshot.bootId || value.roomId !== snapshot.roomId ||
    record(snapshot.capabilities)?.answerRead !== true || !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 || value.revision !== snapshot.answerHistoryRevision ||
    !Number.isSafeInteger(value.removalRevision) || (value.removalRevision as number) < 0 ||
    (value.removalRevision as number) > (value.revision as number) ||
    value.removalRevision !== snapshot.answerHistoryRemovalRevision || !items || items.length > 20 || !receiptIds ||
    !known || receiptIds.length !== items.length || JSON.stringify(receiptIds) !== JSON.stringify(known) ||
    items.some((row, index) => record(row)?.receiptId !== receiptIds[index])) throw Error('invalid_answer_history');
  const seen = new Set<string>();
  const admitted = items.map((entry): OwnedAnswer => {
    const row = record(entry);
    const p = record(row?.provenance);
    if (!row || !ROW_KEYS.includes(Object.keys(row).sort().join(',')) ||
      ('sessionId' in row && !text(row.sessionId, 256)) || ('turnId' in row && !text(row.turnId, 256)) ||
      !receipt(row.receiptId) || seen.has(row.receiptId) || !(isTypedFamily(row.family) || isVisualFamily(row.family)) ||
      !text(row.title, 160) || !finite(row.observedAt) || row.observedAt < 0 || row.observedAt * 1000 > now + 5000 ||
      !p || Object.keys(p).join(',') !== 'kind' || !PROVENANCE_KINDS.includes(p.kind as string) ||
      new TextEncoder().encode(JSON.stringify(row)).length > 65536) throw Error('invalid_historical_answer');
    const {receiptId, family, title, observedAt} = row;
    seen.add(receiptId);
    const ai = p.kind === 'ai_explanation';
    if (ai) {
      const body = record(row.content);
      if (!explanationAdmitted(family, body, undefined)) throw Error('invalid_historical_explanation');
      if (!explanationAdmitted('', undefined, body?.image ?? body?.illustration)) throw Error('invalid_historical_image');
    }
    const admittedContent = content(family, row.content, {ownerReceiptIds: [receiptId], allowConversation: ai});
    // The saved copy must already be closed: nothing outside the admitted shape may have been stored.
    const keys = new Set<string>();
    JSON.stringify(row.content, (key, v: unknown) => {
      keys.add(key);
      return v;
    });
    const order = [...keys].sort();
    if (JSON.stringify(row.content, order) !== JSON.stringify(admittedContent, order)) {
      throw Error('unclosed_historical_content');
    }
    return {
      id: `receipt:${receiptId}`,
      receiptId,
      ...(row.sessionId ? {sessionId: row.sessionId as string} : {}),
      ...(row.turnId ? {turnId: row.turnId as string} : {}),
      kind: family,
      title,
      observedAt,
      content: admittedContent,
      provenance: {kind: p.kind} as Provenance,
      status: 'ready',
      live: true,
      historical: true,
      presentation: true,
      ownerReceiptIds: [receiptId],
      allowedActions: [],
      readContext: null,
      readConnected: false,
      readStatus: 'ready',
      displaySuggested: false,
      hidden: false,
    };
  });
  return {revision: value.revision as number, removalRevision: value.removalRevision as number, items: admitted};
}
