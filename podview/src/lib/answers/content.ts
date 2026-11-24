// The read-only content of a Svar answer, admitted from the add-on's JSON: four visual families, sport results and key
// points, and six typed answer forms. This validates shape, not the truth of the source data, and always returns a
// closed copy: model-supplied HTML, styles or actions never reach the card. No runtime imports beyond relative .ts
// files: the server tests run the answer models in plain Node (type stripping).
import {spotifyArtwork} from '../api/artwork.ts';

export type Json = Readonly<Record<string, unknown>>;

export const visualFamilies = ['fact-card', 'sourced-image', 'answer-timeline', 'simple-diagram'] as const;
export const answerFamilies = [...visualFamilies, 'sport-result', 'key-points'] as const;
export const typedAnswerFamilies = ['concise', 'choices', 'comparison', 'chart', 'steps', 'checklist'] as const;
export type VisualFamily = (typeof answerFamilies)[number];
export type TypedFamily = (typeof typedAnswerFamilies)[number];

export const isVisualFamily = (value: unknown): value is VisualFamily =>
  (answerFamilies as readonly unknown[]).includes(value);
export const isTypedFamily = (value: unknown): value is TypedFamily =>
  (typedAnswerFamilies as readonly unknown[]).includes(value);

export const record = (value: unknown): Json | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
export const list = (value: unknown): readonly unknown[] | null => (Array.isArray(value) ? value : null);
export const string = (value: unknown, max = 300): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const str = (value: unknown) => (typeof value === 'string' ? value : '');

function fail(): never {
  throw new Error('Invalid visual content');
}

export const BICYCLE_ILLUSTRATION = 'assets/bicycle-drivetrain-illustration.webp';

function link(value: unknown, image = false): boolean {
  if (!string(value, 2048) || /[\s\\]/.test(value)) return false;
  // Relative content must be an app-owned asset.
  if (image && /^assets\/[a-zA-Z0-9_/-]+\.(png|jpg|jpeg|webp)$/.test(value) && !value.includes('..')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

// Every row a record with a unique id (≤80) that passes `check`; 1..max rows.
function rows(items: unknown, max: number, check: (item: Json) => boolean): Json[] {
  const array = list(items);
  if (!array?.length || array.length > max) fail();
  const ids = new Set<string>();
  const out: Json[] = [];
  for (const raw of array) {
    const item = record(raw);
    if (!item || !string(item.id, 80) || ids.has(item.id) || !check(item)) fail();
    ids.add(item.id);
    out.push(item);
  }
  return out;
}

export interface OwnerSource {
  id: string;
  label: string;
  kind: 'owner_receipt';
  receiptId: string;
  scope: string;
}
export interface LinkSource {
  id: string;
  label: string;
  url: string;
  scope: string;
}
export type Source = OwnerSource | LinkSource;

export interface AdmitOptions {
  ownerReceiptIds?: readonly string[];
  allowConversation?: boolean;
}

function validateSources(raw: unknown, {ownerReceiptIds = [], allowConversation = false}: AdmitOptions): Source[] {
  const sources = rows(raw, 4, s => {
    if (!string(s.label, 120)) return false;
    if (s.kind === 'owner_receipt') {
      return typeof s.receiptId === 'string' && /^[a-f0-9]{32}$/.test(s.receiptId) &&
        ownerReceiptIds.includes(s.receiptId) &&
        (s.scope === 'tool_result' || (allowConversation && s.scope === 'conversation_answer'));
    }
    return link(s.url) && string(s.scope, 240);
  });
  return sources.map(s =>
    s.kind === 'owner_receipt'
      ? {id: str(s.id), label: str(s.label), kind: 'owner_receipt', receiptId: str(s.receiptId), scope: str(s.scope)}
      : {id: str(s.id), label: str(s.label), url: str(s.url), scope: str(s.scope)},
  );
}

export interface Fact {
  id: string;
  label: string;
  value: string;
  detail: string;
  sourceId: string;
}
export interface TimelineEvent {
  id: string;
  time: string;
  label: string;
  detail: string;
  status: 'planned' | 'observed';
  sourceId: string;
}
export interface DiagramNode {
  id: string;
  label: string;
  detail: string;
  sourceId: string;
}
export interface KeyPoint {
  id: string;
  text: string;
  sourceId: string;
}
export interface Picture {
  url: string;
  alt: string;
  caption: string;
  credit: string;
  kind: 'photo' | 'illustration' | 'album_cover';
  sourceId: string;
}
export interface Match {
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  date: string;
  competition: string | null;
}
export interface Scorer {
  id: string;
  team: 'home' | 'away';
  name: string;
  minute: string | null;
  sourceId: string;
}

export interface VisualContent {
  summary: string;
  sources: Source[];
  facts?: Fact[];
  points?: KeyPoint[];
  match?: Match;
  scorers?: Scorer[];
  image?: Picture;
  events?: TimelineEvent[];
  nodes?: DiagramNode[];
  illustration?: Picture;
}

const picture = (raw: Json): Picture => ({
  url: str(raw.url),
  alt: str(raw.alt),
  caption: str(raw.caption),
  credit: str(raw.credit),
  kind: raw.kind as Picture['kind'],
  sourceId: str(raw.sourceId),
});

export function validateVisualContent(family: unknown, raw: unknown, options: AdmitOptions = {}): VisualContent {
  const value = record(raw);
  if (!isVisualFamily(family) || !value || !string(value.summary, 600)) fail();
  const sources = validateSources(value.sources, options);
  const sourceIds = new Set(sources.map(source => source.id));
  const sourced = (item: Json | null | undefined) => !!item && sourceIds.has(str(item.sourceId));
  const result: VisualContent = {summary: value.summary, sources};
  if (family === 'fact-card') {
    result.facts = rows(value.facts, 6, f =>
      string(f.label, 80) && string(f.value, 80) && string(f.detail, 200) && sourced(f),
    ).map(f => ({id: str(f.id), label: str(f.label), value: str(f.value), detail: str(f.detail),
      sourceId: str(f.sourceId)}));
  }
  if (family === 'sourced-image') {
    const image = record(value.image);
    const kinds = ['photo', 'illustration', 'album_cover'];
    if (!image || !link(image.url, true) || !string(image.alt, 300) || !string(image.caption, 300) ||
      !string(image.credit, 160) || !kinds.includes(str(image.kind)) || !sourced(image)) fail();
    if (image.kind === 'album_cover' &&
      (image.credit !== 'Spotify' || !spotifyArtwork({kind: 'album_cover', provider: 'spotify', url: image.url}))) {
      fail();
    }
    result.image = picture(image);
  }
  if (family === 'answer-timeline') {
    result.events = rows(value.events, 8, e =>
      string(e.time, 80) && string(e.label, 120) && string(e.detail, 240) &&
      ['planned', 'observed'].includes(str(e.status)) && sourced(e),
    ).map(e => ({id: str(e.id), time: str(e.time), label: str(e.label), detail: str(e.detail),
      status: e.status as TimelineEvent['status'], sourceId: str(e.sourceId)}));
  }
  if (family === 'simple-diagram') {
    result.nodes = rows(value.nodes, 5, n => string(n.label, 80) && string(n.detail, 200) && sourced(n))
      .map(n => ({id: str(n.id), label: str(n.label), detail: str(n.detail), sourceId: str(n.sourceId)}));
    // Optional explanatory art uses the same bounded source contract as an image answer.
    const art = record(value.illustration);
    if (value.illustration) {
      if (!art || !link(art.url, true) || !string(art.alt, 300) || !string(art.caption, 300) ||
        !string(art.credit, 160) || art.kind !== 'illustration' || !sourced(art)) fail();
      result.illustration = picture(art);
    }
  }
  if (family === 'key-points') {
    result.points = rows(value.points, 4, p => string(p.text, 240) && sourced(p))
      .map(p => ({id: str(p.id), text: str(p.text), sourceId: str(p.sourceId)}));
  }
  if (family === 'sport-result') {
    const m = record(value.match);
    const score = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 999);
    if (!m || !string(m.home, 80) || !string(m.away, 80) || !string(m.date, 80) || !score(m.homeScore) ||
      !score(m.awayScore) || (m.homeScore === null) !== (m.awayScore === null) ||
      !(m.competition === null || string(m.competition, 80))) fail();
    const scorers = list(value.scorers);
    if (!scorers || scorers.length > 12) fail();
    const admitted = scorers.length
      ? rows(scorers, 12, r =>
        ['home', 'away'].includes(str(r.team)) && string(r.name, 80) && (r.minute === null || string(r.minute, 24)) &&
        sourced(r))
      : [];
    result.match = {home: str(m.home), away: str(m.away), homeScore: m.homeScore as number | null,
      awayScore: m.awayScore as number | null, date: str(m.date), competition: m.competition};
    result.scorers = admitted.map(r => ({id: str(r.id), team: r.team as Scorer['team'], name: str(r.name),
      minute: r.minute as string | null, sourceId: str(r.sourceId)}));
  }
  return result;
}

export interface TypedRow {
  id: string;
  label: string;
  detail?: string;
  values?: string[];
  value?: number;
  checked?: boolean;
  sourceId: string;
}

export interface TypedContent {
  summary: string;
  sources: Source[];
  columns?: {id: string; label: string}[];
  items?: TypedRow[];
  unit?: string;
  unitSingular?: string;
  steps?: {id: string; text: string; sourceId: string}[];
}

const TYPED_FIELDS: Readonly<Record<TypedFamily, readonly string[]>> = {
  concise: [],
  choices: ['items'],
  comparison: ['columns', 'items'],
  chart: ['unit', 'unitSingular', 'items'],
  steps: ['steps'],
  checklist: ['items'],
};

export function validateTypedAnswerContent(family: unknown, raw: unknown, options: AdmitOptions = {}): TypedContent {
  const value = record(raw);
  if (!isTypedFamily(family) || !value || !string(value.summary, 600)) fail();
  const sources = validateSources(value.sources, options);
  const sourceIds = new Set(sources.map(source => source.id));
  const sourced = (row: Json) => sourceIds.has(str(row.sourceId));
  const result: TypedContent = {summary: value.summary, sources};
  const allowed = ['summary', 'sources', ...TYPED_FIELDS[family]];
  if (Object.keys(value).some(key => !allowed.includes(key))) fail();
  if (family === 'concise') return result;
  if (family === 'comparison') {
    const columns = rows(value.columns, 3, column => string(column.label, 80));
    result.columns = columns.map(column => ({id: str(column.id), label: str(column.label)}));
    result.items = rows(value.items, 6, row => {
      const values = list(row.values);
      return string(row.label, 80) && !!values && values.length === columns.length &&
        values.every(item => string(item, 80)) && sourced(row);
    }).map(row => ({id: str(row.id), label: str(row.label), values: (list(row.values) ?? []).map(str),
      sourceId: str(row.sourceId)}));
  } else if (family === 'chart') {
    if (!string(value.unit, 24) || !string(value.unitSingular, 24)) fail();
    result.unit = value.unit;
    result.unitSingular = value.unitSingular;
    result.items = rows(value.items, 8, row =>
      string(row.label, 80) && typeof row.value === 'number' && Number.isFinite(row.value) && row.value >= -1e9 &&
      row.value <= 1e9 && sourced(row),
    ).map(row => ({id: str(row.id), label: str(row.label), value: row.value as number, sourceId: str(row.sourceId)}));
  } else if (family === 'steps') {
    result.steps = rows(value.steps, 12, row => string(row.text, 300) && sourced(row))
      .map(row => ({id: str(row.id), text: str(row.text), sourceId: str(row.sourceId)}));
  } else if (family === 'checklist') {
    result.items = rows(value.items, 12, row => string(row.label, 160) && typeof row.checked === 'boolean' &&
      sourced(row)).map(row => ({id: str(row.id), label: str(row.label), checked: row.checked === true,
      sourceId: str(row.sourceId)}));
  } else {
    result.items = rows(value.items, 6, row => string(row.label, 80) && string(row.detail, 200) && sourced(row))
      .map(row => ({id: str(row.id), label: str(row.label), detail: str(row.detail), sourceId: str(row.sourceId)}));
  }
  return result;
}
