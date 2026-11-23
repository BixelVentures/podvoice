// Fake music services for tests and the browser journey: the PodVoice music bridge (queue, room move, radio), HA's
// media_player.play_media on a PodConnect room, and PodConnect's library reads for Find musik. Each answers like
// the real service and then changes the rooms' media_players the way PodConnect would, after a short delay.
import type {FakeHass} from '../ha-fixture';

const DELAY_MS = 60;
const uri = (index: number) => `spotify:track:${String(index).padStart(22, '0')}`;
const option = (index: number) => `${'a'.repeat(22)}${String(index).padStart(2, '0')}`;

// The catalogue every fake read draws from (title, artist).
export const FAKE_TRACKS = [
  {title: 'Re: Stacks', artist: 'Bon Iver'},
  {title: 'Skinny Love', artist: 'Bon Iver'},
  {title: 'Flume', artist: 'Bon Iver'},
  {title: 'Hey, Ma', artist: 'Bon Iver'},
  {title: 'Holocene', artist: 'Bon Iver'},
].map((track, index) => ({...track, uri: uri(index + 1), id: option(index + 1)}));

export const FAKE_STATIONS = [
  {id: 'p3', name: 'P3'},
  {id: 'p1', name: 'P1'},
  {id: 'p4-ostjylland', name: 'P4 Østjylland'},
  {id: 'p6-beat', name: 'P6 Beat'},
  {id: 'p8-jazz', name: 'P8 Jazz'},
];

const ROOMS = [
  {id: 'kitchen', name: 'Køkkenalrum', entity_id: 'media_player.kokkenalrum'},
  {id: 'living', name: 'Stue', entity_id: 'media_player.stue'},
];

const MEDIA_KEYS = ['media_title', 'media_artist', 'media_content_id', 'podconnect_source', 'entity_picture'] as const;
const cleared = Object.fromEntries(MEDIA_KEYS.map(key => [key, undefined]));

export function installMusicFake(fake: FakeHass): void {
  const radio = {state: 'idle', station: null as string | null, target: null as string | null};
  const later = (effect: () => void) => {
    if (fake.mode !== 'silent') setTimeout(effect, DELAY_MS);
  };
  const state = (entityId: unknown) => (typeof entityId === 'string' ? fake.hass.states[entityId] : undefined);
  const play = (entityId: string, track: {title: string; artist: string; uri: string}) => {
    fake.patch(entityId, 'playing', {media_title: track.title, media_artist: track.artist,
      media_content_id: track.uri, podconnect_source: 'spotify'});
  };
  const answer = (response: Record<string, unknown>) => ({response});

  fake.handle('podvoice.music_queue', data => {
    const room = state(data.entity_id);
    const empty = (status: string) => answer({ok: true, status, items: [], selectable: false});
    if (!room || !['playing', 'paused'].includes(room.state) || !room.attributes.media_title) return empty('idle');
    if (room.attributes.podconnect_account === 'other') return empty('other_account');
    if (room.attributes.podconnect_source === 'radio') return empty('radio');
    const items = FAKE_TRACKS.filter(track => track.title !== room.attributes.media_title).map((track, index) => ({
      id: track.id, title: track.title, artist: track.artist, artwork: null, uri: track.uri, order: index + 1}));
    return answer({ok: true, status: items.length ? 'ready' : 'empty', items, selectable: true});
  });

  fake.handle('podvoice.music_queue_play', data => {
    const track = FAKE_TRACKS.find(row => row.id === data.option_id && row.uri === data.uri);
    const entityId = data.entity_id;
    if (!track || typeof entityId !== 'string')
      return answer({ok: false, outcome: 'rejected', reason: 'queue_changed'});
    later(() => {
      play(entityId, track);
    });
    return answer({ok: true, outcome: 'accepted'});
  });

  fake.handle('podvoice.music_move', data => {
    const source = data.entity_id, target = data.target_entity_id;
    const from = state(source);
    if (!from || !state(target) || typeof source !== 'string' || typeof target !== 'string')
      return answer({ok: false, outcome: 'rejected', reason: 'not_podconnect'});
    if (from.attributes.podconnect_account === 'other')
      return answer({ok: false, outcome: 'rejected', reason: 'other_account'});
    later(() => {
      const moved = Object.fromEntries(MEDIA_KEYS.map(key => [key, from.attributes[key]]));
      fake.patch(target, from.state, {...moved, podconnect_source: from.attributes.podconnect_source ?? 'spotify'});
      fake.patch(source, 'idle', cleared);
    });
    return answer({ok: true, outcome: 'accepted'});
  });

  fake.handle('media_player.play_media', (data, entityId) => {
    const track = FAKE_TRACKS.find(row => row.uri === data.media_content_id);
    if (entityId && track) {
      later(() => {
        play(entityId, track);
      });
    }
    return {context: {id: 'play-media'}};
  });

  const tracks = FAKE_TRACKS.map(track => ({name: track.title, artist: track.artist, uri: track.uri}));
  fake.handle('podconnect.top_tracks', () => answer({config_entry_id: 'fake-account', tracks}));
  fake.handle('podconnect.recently_played', () =>
    answer({config_entry_id: 'fake-account', tracks: [...tracks].reverse()}));

  fake.handle('podvoice.radio_state', () => {
    const playing = radio.state === 'playing';
    return answer({
      ok: true, available: true, enabled: true, blocked: [], state: radio.state, station_id: radio.station,
      target_id: radio.target, source_kind: playing ? 'radio' : 'none', volume_percent: null,
      actions: playing ? ['start', 'stop', 'move'] : ['start'], stations: FAKE_STATIONS,
      targets: ROOMS.map((room, index) => ({id: room.id, name: room.name, available: true, selectable: true,
        default: index === 0, entity_id: room.entity_id})),
    });
  });
  fake.handle('podvoice.radio_command', data => {
    const room = ROOMS.find(row => row.id === data.target_id);
    const current = ROOMS.find(row => row.id === radio.target);
    if (data.action === 'start' || data.action === 'move') {
      if (!room) return answer({ok: false, outcome: 'rejected', reason: 'destination'});
      const station = data.action === 'start' ? String(data.station_id) : radio.station;
      later(() => {
        if (current && current !== room) fake.patch(current.entity_id, 'idle', cleared);
        Object.assign(radio, {state: 'playing', station, target: room.id});
        fake.patch(room.entity_id, 'playing', {...cleared, podconnect_source: 'radio', media_title: 'Radio'});
      });
      return answer({ok: true, outcome: 'accepted'});
    }
    if (data.action === 'stop') {
      if (radio.state !== 'playing') return answer({ok: false, outcome: 'rejected', reason: 'not_playing'});
      later(() => {
        radio.state = 'stopped';
        if (current) fake.patch(current.entity_id, 'idle', cleared);
      });
      return answer({ok: true, outcome: 'accepted'});
    }
    return answer({ok: false, outcome: 'rejected', reason: 'not_offered'});
  });
}
