// The player's view models (from the pre-React player-view.js): what the local preview and the live room player
// show, the local controls and the queue rows. Plain JS: the shell, the live media view and the tests read them.
import {TRACKS, LOCAL_POSITION_EXAMPLE} from './widget-model.js';
import {fixtureArtwork} from './music-results.js';
import {roomObservationDisplay, playbackObservationCurrent} from './media-observation.js';

export const PLAYER_SPEAKER_IDLE_MS = 10 * 60 * 1000;
export const txt = value => typeof value === 'string' ? value : '';
// Another Spotify login plays in the room; PodConnect gives no name and we never invent one (H10).
export const OTHER_ACCOUNT = 'En anden Spotify-konto spiller her';
const fixtureArt = art => fixtureArtwork(art?.startsWith('https:') ? art : `assets/${art}`);
const playerPreview = state =>
  state.playerPreview === 'empty' && state.music.playback.active ? null : state.playerPreview;

export function localPlayerModel(state) {
  const m = state.music, t = (m.previewTracks || TRACKS)[m.playback.track];
  const base = {
    active: m.playback.active, playing: m.playback.playing, fresh: state.connected, title: t.title, artist: t.artist,
    target: m.playback.room, configuredTarget: m.playback.room, fixtureArt: fixtureArt(t.art),
    canOutput: state.connected, canDiscover: state.connected, volume: m.playback.volume, examplePosition: true,
    trackId: t.id, seekOperation: m.operation, progressMs: m.playback.progressMs ?? LOCAL_POSITION_EXAMPLE.progressMs,
    durationMs: LOCAL_POSITION_EXAMPLE.durationMs, positionFresh: state.connected,
    canSeek: m.playback.active && state.connected && !m.pending && !playerPreview(state),
  };
  const preview = playerPreview(state);
  if (!preview && m.pending?.id && Number.isInteger(m.pending.track)) {
    const chosen = (m.previewTracks || TRACKS)[m.pending.track];
    if (chosen) return {
      ...base, active: true, playing: false, fresh: false, loading: true, title: chosen.title, artist: chosen.artist,
      fixtureArt: fixtureArt(chosen.art), target: m.pending.room, trackId: chosen.id, progressMs: null,
      durationMs: null, positionFresh: false, canSeek: false, canOutput: false,
      feedback: {message: 'Starter afspilning…', pending: true},
    };
  }
  if (!preview) return base;
  if (preview === 'missing-art') return {...base, active: true, fixtureArt: null, uri: t.uri, artwork: null};
  if (preview === 'offline') return {...base, active: true, fresh: false, canOutput: false, canDiscover: false};
  return {
    ...base, active: false, loading: preview === 'loading',
    emptyState: preview === 'error' ? 'error' : preview === 'loading' ? 'loading' : 'empty',
    canOutput: preview === 'empty' && state.connected,
    empty: preview === 'loading' ? '' : preview === 'error' ? 'Afspilningen kunne ikke hentes.'
      : 'Vælg en stemning eller sang.',
  };
}

export function localControlModel(state) {
  const m = state.music, preview = playerPreview(state);
  return {
    playing: m.playback.playing, previous: !preview, next: !preview, toggle: !preview,
    blocked: !state.connected || !!preview || !!m.pending, volume: preview ? null : m.playback.volume,
    canVolume: !preview && !m.pending,
  };
}

// The room player is the room's own media_player: what it shows always plays in this room.
export function livePlayerModel(playback, connected, status, snapshot, configuredTarget = '', actualTargetLabel = '') {
  const shown = roomObservationDisplay(playback, snapshot), current = playbackObservationCurrent(playback, snapshot);
  const item = shown ? playback.item : null, away = shown && playback.elsewhere === true;
  const other = shown && !away && playback.otherAccount === true;
  const read = snapshot?.capabilities?.musicRead;
  return {
    configuredTarget,
    readOnly: away || other,
    placement: away ? 'elsewhere' : other ? 'other-account' : 'room',
    canSeek: false,
    emptyState: status === 'loading' ? 'loading' : !connected ? 'offline' : status === 'error' ? 'error'
      : status === 'account-selection' ? 'account-selection' : 'unconfirmed',
    loading: status === 'loading',
    active: shown,
    playing: shown && playback.state === 'playing',
    fresh: current && !!connected,
    positionAnchor: shown ? {
      key: JSON.stringify([snapshot.bootId, snapshot.roomId, playback.config_entry_id, item?.uri ?? null,
        item?.name ?? null]),
      observedAt: Date.parse(playback.observedAt),
      expiresAt: playback.expiresAt,
    } : null,
    progressMs: shown ? playback.progressMs : null,
    durationMs: shown ? item?.duration_ms : null,
    positionFresh: current && !!connected && status !== 'error',
    title: shown ? (item?.name || 'Musik') : '',
    metadataKnown: !!(shown && typeof item?.name === 'string' && item.name.trim()),
    artist: shown ? (item?.artists.join(', ') || '') : '',
    target: !shown ? '' : away ? txt(playback.target?.name)
      : (txt(actualTargetLabel) || txt(configuredTarget) || 'Højttaleren i rummet'),
    uri: shown ? item?.uri ?? undefined : undefined,
    artwork: shown ? item?.artwork : undefined,
    artworkUrl: shown ? item?.artworkUrl ?? null : null,
    canOutput: !other && !!connected && read?.includes('targets') === true,
    canDiscover: !!connected && Array.isArray(read)
      && read.some(kind => ['mood', 'feeling', 'top', 'recent', 'search', 'account_playlists'].includes(kind)),
    volume: null,
    empty: status === 'loading' ? '' : status === 'error' ? 'Afspilningen kunne ikke hentes.'
      : status === 'account-selection' ? 'Vælg en musikkonto.' : !connected ? 'Forbindelsen mangler.'
        : 'Vælg en stemning eller sang.',
  };
}

export function localQueueModel(state) {
  if (playerPreview(state) || state.queuePreview && !['loading', 'refresh'].includes(state.queuePreview)) return [];
  const m = state.music, playing = m.playback.track, length = TRACKS.length;
  return (m.previewTracks || TRACKS).map((track, index) => ({
    id: track.id, title: track.title, artist: track.artist, fixtureArt: fixtureArt(track.art),
    order: m.queueOrder
      ? (m.queueOrder.indexOf(track.id) - m.queueOrder.indexOf(TRACKS[playing].id) + length) % length
      : (index - playing + length) % length,
    reorderable: state.connected && !m.pending && index !== playing, revision: m.revision,
    current: index === playing && m.playback.active,
    playing: index === playing && m.playback.active && m.playback.playing,
    selectable: state.connected && index !== playing,
  })).filter(row => state.queuePreview !== 'loading' || row.current).sort((a, b) => a.order - b.order);
}

// An occurrence/snapshot identity is an observation, never a play grant.
export function liveQueueModel(queue) {
  return (queue?.items || []).map((item, index) => ({
    id: item.id, title: item.name, artist: item.artists.join(', '), uri: item.uri, artwork: item.artwork,
    order: index + 1, selectable: false,
  }));
}

// The shared player's source focus when nothing was chosen explicitly: the observed room decides.
export const autoSourceFocus = scope => Object.freeze({scope, kind: 'auto', target: null});
