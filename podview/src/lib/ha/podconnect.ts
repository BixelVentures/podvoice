// Music beyond play/pause: a room's queue, moving the music between rooms, and starting music in a room. PodConnect
// owns all of it; the panel reaches it through the PodVoice integration's music bridge
// (custom_components/podvoice/music_bridge.py: podvoice.music_queue, music_queue_play, music_move), which finds the
// PodConnect room behind a media_player and keeps the add-on's rules (never another Spotify login's music), and
// through HA's own media_player.play_media on a PodConnect room (a start). Rules (music memory):
// - Status = the speaker: what HA reports for the room's media_player confirms every wish.
// - Last tap wins: a new choice replaces the wish on its control; an older call's answer no longer counts.
// - Errors never lock or stick: an unknown outcome is shown once, never resent, and the next tap goes through.
// The speaker picker's own lifecycle (2.1.33): the next start's destination, a choice made while the player shows
// the room's last report (warm-up) and a choice made while a start is on its way are each made once, later.
import {keepPreviousData, useQuery} from '@tanstack/react-query';
import {z} from 'zod';
import {create} from 'zustand';
import type {CommandStore} from './commands';
import {commands as appCommands} from './commands';
import type {HassEntityState} from './hass';
import {UNAVAILABLE} from './hass';
import type {CallOutcome, ServiceCall} from './transport';
import {callService, haKeys, serviceResponse} from './transport';

// ---- Reading the room's PodConnect facts ------------------------------------------------------------------------

export type Account = 'own' | 'other' | 'unknown';
export type Source = 'spotify' | 'radio' | null;

export const accountOf = (entity: HassEntityState | null): Account => {
  const value = entity?.attributes.podconnect_account;
  return value === 'own' || value === 'other' ? value : 'unknown';
};
export const sourceOf = (entity: HassEntityState | null): Source => {
  const value = entity?.attributes.podconnect_source;
  return value === 'spotify' || value === 'radio' ? value : null;
};
export const ACTIVE = new Set(['playing', 'paused', 'buffering']);
export const isActive = (entity: HassEntityState | null) => !!entity && ACTIVE.has(entity.state);
// A track is loaded: a title or a content id (a speaker paused with nothing in it has neither).
export const hasTrack = (entity: HassEntityState | null) => {
  const a = entity?.attributes;
  return (typeof a?.media_title === 'string' && !!a.media_title) ||
    (typeof a?.media_content_id === 'string' && !!a.media_content_id);
};
// Music the panel may act on: a track plays (or is paused) in the room and is not another Spotify login's. A speaker
// paused with no track is not music (G7 #2: it never turns another room's player into »away«).
export const ownMusic = (entity: HassEntityState | null) =>
  isActive(entity) && hasTrack(entity) && accountOf(entity) !== 'other' && sourceOf(entity) !== 'radio';
/** The room's own music elsewhere: playing wins over an older pause (G7 #2). */
export function ownMusicOf(entities: readonly (HassEntityState | null)[]): HassEntityState | null {
  const own = entities.filter((entity): entity is HassEntityState => ownMusic(entity));
  return own.find(entity => entity.state === 'playing') ?? own[0] ?? null;
}

// ---- Queue ------------------------------------------------------------------------------------------------------

const queueItem = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/),
  title: z.string().max(256),
  artist: z.string().max(512),
  artwork: z.string().max(2048).nullable().optional(),
  uri: z.string().regex(/^spotify:track:[A-Za-z0-9]{22}$/),
  order: z.number().int().min(1).max(20),
});
export type QueueItem = z.infer<typeof queueItem>;

export const QUEUE_STATUSES = ['ready', 'empty', 'idle', 'radio', 'other_account', 'elsewhere', 'unobserved',
  'unavailable', 'not_podconnect'] as const;
export const queueSchema = z.looseObject({
  ok: z.literal(true),
  status: z.enum(QUEUE_STATUSES),
  items: z.array(queueItem).max(20),
  selectable: z.boolean(),
  truncated: z.boolean().optional(),
});
export type QueueRead = z.infer<typeof queueSchema>;

// The queue belongs to what plays: a new track (or a resync) is a new read.
export const trackKey = (entity: HassEntityState | null) =>
  JSON.stringify([entity?.state ?? null, entity?.attributes.media_content_id ?? null,
    entity?.attributes.media_title ?? null]);

export const queueKey = (entityId: string, track: string, generation: number) =>
  [...haKeys.read, 'queue', entityId, track, generation] as const;

export function useQueue(entityId: string | null, track: string, generation: number, enabled: boolean) {
  return useQuery({
    queryKey: queueKey(entityId ?? '', track, generation),
    enabled: !!entityId && enabled,
    staleTime: 15_000,
    gcTime: 60_000,
    // The rows already shown stay while the next read runs: no empty intermediate state.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<QueueRead> => {
      const result = await serviceResponse(
        {domain: 'podvoice', service: 'music_queue', data: {entity_id: entityId ?? ''}, returnResponse: true},
        queueSchema,
      );
      if (!result.ok) throw new Error(result.reason || result.outcome);
      return result.value;
    },
  });
}

// ---- One bridge call, read into the command lifecycle's outcome ------------------------------------------------

const receiptSchema = z.looseObject({
  ok: z.boolean(),
  outcome: z.enum(['accepted', 'rejected', 'unknown']),
  reason: z.string().max(80).optional(),
});

export async function bridgeCall(call: ServiceCall & {returnResponse: true}, source: CommandStore['source']):
  Promise<CallOutcome> {
  const result = await serviceResponse(call, receiptSchema, source);
  if (!result.ok) return result;
  const {outcome, reason = ''} = result.value;
  if (outcome === 'accepted') return {ok: true, response: result.value};
  return {ok: false, outcome, reason};
}

// ---- Commands ---------------------------------------------------------------------------------------------------

export const queueKeyOf = (entityId: string) => `${entityId}:queue`;
// One wish for »where the music goes« and one for »start something«: a new tap replaces the older one.
export const MOVE_KEY = 'music:move';
export const START_KEY = 'music:start';

const contentOf = (entity: HassEntityState | null) => entity?.attributes.media_content_id;

// How long a start may take before its outcome is unknown: the old wall page's wait for the chosen song
// (live-music-selection-view.js selectionDisplayWaitMs, 30 s).
export const START_WAIT_MS = 30_000;

const NOTICE_PHASES = new Set(['rejected', 'unknown', 'not_sent']);
const watched = new WeakSet<CommandStore>();

// A playlist's start is seen when the speaker plays another track than before, or a track that began after the tap
// (the old page's rule: its position is within the time since the tap, plus 2 s).
export function startedSince(entity: HassEntityState | null, before: unknown, at: number): boolean {
  if (!isActive(entity)) return false;
  if (contentOf(entity) !== before) return true;
  const a = entity?.attributes;
  const position = typeof a?.media_position === 'number' ? a.media_position : NaN;
  const updated = typeof a?.media_position_updated_at === 'string' ? Date.parse(a.media_position_updated_at) : NaN;
  return Number.isFinite(position) && Number.isFinite(updated) && updated >= at &&
    position * 1000 <= updated - at + 2000;
}

export function musicCommands(store: CommandStore = appCommands) {
  watchStarts(store);
  return {
    // Play one queue row; the speaker playing that track confirms it.
    playQueueItem(entityId: string, item: QueueItem): number {
      return store.send({
        key: queueKeyOf(entityId),
        entityId,
        value: item.id,
        confirm: entity => contentOf(entity) === item.uri,
        call: () => bridgeCall({domain: 'podvoice', service: 'music_queue_play', returnResponse: true,
          data: {entity_id: entityId, option_id: item.id, uri: item.uri}}, store.source),
      });
    },
    // Move the music from one room to another; the destination playing it confirms it.
    move(from: string, to: string) {
      const before = contentOf(store.source.read(from));
      store.send({
        key: MOVE_KEY,
        entityId: to,
        value: to,
        confirm: entity => ownMusic(entity) && (before === undefined || contentOf(entity) === before),
        observed: () => store.source.read(to),
        call: () => bridgeCall({domain: 'podvoice', service: 'music_move', returnResponse: true,
          data: {entity_id: from, target_entity_id: to}}, store.source),
        timeoutMs: 15_000,
      });
    },
    // Start Spotify content in a room (PodConnect's play_media selects the room, then plays). A track is confirmed
    // when the speaker plays it; a playlist when the speaker plays a track that started after the tap.
    start(entityId: string, uri: string, kind: 'music' | 'playlist' = 'music'): number {
      const before = contentOf(store.source.read(entityId));
      const at = Date.now();
      return store.send({
        key: START_KEY,
        entityId,
        value: uri,
        confirm: entity => (kind === 'music' ? isActive(entity) && contentOf(entity) === uri
          : startedSince(entity, before, at)),
        call: () => callService({domain: 'media_player', service: 'play_media', entityId,
          data: {media_content_id: uri, media_content_type: kind}}, store.source),
        timeoutMs: START_WAIT_MS,
      });
    },
  };
}

export const music = musicCommands();

// ---- The speaker picker's lifecycle ----------------------------------------------------------------------------

export interface QueuedChoice {
  to: string;
  at: number;
  // Made while the player showed the room's last report: waits for the room's own state.
  warmup: boolean;
}

// What a tap started, shown in the player at once (the old wall page's pending player, live-music-selection-view.js
// pendingPlayer): the chosen item's cover, title and artist with a loading mark, until the speaker plays it.
export interface StartItem {
  uri: string;
  kind: 'music' | 'playlist';
  title: string;
  artist: string;
  artwork: string | null;
}
export interface PendingStart extends StartItem {
  // The wish it belongs to (START_KEY, or a queue row's key) and its sequence: a newer tap replaces it.
  key: string;
  seq: number;
  to: string;
  // Where the tap came from (a Find musik shelf, the activity results, the idle player, the queue).
  source: string;
}
// A start that did not happen: where, from which source, and why (not sent: no link; else HA refused it or its outcome
// is unknown).
export interface StartFailure {
  to: string;
  name: string;
  source: string;
  sent: boolean;
  seq: number;
}

interface Speakers {
  // Where the next start goes (a speaker chosen in »Afspil på« this session). Null: the screen's room's speaker.
  nextDestination: string | null;
  queued: QueuedChoice | null;
  pending: PendingStart | null;
  failed: StartFailure | null;
  // Speakers whose last start failed this session (»Kunne ikke starte · Prøv igen« on their row).
  failedSpeakers: readonly string[];
  // The cover a confirmed track was tapped with: kept while that speaker plays that track, so the hand-over from the
  // pending item to the speaker's own state shows the same picture (HA's proxy URL for the same art is another URL).
  handover: {to: string; uri: string; artwork: string} | null;
}

export const useSpeakers = create<Speakers>(() => ({nextDestination: null, queued: null, pending: null,
  failed: null, failedSpeakers: [], handover: null}));

// How long a failed start's notice stands, unless a new tap comes first.
export const START_FAILED_MS = 20_000;


// The pending item follows its wish: confirmed (the wish ends) it gives way to the speaker's own state; refused or
// unknown it goes too, the start's notice is shown, and the next start goes to the screen's room's speaker again.
function watchStarts(store: CommandStore) {
  if (watched.has(store)) return;
  watched.add(store);
  store.store.subscribe(state => {
    const pending = useSpeakers.getState().pending;
    if (!pending) return;
    const wish = state.wishes[pending.key];
    if (wish?.seq === pending.seq && (wish.phase === 'sending' || wish.phase === 'awaiting')) return;
    if (wish?.seq === pending.seq && NOTICE_PHASES.has(wish.phase)) {
      const sent = wish.phase !== 'not_sent';
      const entity = store.source.read(pending.to);
      const name = typeof entity?.attributes.friendly_name === 'string' && entity.attributes.friendly_name
        ? entity.attributes.friendly_name : pending.to;
      const failed: StartFailure = {to: pending.to, name, source: pending.source, sent, seq: pending.seq};
      useSpeakers.setState(current => ({
        pending: null,
        failed,
        ...(sent ? {nextDestination: null,
          failedSpeakers: [...current.failedSpeakers.filter(id => id !== pending.to), pending.to]} : {}),
      }));
      setTimeout(() => {
        if (useSpeakers.getState().failed === failed) useSpeakers.setState({failed: null});
      }, START_FAILED_MS);
      return;
    }
    // Confirmed (the wish ended): the speaker's own state takes over, with the tapped cover for the same track.
    if (!wish) {
      useSpeakers.setState({pending: null, handover: pending.kind === 'music' && pending.artwork
        ? {to: pending.to, uri: pending.uri, artwork: pending.artwork} : null});
      return;
    }
    // Replaced by a newer tap on the same control (it sets its own pending item).
    useSpeakers.setState({pending: null});
  });
}

// One tap on an item: the start is sent and the player shows the item at once (last tap wins).
export function startMusic(to: string | null, item: StartItem, source: string, commands = music) {
  if (!to) return;
  const seq = commands.start(to, item.uri, item.kind);
  useSpeakers.setState(current => ({
    pending: {...item, key: START_KEY, seq, to, source},
    failed: null,
    handover: null,
    failedSpeakers: current.failedSpeakers.filter(id => id !== to),
  }));
}

// A queue row: the player shows the row at once, as a start does.
export function playQueueRow(entityId: string, item: QueueItem, commands = music) {
  const seq = commands.playQueueItem(entityId, item);
  useSpeakers.setState({
    pending: {uri: item.uri, kind: 'music', title: item.title, artist: item.artist, artwork: item.artwork ?? null,
      key: queueKeyOf(entityId), seq, to: entityId, source: 'queue'},
    failed: null,
    handover: null,
  });
}

export const QUEUED_MS = 30_000;

export interface PickerContext {
  // The player whose music a choice moves (the full player's speaker).
  from: string | null;
  // HA's state for it now, and whether the page shows its last report instead (warm-up).
  entity: HassEntityState | null;
  lastKnownActive: boolean;
  // A start (Find musik, radio) is on its way.
  starting: boolean;
  now?: number;
}

export function speakerPicker(store: CommandStore = appCommands, commands = musicCommands(store)) {
  const warmingUp = (context: PickerContext) =>
    context.lastKnownActive && (!context.entity || UNAVAILABLE.has(context.entity.state));

  // One explicit choice, made once: a move of the music, the next start's destination, or queued for later.
  const choose = (to: string, context: PickerContext) => {
    const now = context.now ?? Date.now();
    if (warmingUp(context)) {
      useSpeakers.setState({queued: {to, at: now, warmup: true}});
      return 'queued' as const;
    }
    if (context.starting) {
      useSpeakers.setState({queued: {to, at: now, warmup: false}});
      return 'queued' as const;
    }
    useSpeakers.setState(current => ({queued: null, failed: null,
      failedSpeakers: current.failedSpeakers.filter(id => id !== to)}));
    if (context.from && context.from !== to && ownMusic(context.entity)) {
      useSpeakers.setState({nextDestination: null});
      commands.move(context.from, to);
      return 'move' as const;
    }
    if (context.from === to && ownMusic(context.entity)) {
      // The music already plays here: nothing to send.
      useSpeakers.setState({nextDestination: null});
      return 'here' as const;
    }
    useSpeakers.setState({nextDestination: to});
    return 'destination' as const;
  };

  // A queued choice runs once: after the warm-up when the room's own state is back, after a start when it settled
  // (within 30 s). Called whenever the context changes.
  const runQueued = (context: PickerContext) => {
    const queued = useSpeakers.getState().queued;
    if (!queued) return null;
    const now = context.now ?? Date.now();
    if (queued.warmup) {
      if (warmingUp(context)) return null;
      useSpeakers.setState({queued: null});
      return choose(queued.to, {...context, lastKnownActive: false, starting: false});
    }
    if (now - queued.at > QUEUED_MS) {
      useSpeakers.setState({queued: null});
      return null;
    }
    if (context.starting) return null;
    useSpeakers.setState({queued: null});
    return choose(queued.to, context);
  };

  return {choose, runQueued};
}

export const speakers = speakerPicker();

// The cover to show for a speaker's track: the tapped cover while it plays the track it was tapped for.
export function handoverCover(handover: Speakers['handover'], entity: HassEntityState | null,
  fallback: string | null): string | null {
  return handover && entity?.entity_id === handover.to && contentOf(entity) === handover.uri ? handover.artwork
    : fallback;
}

export function resetSpeakers() {
  useSpeakers.setState({nextDestination: null, queued: null, pending: null, failed: null, failedSpeakers: [],
    handover: null});
}
