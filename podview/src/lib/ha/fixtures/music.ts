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
  {id: 'p1', name: 'P1'},
  {id: 'p3', name: 'P3'},
  {id: 'p4-ostjylland', name: 'P4 Østjylland'},
  {id: 'p6-beat', name: 'P6 Beat'},
  {id: 'p8-jazz', name: 'P8 Jazz'},
];

// PodConnect's own room rules as podvoice.speaker_rooms answers them; empty = PodConnect places no speaker, so HA's
// areas decide. Tests set it before mounting.
export const fakeSpeakerRooms: {speakers: {entity_id: string; area_id: string; area_name: string}[]} = {speakers: []};

// Find musik (podvoice.music_search, music_activities, music_picks). `addon` is what the PodVoice add-on answers for
// »AI-valgt«; tests set it before mounting. Every read is recorded in fake.calls like any service.
export const fakeFindMusic: {addon: 'up' | 'down' | 'ai_unavailable'; rateLimited: boolean} = {
  addon: 'up', rateLimited: false,
};

const playlistUri = (index: number) => `spotify:playlist:${String(index).padStart(22, 'P')}`;
const cover = (index: number) => `https://i.scdn.co/image/fake${String(index)}`;

// The activities' fixed playlist searches (custom_components/podvoice/find_music.py ACTIVITIES).
export const FAKE_ACTIVITY_QUERIES: Record<string, string> = {
  cooking: 'cooking', focus: 'focus instrumental', hygge: 'hygge', party: 'festmusik', sleep: 'sleep calm',
  workout: 'workout',
};
// The wall's last activities as podvoice.music_activities keeps them (newest first, at most four).
export const fakeActivityHistory: {activity: string; at: string}[] = [];

// Playlists the fake Spotify search finds: three per query.
export const FAKE_PLAYLISTS = [
  'Rainy Jazz', 'Cozy Acoustic', 'Evening Chill', 'Bon Iver Radio', 'Indie Folk', 'Juletid', 'Dinner Jazz',
  'Jazz Classics', 'Lounge Café',
].map((name, index) => ({name, uri: playlistUri(index + 1), artwork: cover(index + 1)}));

function installFindMusicFake(fake: FakeHass, answer: (response: Record<string, unknown>) => unknown): void {
  const playlist = (row: (typeof FAKE_PLAYLISTS)[number]) =>
    ({kind: 'playlist', uri: row.uri, name: row.name, byline: null, artwork: row.artwork});
  const playlistsFor = (query: string) => {
    const start = Array.from(query, char => char.codePointAt(0) ?? 0).reduce((a, b) => a + b, 0)
      % (FAKE_PLAYLISTS.length - 2);
    return FAKE_PLAYLISTS.slice(start, start + 3).map(playlist);
  };
  fake.handle('podvoice.music_activities', data => {
    const used = typeof data.used === 'string' && data.used in FAKE_ACTIVITY_QUERIES ? data.used : null;
    if (used) {
      const kept = fakeActivityHistory.filter(row => row.activity !== used);
      fakeActivityHistory.splice(0, fakeActivityHistory.length, {activity: used, at: new Date().toISOString()},
        ...kept.slice(0, 3));
    }
    return answer({ok: true, history: fakeActivityHistory.map(row => ({...row}))});
  });
  fake.handle('podvoice.music_search', data => {
    const activity = typeof data.activity === 'string' ? data.activity : null;
    const query = activity ? (FAKE_ACTIVITY_QUERIES[activity] ?? '') : typeof data.query === 'string' ? data.query : '';
    const kind = activity || data.kind === 'playlist' ? 'playlist' : 'track';
    const base = {kind, query, ...(activity ? {activity} : {})};
    if (fakeFindMusic.rateLimited) return answer({ok: false, error: 'rate_limited', ...base, items: []});
    if (kind === 'playlist') return answer({ok: true, ...base, items: playlistsFor(query)});
    const needle = query.toLocaleLowerCase('da');
    const items = FAKE_TRACKS.filter(row => `${row.title} ${row.artist}`.toLocaleLowerCase('da').includes(needle))
      .slice(0, 10)
      .map((row, index) => ({kind: 'track', uri: row.uri, name: row.title, byline: row.artist, artwork: cover(index)}));
    return answer({ok: true, ...base, items});
  });
  fake.handle('podvoice.music_picks', () => {
    if (fakeFindMusic.addon === 'down') return answer({ok: false, error: 'addon_unavailable', shelves: []});
    if (fakeFindMusic.addon === 'ai_unavailable') return answer({ok: false, error: 'ai_unavailable', shelves: []});
    return answer({ok: true, shelves: [
      {id: 'ai_moment', title: 'Regnvejr og torsdag aften', why: 'Fordi det regner og det er torsdag aften.',
        items: FAKE_PLAYLISTS.slice(0, 3).map(playlist)},
      {id: 'ai_artist', title: 'Fordi I hører Bon Iver', why: 'Fordi I hører meget Bon Iver.',
        items: FAKE_PLAYLISTS.slice(3, 5).map(playlist)},
      {id: 'ai_season', title: 'Op mod jul', why: 'Fordi der er 35 dage til jul.',
        items: FAKE_PLAYLISTS.slice(5, 6).map(playlist)},
    ]});
  });
}

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
  const queues = new Map<string, {title: string; tracks: typeof FAKE_TRACKS}>();

  fake.handle('podvoice.music_queue', data => {
    const room = state(data.entity_id);
    const empty = (status: string) => answer({ok: true, status, items: [], selectable: false});
    if (!room || !['playing', 'paused'].includes(room.state) || !room.attributes.media_title) return empty('idle');
    if (room.attributes.podconnect_account === 'other') return empty('other_account');
    if (room.attributes.podconnect_source === 'radio') return empty('radio');
    // Like PodConnect: after a row was played, what follows it is the queue (the rows above it have left).
    const kept = queues.get(String(data.entity_id));
    const rest = kept?.title === room.attributes.media_title ? kept.tracks
      : FAKE_TRACKS.filter(track => track.title !== room.attributes.media_title);
    const items = rest.map((track, index) => ({
      id: track.id, title: track.title, artist: track.artist, artwork: null, uri: track.uri, order: index + 1}));
    return answer({ok: true, status: items.length ? 'ready' : 'empty', items, selectable: true});
  });

  fake.handle('podvoice.music_queue_play', data => {
    const track = FAKE_TRACKS.find(row => row.id === data.option_id && row.uri === data.uri);
    const entityId = data.entity_id;
    if (!track || typeof entityId !== 'string')
      return answer({ok: false, outcome: 'rejected', reason: 'queue_changed'});
    const shown = queues.get(entityId)?.tracks ?? FAKE_TRACKS.filter(row =>
      row.title !== state(entityId)?.attributes.media_title);
    queues.set(entityId, {title: track.title, tracks: shown.slice(shown.indexOf(track) + 1)});
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
    // A playlist starts with its first track, as PodConnect reports it.
    const playlist = FAKE_PLAYLISTS.some(row => row.uri === data.media_content_id);
    const track = playlist ? FAKE_TRACKS[0] : FAKE_TRACKS.find(row => row.uri === data.media_content_id);
    if (entityId && track) {
      later(() => {
        play(entityId, track);
      });
    }
    return {context: {id: 'play-media'}};
  });

  const tracks = FAKE_TRACKS.map(track => ({name: track.title, artist: track.artist, uri: track.uri}));
  fake.handle('podvoice.music_shelf', data =>
    answer({ok: true, tracks: data.shelf === 'recently_played' ? [...tracks].reverse() : tracks}));
  installFindMusicFake(fake, answer);
  fake.handle('podvoice.speaker_rooms', () =>
    answer({ok: true, speakers: fakeSpeakerRooms.speakers, errors: []}));

  const radioState = () => {
    const playing = radio.state === 'playing';
    return {
      ok: true, available: true, enabled: true, blocked: [], state: radio.state, station_id: radio.station,
      target_id: radio.target, source_kind: playing ? 'radio' : 'none', volume_percent: null,
      actions: playing ? ['start', 'stop', 'move'] : ['start'], stations: FAKE_STATIONS,
      targets: ROOMS.map((room, index) => ({id: room.id, name: room.name, available: true, selectable: true,
        default: index === 0, entity_id: room.entity_id})),
    };
  };
  fake.handle('podvoice.radio_state', () => answer(radioState()));
  // The integration's push (radio_live.py): the state at once, and again after each command's effect.
  fake.subscribers.set('podvoice/radio_subscribe', radioState);
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
        fake.pushAll('podvoice/radio_subscribe');
      });
      return answer({ok: true, outcome: 'accepted'});
    }
    if (data.action === 'stop') {
      if (radio.state !== 'playing') return answer({ok: false, outcome: 'rejected', reason: 'not_playing'});
      later(() => {
        radio.state = 'stopped';
        if (current) fake.patch(current.entity_id, 'idle', cleared);
        fake.pushAll('podvoice/radio_subscribe');
      });
      return answer({ok: true, outcome: 'accepted'});
    }
    return answer({ok: false, outcome: 'rejected', reason: 'not_offered'});
  });
}
