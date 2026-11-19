// Find musik: the closed client model of PodVoice's shelves read (schema podview.music_shelves.v1).
// Everything shown traces to that read: library rows from PodConnect, AI shelves with the reason PodVoice
// composed from real facts. The choice set (candidateSet) is opaque play authority for one minute; the URIs
// here only identify what is shown and which occurrence a tap names.

export type ItemKind = 'playlist' | 'album' | 'artist' | 'show';

export interface ShelfItem {
  uri: string;
  kind: ItemKind;
  name: string;
  byline?: string;
  artwork?: string;
  lastPlayedAt?: string;
}

export interface Shelf {
  id: string;
  title: string;
  ai: boolean;
  why: string | null;
  shape: 'square' | 'round';
  items: number[];
}

export interface QuickPick {
  item: number;
  ai?: string;
}

export interface ShelvesPage {
  bootId: string;
  roomId: string;
  account: string;
  ownerEpoch: string | null;
  items: ShelfItem[];
  quick: QuickPick[];
  shelves: Shelf[];
  refreshing: boolean;
}

export interface SourceTrack {
  uri: string;
  name: string;
  artist: string;
  artwork: {kind: string; provider: 'spotify'; url: string} | null;
}

export interface ShelvesContext {
  schema: string;
  bootId: string;
  roomId: string;
  configEntryId: string;
  source: string;
  query: string;
  sourceKind: 'shelves';
  revisionScope: string;
  sessionId: string;
  turnId: string;
  taskId: string;
  inputRevision: number;
  revision: number;
  candidateSetId: string;
}

// The start flow's collection source (music-selection-model.js): the whole page's choice set.
export interface ShelvesSource {
  tracks: SourceTrack[];
  items: {id: string; index: number}[];
  sourceKind: 'shelves';
  context: ShelvesContext;
  expiresAt: number;
  candidateIds?: string[];
}

export const TYPE_LABEL: Record<ItemKind, string> = {
  playlist: 'Playliste',
  album: 'Album',
  artist: 'Kunstner',
  show: 'Podcast',
};

const URI = /^spotify:(playlist|album|artist|show):[A-Za-z0-9]{22}$/;
const IMAGE = new RegExp('^https://(i\\.scdn\\.co|image-cdn-fa\\.spotifycdn\\.com|image-cdn-ak\\.spotifycdn\\.com)'
  + '/image/[A-Za-z0-9_-]{1,128}$');
const PLAYED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const HEX64 = /^[a-f0-9]{64}$/;
const OPTION = /^[a-f0-9]{24}$/;
const SHELF_IDS = new Set(['ai_moment', 'artists', 'ai_artist', 'recent', 'ai_daypart', 'albums', 'playlists',
  'ai_season', 'podcasts']);
const MAX_ITEMS = 120;

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

function item(value: unknown): ShelfItem | null {
  if (!record(value) || !text(value.uri, 64) || !URI.test(value.uri) || !text(value.name, 256)) return null;
  const kind = value.uri.split(':')[1] as ItemKind;
  if (value.kind !== kind) return null;
  const row: ShelfItem = {uri: value.uri, kind, name: value.name};
  if (text(value.byline, 512)) row.byline = value.byline;
  if (typeof value.artwork === 'string' && IMAGE.test(value.artwork)) row.artwork = value.artwork;
  if (typeof value.lastPlayedAt === 'string' && PLAYED.test(value.lastPlayedAt)) row.lastPlayedAt = value.lastPlayedAt;
  return row;
}

// The read's page, or null when any part is outside the contract (then the last-known page stays).
export function shelvesPage(body: unknown, account: string, snapshot: {bootId?: unknown; roomId?: unknown} | null)
  : ShelvesPage | null {
  if (!record(body) || body.ok !== true || body.schema !== 'podview.music_shelves.v1') return null;
  if (body.configEntryId !== account || !text(snapshot?.bootId, 1024) || body.bootId !== snapshot.bootId
    || !text(snapshot.roomId, 1024) || body.roomId !== snapshot.roomId) return null;
  if (!Array.isArray(body.items) || body.items.length > MAX_ITEMS || !Array.isArray(body.quick)
    || body.quick.length > 6 || !Array.isArray(body.shelves) || body.shelves.length > SHELF_IDS.size) return null;
  const items: ShelfItem[] = [];
  const uris = new Set<string>();
  for (const value of body.items) {
    const row = item(value);
    if (!row || uris.has(row.uri)) return null;
    uris.add(row.uri);
    items.push(row);
  }
  const index = (value: unknown): value is number => integer(value, 0, items.length - 1);
  const quick: QuickPick[] = [];
  for (const value of body.quick) {
    if (!record(value) || !index(value.item)) return null;
    if (value.ai !== undefined && !text(value.ai, 40)) return null;
    quick.push(value.ai === undefined ? {item: value.item} : {item: value.item, ai: value.ai});
  }
  const shelves: Shelf[] = [];
  const ids = new Set<string>();
  for (const value of body.shelves) {
    if (!record(value) || typeof value.id !== 'string' || !SHELF_IDS.has(value.id) || ids.has(value.id)
      || !text(value.title, 80) || typeof value.ai !== 'boolean' || value.ai !== value.id.startsWith('ai_')
      || !(value.why === null || text(value.why, 200)) || (value.ai && value.why === null)
      || !['square', 'round'].includes(value.shape as string) || !Array.isArray(value.items)
      || value.items.length < 1 || value.items.length > 20 || !value.items.every(index)) return null;
    ids.add(value.id);
    shelves.push({id: value.id, title: value.title, ai: value.ai, why: value.why,
      shape: value.shape as 'square' | 'round', items: [...value.items]});
  }
  return {bootId: body.bootId, roomId: body.roomId, account,
    ownerEpoch: text(body.ownerEpoch, 128) ? body.ownerEpoch : null, items, quick, shelves,
    refreshing: body.refreshing === true};
}

export function sourceTrack(row: ShelfItem): SourceTrack {
  return {uri: row.uri, name: row.name, artist: TYPE_LABEL[row.kind],
    artwork: row.artwork ? {kind: row.kind === 'playlist' ? 'playlist_cover' : 'album_cover', provider: 'spotify',
      url: row.artwork} : null};
}

// The page's choice set as the start flow's collection source; null when this screen may not choose.
export function shelvesSource(body: unknown, page: ShelvesPage, snapshot: Json | null, requestedAt: number)
  : ShelvesSource | null {
  if (!record(body) || !record(body.candidateSet) || !snapshot) return null;
  const c = body.candidateSet;
  const capabilities = record(snapshot.capabilities) ? snapshot.capabilities : {};
  if (c.schema !== 'podview.music-search-context.v1' || c.source !== 'spotify_web_api' || c.sourceKind !== 'shelves'
    || c.query !== 'shelves:collection' || typeof c.candidateSetId !== 'string' || !HEX64.test(c.candidateSetId)
    || c.bootId !== page.bootId || c.roomId !== page.roomId || c.configEntryId !== page.account
    || !['music_selection', 'answer_task'].includes(c.revisionScope as string)
    || !integer(c.revision, 0, Number.MAX_SAFE_INTEGER) || !integer(c.inputRevision, 0, Number.MAX_SAFE_INTEGER)
    || !['sessionId', 'turnId', 'taskId'].every(key => text(c[key], 1024))
    || !Array.isArray(c.items) || c.items.length !== page.items.length || capabilities.musicSelection !== true
    || !Number.isFinite(requestedAt)) return null;
  const items: {id: string; index: number}[] = [];
  const seen = new Set<string>();
  const indices = new Set<number>();
  for (const row of c.items as unknown[]) {
    if (!record(row) || typeof row.id !== 'string' || !OPTION.test(row.id) || seen.has(row.id)
      || !integer(row.index, 0, page.items.length - 1) || indices.has(row.index)) return null;
    seen.add(row.id);
    indices.add(row.index);
    items.push({id: row.id, index: row.index});
  }
  return {tracks: page.items.map(sourceTrack), items, sourceKind: 'shelves', expiresAt: requestedAt + 60000,
    context: {schema: c.schema, bootId: page.bootId, roomId: page.roomId, configEntryId: page.account,
      source: c.source, query: c.query, sourceKind: 'shelves', revisionScope: c.revisionScope as string,
      sessionId: c.sessionId as string, turnId: c.turnId as string, taskId: c.taskId as string,
      inputRevision: c.inputRevision, revision: c.revision, candidateSetId: c.candidateSetId}};
}

// One tapped tile as the start flow's selection: the same choice set, one candidate.
export function tileSelection(source: ShelvesSource | null, uri: string): ShelvesSource | null {
  if (!source || source.expiresAt <= Date.now()) return null;
  const index = source.tracks.findIndex(track => track.uri === uri);
  const option = source.items.find(row => row.index === index);
  const track = source.tracks[index];
  if (!option || !track) return null;
  return {...source, tracks: [track], items: [{id: option.id, index: 0}], candidateIds: [option.id]};
}

const WEEKDAYS = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const zoned = (moment: number) => {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit',
    day: '2-digit'}).format(new Date(moment));
  return Date.parse(`${parts}T00:00:00Z`);
};

// »i dag«, »i går«, »i søndags« (this week), else »12. nov.« — Copenhagen calendar days.
export function playedLabel(iso: string | undefined, now: number): string {
  const played = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(played) || played > now + 60000) return '';
  const days = Math.round((zoned(now) - zoned(played)) / 86400000);
  if (days <= 0) return 'i dag';
  if (days === 1) return 'i går';
  if (days < 7) return `i ${WEEKDAYS[new Date(zoned(played)).getUTCDay()] ?? ''}s`;
  return new Intl.DateTimeFormat('da-DK', {day: 'numeric', month: 'short', timeZone: 'Europe/Copenhagen'})
    .format(new Date(played));
}

// The line under a cover: what the row is, from the shelf's own source.
export function tileSubtitle(row: ShelfItem, shelf: Shelf, now: number): string {
  if (shelf.id === 'artists' || row.kind === 'artist' && shelf.id !== 'recent') return '';
  if (shelf.id === 'recent') {
    const played = playedLabel(row.lastPlayedAt, now);
    return played ? `${TYPE_LABEL[row.kind]} · ${played}` : TYPE_LABEL[row.kind];
  }
  if (row.kind === 'album' || row.kind === 'show') return row.byline ?? TYPE_LABEL[row.kind];
  return TYPE_LABEL[row.kind];
}

export const aiBadge = (short: string) => `AI-valgt · ${short}`;
