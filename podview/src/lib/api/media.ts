// The room's music as PodVoice reports it, read at the wire with zod: the room player (podview.room-player.v1, the
// PodConnect room's own HA media_player: whatever started the music, this is what the room plays), the account's
// queue (podconnect.queue.v1) and the room's configured speaker binding. Account-owned provider observations: no
// room inference and no mutation authority. A rejected payload throws an Error whose message names the reason
// (the room player keeps a known song on a shape-only failure, see room-player.ts).
import {z} from 'zod';
import {spotifyArtwork, spotifyItemUrl} from './artwork';
import type {SpotifyArtwork} from './artwork';

export const PLAYER_FRESH_MS = 30000;
const PLAYER_STATES = ['playing', 'paused', 'buffering', 'idle', 'unavailable'] as const;
export const PLAYER_ACTIONS = ['pause', 'resume', 'next', 'previous', 'seek', 'volume', 'move_here'] as const;
export type PlayerState = (typeof PLAYER_STATES)[number];
export type PlayerAction = (typeof PLAYER_ACTIONS)[number];

const fail = (reason: string): never => {
  throw Error(reason);
};
const text = (limit = 1024) => z.string().min(1).max(limit);
function read<T>(schema: z.ZodType<T>, value: unknown, reason: string): T {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fail(reason);
}
const txt = (value: unknown, limit = 1024) => read(text(limit), value, 'invalid_media_text');
const count = z.number().int().nonnegative().refine(Number.isSafeInteger);
const optionalCount = (value: unknown) => read(count.nullable(), value, 'invalid_player_number');
const optionalText = (value: unknown, limit = 512) => read(text(limit).nullable(), value, 'invalid_media_text');
const countOrNull = (value: unknown) => {
  const parsed = count.safeParse(value);
  return parsed.success ? parsed.data : null;
};

// PodConnect's account session in this room. Only the queue and speaker moves use it.
export interface PlaybackRoomBinding {
  roomId: string;
  accountId: string;
  bindingId: string;
  targetId: string;
  nativeRoomId: string;
  nativeHomepodId: string;
  validUntil: number;
}

export interface MediaItem {
  type: 'track' | 'episode';
  uri: string | null;
  name: string;
  artists: string[];
  album?: string | null;
  duration_ms: number | null;
  artworkUrl?: string | null;
  artwork?: SpotifyArtwork | undefined;
  spotifyUrl?: string | null;
}

// One admitted room player reading (projection version 4).
export interface Playback {
  projectionVersion: number;
  config_entry_id: string;
  bootId: string;
  roomId: string;
  state: PlayerState;
  source: 'spotify' | 'radio' | null;
  observedAt: string;
  receivedAt: number;
  expiresAt: number;
  item: MediaItem | null;
  progressMs: number | null;
  volume: number | null;
  controls: {actions: PlayerAction[]; maxVolume: number | null};
  owner_epoch: string | null;
  poll_sequence: number | null;
  target: {id: string | null; name: string} | null;
  roomBinding: PlaybackRoomBinding | null;
  roomBound: boolean;
  elsewhere?: boolean;
  otherAccount?: boolean;
  // What the screen made of it since: kept for display only (never controls), the last known report after a
  // restart, the speaker name the catalogue gave the actual output.
  stale?: boolean | 'transient';
  displayRetained?: boolean;
  lastKnown?: boolean;
  actualTargetLabel?: string;
  observationStatus?: string;
  accountObserved?: boolean;
}

// The parts of a snapshot these rules read.
export interface MediaSnapshot {
  bootId?: unknown;
  roomId?: unknown;
  mediaRoomBindings?: unknown;
}

const envelope = z.object({
  ok: z.literal(true),
  schema: z.literal('podview.room-player.v1'),
  bootId: z.string(),
  roomId: z.string(),
  configEntryId: z.string(),
});
const stateSchema = z.object({state: z.enum(PLAYER_STATES), source: z.enum(['spotify', 'radio']).nullable()});
const actionsSchema = z.array(z.enum(PLAYER_ACTIONS)).max(PLAYER_ACTIONS.length);
const bindingSchema = z.looseObject({
  roomId: z.string(),
  accountId: z.string(),
  bindingId: z.string().regex(/^[a-f0-9]{64}$/),
  targetId: z.string().min(1),
  nativeRoomId: z.string().min(1),
  nativeHomepodId: z.string().min(1),
  validUntil: z.number().refine(Number.isFinite),
});
const awaySchema = z.looseObject({state: z.enum(['playing', 'paused']), targetName: z.string().min(1)});
const ARTWORK_PATH = /^music\/player\/artwork\?[A-Za-z0-9_.~%=&-]{1,1500}$/;

type Body = Record<string, unknown>;

// The room player as the screen shows it. Throws on anything it cannot admit.
export function roomPlayerObservation(value: unknown, account: unknown, snapshot: MediaSnapshot | null | undefined):
  Playback {
  const parsedHead = envelope.safeParse(value);
  const head = parsedHead.success ? parsedHead.data : null;
  if (!head || head.bootId !== snapshot?.bootId || head.roomId !== snapshot.roomId || head.configEntryId !== account)
    return fail('invalid_room_player');
  const body = value as Body, configEntryId = head.configEntryId;
  const {state, source} = read(stateSchema, body, 'invalid_playback_state');
  const actions = [...new Set(read(actionsSchema, body.actions, 'invalid_player_actions'))];
  const maxVolume = actions.includes('volume') ? body.maxVolume : null;
  if (maxVolume !== null && !(Number.isInteger(maxVolume) && (maxVolume as number) >= 0 &&
    (maxVolume as number) <= 100)) fail('invalid_player_actions');
  const volume = optionalCount(body.volumePercent), durationMs = optionalCount(body.durationMs);
  const progressMs = optionalCount(body.positionMs), positionAt = optionalCount(body.positionAt);
  const uri = body.uri === undefined || body.uri === null ? null : txt(body.uri, 256);
  const artworkUrl = typeof body.artworkUrl === 'string' && ARTWORK_PATH.test(body.artworkUrl) ? body.artworkUrl
    : null;
  const receivedAt = Date.now(), active = ['playing', 'paused', 'buffering'].includes(state);
  const title = optionalText(body.title), artist = optionalText(body.artist), album = optionalText(body.album);
  const session = body.session && typeof body.session === 'object' ? body.session as Body : null;
  const parsedBinding = session ? bindingSchema.safeParse(session.binding) : null;
  const binding = parsedBinding?.success && parsedBinding.data.roomId === snapshot.roomId &&
    parsedBinding.data.accountId === account ? {...parsedBinding.data} : null;
  const controls = {actions, maxVolume: maxVolume as number | null};
  const scope = {projectionVersion: 4, config_entry_id: configEntryId, bootId: head.bootId,
    roomId: head.roomId, receivedAt, expiresAt: receivedAt + PLAYER_FRESH_MS};
  // f) The room is quiet while the user's own account plays on another device (iPhone): that device's own controls
  // (only what it offers), never locked; "Flyt til <rum>" moves it back.
  const elsewhere = !active ? awaySchema.safeParse(body.elsewhere) : null;
  if (elsewhere?.success) {
    const away = body.elsewhere as Body, awayAt = countOrNull(away.positionAt);
    return {
      ...scope, state: elsewhere.data.state, source: 'spotify', elsewhere: true,
      observedAt: new Date(Math.min(receivedAt, awayAt ?? receivedAt)).toISOString(),
      item: {type: 'track', uri: typeof away.uri === 'string' ? txt(away.uri, 256) : null,
        name: optionalText(away.title ?? null) || '',
        artists: typeof away.artist === 'string' && away.artist ? [txt(away.artist)] : [], album: null,
        duration_ms: countOrNull(away.durationMs), artworkUrl: null,
        artwork: spotifyArtwork(away.artwork, away.uri) ?? undefined},
      progressMs: countOrNull(away.positionMs), volume, controls, owner_epoch: null, poll_sequence: null,
      target: {id: typeof away.targetId === 'string' ? away.targetId : null, name: txt(away.targetName, 256)},
      roomBinding: null, roomBound: false,
    };
  }
  // The position anchor is HA's own update time; a clock a little ahead is clamped to now.
  return {
    ...scope, state, source, observedAt: new Date(Math.min(receivedAt, positionAt ?? receivedAt)).toISOString(),
    item: active ? {type: 'track', uri, name: title || (source === 'radio' ? 'Radio' : ''),
      artists: artist ? [artist] : [], album, duration_ms: durationMs, artworkUrl} : null,
    progressMs: active ? progressMs : null, volume, controls,
    owner_epoch: binding && typeof session?.ownerEpoch === 'string' ? session.ownerEpoch : null,
    poll_sequence: binding && Number.isSafeInteger(session?.pollSequence) ? session?.pollSequence as number : null,
    target: binding && typeof session?.targetId === 'string'
      ? {id: session.targetId, name: typeof session.targetName === 'string' ? session.targetName : ''} : null,
    roomBinding: binding, roomBound: true,
    // PodConnect: another Spotify login plays in this room. Never a name (H10).
    otherAccount: active && body.account === 'other',
  };
}

export const observationFresh = (p: {stale?: unknown; expiresAt?: number} | null | undefined) =>
  !!p && !p.stale && Date.now() <= (p.expiresAt ?? 0);

type Seen = Partial<Playback> | null | undefined;
const ACTIVE = ['playing', 'paused', 'buffering'];
// Read access is checked where reads happen (the room player clears itself when it is revoked).
const playerScope = (p: Seen, s: MediaSnapshot | null | undefined, account: unknown = p?.config_entry_id) =>
  p?.projectionVersion === 4 && p.config_entry_id === account && p.bootId === s?.bootId && p.roomId === s?.roomId;

// Something is (or was just) playing in this room: show the player.
export function roomObservationDisplay(playback: Seen, snapshot: MediaSnapshot | null | undefined,
  account: unknown = playback?.config_entry_id): boolean {
  return playerScope(playback, snapshot, account) && ACTIVE.includes(playback?.state ?? '') &&
    (observationFresh(playback) || playback?.displayRetained === true || playback?.stale === 'transient');
}

// The room entity is the room: an active player read is always bound to it (fresh or not).
export function roomObservationBound(playback: Seen, snapshot: MediaSnapshot | null | undefined,
  account: unknown = playback?.config_entry_id): boolean {
  return playerScope(playback, snapshot, account) && ACTIVE.includes(playback?.state ?? '');
}

export function playbackObservationCurrent(playback: Seen, snapshot: MediaSnapshot | null | undefined): boolean {
  return roomObservationDisplay(playback, snapshot) && observationFresh(playback);
}

// Current enough to act on. One transient failed read keeps the last known player usable.
export function roomObservationCurrent(playback: Seen, snapshot: MediaSnapshot | null | undefined): boolean {
  return roomObservationDisplay(playback, snapshot) &&
    (observationFresh(playback) || playback?.stale === 'transient' && Date.now() <= (playback.expiresAt ?? 0));
}

export function playbackBinding(playback: Seen, snapshot: MediaSnapshot | null | undefined,
  account: unknown = playback?.config_entry_id): PlaybackRoomBinding | null {
  const b = playback?.roomBinding;
  return roomObservationDisplay(playback, snapshot, account) && b && b.validUntil * 1000 > Date.now() ? b : null;
}

// A configuration descriptor is read scope, never a control/selection grant.
export interface MediaRoomBinding {
  accountId: string;
  bindingId: string;
  nativeHomepodId: string;
  nativeRoomId: string;
  roomId: string;
  targetId: string;
}
const configured = z.strictObject({
  accountId: z.string(),
  bindingId: z.string().regex(/^[a-f0-9]{64}$/),
  nativeHomepodId: text(),
  nativeRoomId: text(),
  roomId: z.string(),
  targetId: text(),
});
export function mediaRoomBinding(snapshot: MediaSnapshot | null | undefined, account: unknown):
  MediaRoomBinding | null {
  const rows = snapshot?.mediaRoomBindings;
  if (!Array.isArray(rows) || rows.length > 32) return null;
  const matches = rows.filter(row => (row as {accountId?: unknown} | null)?.accountId === account);
  if (matches.length !== 1) return null;
  const parsed = configured.safeParse(matches[0]);
  return parsed.success && parsed.data.roomId === snapshot?.roomId ? parsed.data : null;
}

// The account's queue (podconnect.queue.v1): occurrences of one snapshot, never a play grant.
const queueSchema = z.object({
  ok: z.literal(true),
  schema: z.literal('podconnect.queue.v1'),
  config_entry_id: z.string(),
  scope: z.literal('account'),
  relation_to_playback: z.literal('not_atomic'),
  items: z.array(z.unknown()).max(20),
  returned_count: z.number(),
});
const queueItemSchema = z.looseObject({
  type: z.enum(['track', 'episode']),
  uri: z.string(),
  artists: z.array(z.unknown()).max(20),
});

function queueItem(value: unknown): MediaItem {
  const row = read(queueItemSchema, value, 'invalid_media_item');
  if (!row.uri.startsWith(`spotify:${row.type}:`)) fail('invalid_media_item');
  const duration = (value as Body).duration_ms;
  return {type: row.type, uri: txt(row.uri), name: txt((value as Body).name), artists: row.artists.map(x => txt(x)),
    duration_ms: Number.isInteger(duration) && (duration as number) >= 0 ? duration as number : null,
    artwork: spotifyArtwork((value as Body).artwork) ?? undefined, spotifyUrl: spotifyItemUrl(row.uri)};
}

export interface QueueObservation {
  account: string;
  epoch: string;
  snapshot: string;
  observedAt: string;
  items: (MediaItem & {id: string})[];
  truncated: boolean;
}

export function queueObservation(value: unknown, account: unknown): QueueObservation {
  const parsedHead = queueSchema.safeParse(value);
  const head = parsedHead.success ? parsedHead.data : null;
  if (!head || head.config_entry_id !== account || head.returned_count !== head.items.length)
    return fail('invalid_queue');
  const body = value as Body, epoch = txt(body.owner_epoch, 128), snapshot = txt(body.snapshot_id);
  const seen = new Set<string>();
  const items = head.items.map(row => {
    const id = txt((row as Body | null)?.option_id);
    if (seen.has(id) || !id.startsWith(`${snapshot}:`)) fail('invalid_queue_occurrence');
    seen.add(id);
    return {id, ...queueItem(row)};
  });
  const observedAt = txt(body.observed_at, 64);
  if (!Number.isFinite(Date.parse(observedAt))) fail('invalid_media_timestamp');
  return {account: head.config_entry_id, epoch, snapshot, observedAt, items, truncated: body.truncated === true};
}

// The music lane admits one action at a time. A queue, Find musik or speaker choice made while another music action
// runs waits here for its turn (K3, F2, A9, H1). Only the latest choice waits: an earlier one resolves 'replaced'.
// When the running action ends UNKNOWN the waiting choice resolves 'unknown' and is not sent; otherwise it resolves
// 'free' and checks again.
export type LaneTurn = 'free' | 'replaced' | 'unknown';
export interface MusicLane {
  musicIntentPending?: unknown;
  musicLaneWaiter?: ((turn: LaneTurn) => void) | null;
}
export function waitForMusicLane(controls: MusicLane, busy = !!controls.musicIntentPending): Promise<LaneTurn> {
  if (!busy) return Promise.resolve('free');
  controls.musicLaneWaiter?.('replaced');
  return new Promise(resolve => {
    controls.musicLaneWaiter = resolve;
  });
}
export function releaseMusicLane(controls: MusicLane, turn: LaneTurn) {
  const waiter = controls.musicLaneWaiter;
  controls.musicLaneWaiter = null;
  waiter?.(turn);
}
