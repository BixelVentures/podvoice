// A completed research receipt (podview.research.v1: a web excerpt or a weather forecast) admitted as a Svar answer.
// Closed admission: independent research reads stay inactive; no fetch, no actions.
import {list, record, string, validateVisualContent} from './content.ts';
import type {Json, VisualContent} from './content.ts';

const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const date = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : NaN);

export type ResearchProvenance =
  | {kind: 'tool_result'; retrievedAt: unknown; externalSourcesProvided: false; textTruncated: boolean}
  | {
    kind: 'ha_weather';
    source: string;
    retrievedAt: string;
    continuousCoverage: false;
    forecastType: string;
    displayedPeriods: number;
    displayedStart: string;
    displayedEnd: string;
    coverage: {totalRows: number; returnedRows: number; truncated: boolean; start: string; end: string};
  };

export interface ResearchAnswer {
  id: string;
  kind: 'fact-card' | 'answer-timeline';
  status: 'ready';
  live: true;
  content: VisualContent;
  ownerReceiptIds: string[];
  allowedActions: [];
  observedAt: number;
  validUntil: number;
  provenance: ResearchProvenance;
}

// The binding the receipt must match: the room, session, turn and task, and their revisions.
export type ResearchContext = Json;

export function researchAnswer(raw: unknown, context: ResearchContext, now = Date.now()): ResearchAnswer {
  const row = record(raw);
  const fields = ['roomId', 'sessionId', 'turnId', 'taskId'];
  const revisions = ['inputRevision', 'answerRevision', 'providerGeneration'];
  if (row?.schema !== 'podview.research.v1' || !fields.every(k => string(row[k], 160) && row[k] === context[k]) ||
    !revisions.every(k => integer(row[k]) && row[k] === context[k]) || !finite(row.sessionEpoch) ||
    row.sessionEpoch !== context.sessionEpoch || !finite(row.observedAt) || row.observedAt * 1000 > now + 5000 ||
    row.observedAt * 1000 < now - 120000 || !finite(row.validUntil) || row.validUntil * 1000 <= now ||
    row.validUntil > row.observedAt + 120 || typeof row.receiptId !== 'string' || !/^[a-f0-9]{32}$/.test(row.receiptId) ||
    (row.family !== 'fact-card' && row.family !== 'answer-timeline') || row.displaySuggested !== true ||
    list(row.allowedActions)?.length !== 0) throw Error('invalid_research_binding');
  const {receiptId, family, observedAt, validUntil} = row;
  const content = record(row.content);
  const sources = list(content?.sources);
  const first = record(sources?.[0]);
  if (sources?.length !== 1 || first?.kind !== 'owner_receipt' || first.receiptId !== receiptId) {
    throw Error('invalid_research_receipt');
  }
  const p = record(row.provenance);
  let provenance: ResearchProvenance;
  if (family === 'fact-card') {
    if (p?.kind !== 'tool_result' || p.externalSourcesProvided !== false || p.retrievedAt !== observedAt ||
      typeof p.textTruncated !== 'boolean') throw Error('invalid_web_excerpt');
    provenance = {kind: 'tool_result', retrievedAt: p.retrievedAt, externalSourcesProvided: false,
      textTruncated: p.textTruncated};
  } else {
    const events = (list(content?.events) ?? []).map(record);
    const retrieved = date(p?.retrievedAt);
    if (p?.kind !== 'ha_weather' || !string(p.source, 160) || !Number.isFinite(retrieved) || retrieved > now ||
      validUntil * 1000 > retrieved + 900000 || p.continuousCoverage !== false || !string(p.forecastType, 32) ||
      p.displayedPeriods !== events.length || p.displayedStart !== events[0]?.time ||
      p.displayedEnd !== events.at(-1)?.time) throw Error('invalid_forecast_provenance');
    const c = record(p.coverage);
    if (!c || !integer(c.totalRows) || !integer(c.returnedRows) || c.totalRows < 1 || c.totalRows > 512 ||
      c.returnedRows < 1 || c.returnedRows > c.totalRows || c.truncated !== c.returnedRows < c.totalRows ||
      !Number.isFinite(date(c.start)) || !Number.isFinite(date(c.end)) || date(c.end) < date(c.start) ||
      date(p.displayedStart) < date(c.start) || date(p.displayedEnd) > date(c.end)) {
      throw Error('invalid_forecast_coverage');
    }
    let previous = -Infinity;
    for (const event of events) {
      const stamp = date(event?.time);
      if (!Number.isFinite(stamp) || stamp < observedAt * 1000 || stamp <= previous || event?.status !== 'planned') {
        throw Error('invalid_forecast_period');
      }
      previous = stamp;
    }
    provenance = {
      kind: 'ha_weather',
      source: p.source,
      retrievedAt: p.retrievedAt as string,
      continuousCoverage: false,
      forecastType: p.forecastType,
      displayedPeriods: p.displayedPeriods,
      displayedStart: p.displayedStart as string,
      displayedEnd: p.displayedEnd as string,
      coverage: {totalRows: c.totalRows, returnedRows: c.returnedRows, truncated: c.truncated,
        start: c.start as string, end: c.end as string},
    };
  }
  return {
    id: `receipt:${receiptId}`,
    kind: family,
    status: 'ready',
    live: true,
    content: validateVisualContent(family, row.content, {ownerReceiptIds: [receiptId]}),
    ownerReceiptIds: [receiptId],
    allowedActions: [],
    observedAt,
    validUntil,
    provenance,
  };
}
