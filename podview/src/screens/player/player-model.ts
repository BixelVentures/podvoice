// The live player's view models: what the room player shows (livePlayerModel) and its queue rows (liveQueueModel).
// The room player is the room's own media_player: what it shows always plays in this room.
import {playbackObservationCurrent, roomObservationDisplay} from '../../lib/api/media';
import type {MediaItem, Playback} from '../../lib/api/media';
import type {PlayerModel, QueueItem, SourceFocus} from './types';

export const PLAYER_SPEAKER_IDLE_MS = 10 * 60 * 1000;
export const txt = (value: unknown): string => typeof value === 'string' ? value : '';
// Another Spotify login plays in the room; PodConnect gives no name and we never invent one (H10).
export const OTHER_ACCOUNT = 'En anden Spotify-konto spiller her';
const DISCOVERY_READS = ['mood', 'feeling', 'top', 'recent', 'search', 'account_playlists'];

interface PlayerSnapshot {
  bootId?: unknown;
  roomId?: unknown;
  capabilities?: unknown;
}

export function livePlayerModel(playback: Playback | null | undefined, connected: boolean, status: string,
  snapshot: PlayerSnapshot | null | undefined, configuredTarget = '', actualTargetLabel = ''): PlayerModel {
  const shown = roomObservationDisplay(playback, snapshot), current = playbackObservationCurrent(playback, snapshot);
  const p = shown ? playback : null, item = p?.item ?? null, away = !!p && p.elsewhere === true;
  const other = !!p && !away && p.otherAccount === true;
  const read = (snapshot?.capabilities as {musicRead?: unknown} | undefined)?.musicRead;
  const reads = Array.isArray(read) ? read as unknown[] : null;
  return {
    configuredTarget,
    readOnly: away || other,
    placement: away ? 'elsewhere' : other ? 'other-account' : 'room',
    canSeek: false,
    emptyState: status === 'loading' ? 'loading' : !connected ? 'offline' : status === 'error' ? 'error'
      : status === 'account-selection' ? 'account-selection' : 'unconfirmed',
    loading: status === 'loading',
    active: shown,
    playing: !!p && p.state === 'playing',
    fresh: current && connected,
    positionAnchor: p ? {
      key: JSON.stringify([snapshot?.bootId, snapshot?.roomId, p.config_entry_id, item?.uri ?? null,
        item?.name ?? null]),
      observedAt: Date.parse(p.observedAt),
      expiresAt: p.expiresAt,
    } : null,
    progressMs: p ? p.progressMs : null,
    durationMs: p ? item?.duration_ms : null,
    positionFresh: current && connected && status !== 'error',
    title: p ? (item?.name || 'Musik') : '',
    metadataKnown: !!(p && typeof item?.name === 'string' && item.name.trim()),
    artist: p ? (item?.artists.join(', ') || '') : '',
    target: !p ? '' : away ? txt(p.target?.name)
      : (txt(actualTargetLabel) || txt(configuredTarget) || 'Højttaleren i rummet'),
    uri: p ? item?.uri ?? undefined : undefined,
    artwork: p ? item?.artwork : undefined,
    artworkUrl: p ? item?.artworkUrl ?? null : null,
    canOutput: !other && connected && reads?.includes('targets') === true,
    canDiscover: connected && !!reads?.some(kind => DISCOVERY_READS.includes(kind as string)),
    volume: null,
    empty: status === 'loading' ? '' : status === 'error' ? 'Afspilningen kunne ikke hentes.'
      : status === 'account-selection' ? 'Vælg en musikkonto.' : !connected ? 'Forbindelsen mangler.'
        : 'Vælg en stemning eller sang.',
  };
}

// An occurrence/snapshot identity is an observation, never a play grant.
export function liveQueueModel(queue: {items?: (MediaItem & {id: string})[]} | null | undefined): QueueItem[] {
  return (queue?.items ?? []).map((item, index) => ({
    id: item.id, title: item.name, artist: item.artists.join(', '), uri: item.uri ?? undefined, artwork: item.artwork,
    order: index + 1, selectable: false,
  }));
}

// The shared player's source focus when nothing was chosen explicitly: the observed room decides.
export const autoSourceFocus = (scope: string | null): SourceFocus =>
  Object.freeze({scope, kind: 'auto', target: null});
