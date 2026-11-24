// A PodConnect media_player as the player shows it, and its commands (media_player.* on that entity). The status
// is the speaker's own: what HA reports for the entity, nothing derived from the page.
import type {HassEntityState} from './hass';
import {UNAVAILABLE} from './hass';
import type {CommandStore} from './commands';
import {commands as appCommands} from './commands';
import {create} from 'zustand';
import {callService, transport as appTransport} from './transport';
import type {HaTransport} from './transport';

// HA's MediaPlayerEntityFeature bits.
export const FEATURE = {pause: 1, volumeSet: 4, previous: 16, next: 32, play: 16384} as const;

export type PlayState = 'playing' | 'paused' | 'idle' | 'off' | 'on' | 'buffering' | 'standby' | 'unavailable';

export interface PlayerModel {
  entityId: string;
  name: string;
  state: PlayState;
  available: boolean;
  title: string;
  artist: string;
  album: string;
  artwork: string | null;
  volume: number | null;
  can: {play: boolean; pause: boolean; next: boolean; previous: boolean; volume: boolean};
}

const text = (value: unknown, max = 200) => (typeof value === 'string' ? value.slice(0, max) : '');
const STATES: readonly string[] = ['playing', 'paused', 'idle', 'off', 'on', 'buffering', 'standby'];

export function playerModel(entity: HassEntityState): PlayerModel {
  const a = entity.attributes;
  const features = typeof a.supported_features === 'number' ? a.supported_features : 0;
  const available = !UNAVAILABLE.has(entity.state);
  const volume = typeof a.volume_level === 'number' && a.volume_level >= 0 && a.volume_level <= 1 ? a.volume_level : null;
  const picture = text(a.entity_picture, 2000);
  return {
    entityId: entity.entity_id,
    name: text(a.friendly_name, 120) || entity.entity_id,
    state: (STATES.includes(entity.state) ? entity.state : 'unavailable') as PlayState,
    available,
    title: text(a.media_title),
    artist: text(a.media_artist),
    album: text(a.media_album_name),
    // HA's own proxy path (same origin as the panel) or an absolute URL from the integration.
    artwork: /^(?:\/api\/|https:\/\/)/.test(picture) ? picture : null,
    volume,
    can: {
      play: available && (features & FEATURE.play) !== 0,
      pause: available && (features & FEATURE.pause) !== 0,
      next: available && (features & FEATURE.next) !== 0,
      previous: available && (features & FEATURE.previous) !== 0,
      volume: available && (features & FEATURE.volumeSet) !== 0 && volume !== null,
    },
  };
}

// The player a room shows: the one playing, else one paused, else the first that is available, else the first.
export function roomPlayer(players: (HassEntityState | null)[]): HassEntityState | null {
  const known = players.filter((p): p is HassEntityState => !!p);
  return (
    known.find(p => p.state === 'playing') ??
    known.find(p => p.state === 'paused') ??
    known.find(p => !UNAVAILABLE.has(p.state)) ??
    known[0] ??
    null
  );
}

export const playKey = (entityId: string) => `${entityId}:play`;
export const skipKey = (entityId: string) => `${entityId}:skip`;
export const volumeKey = (entityId: string) => `${entityId}:volume`;

const trackOf = (entity: HassEntityState | null) =>
  JSON.stringify([entity?.attributes.media_content_id, entity?.attributes.media_title, entity?.attributes.media_artist]);

// HA's default volume step (MediaPlayerEntity.volume_step) when the speaker does not report its own.
const DEFAULT_VOLUME_STEP = 0.02;

export function volumeTolerance(entity: HassEntityState | null): number {
  const step = entity?.attributes.volume_step;
  const known = typeof step === 'number' && step > 0 && step <= 0.5 ? step : DEFAULT_VOLUME_STEP;
  return known / 2 + 0.001;
}

export function mediaCommands(store: CommandStore = appCommands) {
  return {
    // Every tap is one action (toggle is not idempotent); the wish is what the tap asked for.
    playPause(entityId: string, wantPlaying: boolean) {
      const wish = wantPlaying ? 'playing' : 'paused';
      store.send({
        key: playKey(entityId),
        entityId,
        value: wish,
        confirm: entity => entity?.state === wish,
        observed: () => store.source.read(entityId),
        call: () => callService({domain: 'media_player', service: wantPlaying ? 'media_play' : 'media_pause', entityId}, store.source),
      });
    },
    // Proof is a track other than the one shown at the tap, seen once HA answered the call (commands.ts): a song that
    // ends by itself while the call is refused or lost never reads as this skip.
    skip(entityId: string, direction: 'next' | 'previous') {
      const before = trackOf(store.source.read(entityId));
      store.send({
        key: skipKey(entityId),
        entityId,
        value: direction,
        confirm: entity => trackOf(entity) !== before,
        call: () =>
          callService({
            domain: 'media_player',
            service: direction === 'next' ? 'media_next_track' : 'media_previous_track',
            entityId,
          }, store.source),
      });
    },
    // Absolute: the latest wish wins; an earlier call's answer no longer counts. A speaker reports its volume in its
    // own steps (volume_step, e.g. 1/16): anything within half a step of the wish is the wish.
    // SEAM(podconnect): PodVoice's room permissions and volume cap are not applied here. They belong in PodConnect
    // (BixelVentures/podconnect), which owns the speakers and must refuse a level above the room's cap for every
    // caller; the panel only shows PodConnect's answer. Never re-create the cap in the page.
    volume(entityId: string, level: number) {
      const value = Math.round(Math.min(1, Math.max(0, level)) * 100) / 100;
      const tolerance = volumeTolerance(store.source.read(entityId));
      store.send({
        key: volumeKey(entityId),
        entityId,
        value,
        confirm: entity => {
          const seen = entity?.attributes.volume_level;
          return typeof seen === 'number' && Math.abs(seen - value) <= tolerance;
        },
        observed: () => store.source.read(entityId),
        call: () => callService({domain: 'media_player', service: 'volume_set', entityId, data: {volume_level: value}}, store.source),
      });
    },
  };
}

export const media = mediaCommands();

// The last track HA reported per player (2.1.33's last-known rule): while HA briefly has no state for a player (a
// restart, the page waking), the player shows what last played there, marked as last known, never as current.
// HA tears a hidden panel's iframe down after five minutes, so the page cold-starts often: these few models are the
// one thing kept across that (localStorage, per player, only when the track changes).
export const lastKnownPlayers = create<{models: Record<string, PlayerModel | undefined>}>(() => ({models: {}}));

export const LAST_KNOWN_KEY = 'podview-panel:last-known-players';

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function restore() {
  try {
    const saved: unknown = JSON.parse(storage()?.getItem(LAST_KNOWN_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return;
    const models: Record<string, PlayerModel> = {};
    for (const [entityId, model] of Object.entries(saved as Record<string, unknown>).slice(0, 32)) {
      const item = model as Partial<PlayerModel> | null;
      if (item && typeof item.title === 'string' && typeof item.name === 'string' && item.entityId === entityId)
        models[entityId] = item as PlayerModel;
    }
    lastKnownPlayers.setState(state => ({models: {...models, ...state.models}}));
  } catch {
    // Nothing kept, or unreadable: the page starts without last known tracks.
  }
}

const sameTrack = (a: PlayerModel | undefined, b: PlayerModel) =>
  a?.title === b.title && a.artist === b.artist && a.artwork === b.artwork && a.name === b.name;

export function installLastKnown(source: HaTransport = appTransport): () => void {
  restore();
  return source.onEntity((entity, entityId) => {
    if (!entityId.startsWith('media_player.') || !entity) return;
    const model = playerModel(entity);
    if (!model.available || !model.title) return;
    // Only a new track (or player name) is a change: a position or volume update writes nothing.
    if (sameTrack(lastKnownPlayers.getState().models[entityId], model)) return;
    lastKnownPlayers.setState(state => ({models: {...state.models, [entityId]: model}}));
    try {
      storage()?.setItem(LAST_KNOWN_KEY, JSON.stringify(lastKnownPlayers.getState().models));
    } catch {
      // Full or blocked storage: the page simply keeps them in memory.
    }
  });
}
