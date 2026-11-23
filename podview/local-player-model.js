// The local preview's player (the shell's demo scene): what it shows, its controls and its queue rows. The live
// player's models are src/screens/player/player-model.ts.
import {TRACKS, LOCAL_POSITION_EXAMPLE} from './widget-model.js';
import {fixtureArtwork} from './src/lib/api/artwork.ts';

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

