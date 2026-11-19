// Inert Find musik fixtures for the Vitest suites: a podview.music_shelves.v1 body as PodVoice serves it (same
// rows as tests/music_shelves_fixture.py) and a live host with the real start flow (LiveMusicSelectionView) and a
// recording transport. Nothing here plays sound or reaches Spotify/HA.
import {LiveMusicSelectionView} from '../../../live-music-selection-view.js';
import {bindRoom} from '../../../../tests/podview/room-fixture.mjs';
import {MusicShelvesView} from './MusicShelvesView';

export const id = (prefix, index) => `${prefix}${index}`.padEnd(22, 'x').slice(0, 22);
const art = key => `https://i.scdn.co/image/${key}`;

export const ITEMS = [
  {uri: `spotify:album:${id('al', 0)}`, kind: 'album', name: 'Kind of Blue', byline: 'Miles Davis',
    artwork: art('recent0'), lastPlayedAt: '2026-11-18T17:10:00Z'},
  {uri: `spotify:playlist:${id('rainyday', 0)}`, kind: 'playlist', name: 'Rainy Day Jazz 1',
    artwork: 'https://image-cdn-fa.spotifycdn.com/image/rainy0'},
  {uri: `spotify:playlist:${id('rp', 1)}`, kind: 'playlist', name: 'Søndagsmorgen', artwork: art('recent1'),
    lastPlayedAt: '2026-11-15T09:00:00Z'},
  {uri: `spotify:show:${id('sh', 0)}`, kind: 'show', name: 'Radiofortællinger', artwork: art('recent2'),
    lastPlayedAt: '2026-11-19T07:00:00Z'},
  {uri: `spotify:artist:${id('ar', 0)}`, kind: 'artist', name: 'Nina Simone', artwork: art('artist0')},
  {uri: `spotify:playlist:${id('afternoon', 0)}`, kind: 'playlist', name: 'Afternoon Focus 1'},
  {uri: `spotify:artist:${id('ar', 1)}`, kind: 'artist', name: 'Bill Evans', artwork: art('artist1')},
  {uri: `spotify:playlist:${id('soul', 0)}`, kind: 'playlist', name: 'Soul Classics 1', artwork: art('soul0')},
  {uri: `spotify:album:${id('al', 1)}`, kind: 'album', name: 'Blue', byline: 'Joni Mitchell', artwork: art('album1')},
  {uri: `spotify:playlist:${id('xmas', 0)}`, kind: 'playlist', name: 'Quiet Christmas 1', artwork: art('xmas0')},
  {uri: `spotify:show:${id('sh', 1)}`, kind: 'show', name: 'Det Røde Rum', artwork: art('show1')},
];

export function shelvesBody({bootId = 'boot', roomId = 'room', account = 'account', candidate = true,
  setId = 'a'.repeat(64), refreshing = false} = {}) {
  const body = {
    ok: true, schema: 'podview.music_shelves.v1', bootId, roomId, configEntryId: account, ownerEpoch: 'e'.repeat(32),
    refreshing, items: ITEMS.map(row => ({...row})),
    quick: [{item: 0}, {item: 1, ai: 'regn'}, {item: 2}, {item: 3}, {item: 4}, {item: 5, ai: 'eftermiddag'}],
    shelves: [
      {id: 'ai_moment', title: 'Til en regnvejrs-torsdag', ai: true,
        why: 'Fordi det regner og det er torsdag eftermiddag.', shape: 'square', items: [1]},
      {id: 'artists', title: 'Jeres kunstnere', ai: false, why: 'Det, I spiller mest', shape: 'round', items: [4, 6]},
      {id: 'ai_artist', title: 'Fordi I hører Nina Simone', ai: true, why: 'Fordi I hører meget Nina Simone.',
        shape: 'square', items: [7]},
      {id: 'recent', title: 'Fortsæt med at lytte', ai: false, why: null, shape: 'square', items: [0, 2, 3, 4]},
      {id: 'ai_daypart', title: 'Til eftermiddagen', ai: true, why: 'Fordi det er eftermiddag.', shape: 'square',
        items: [5]},
      {id: 'albums', title: 'Gemte album', ai: false, why: null, shape: 'square', items: [0, 8]},
      {id: 'ai_season', title: 'Op mod jul', ai: true, why: 'Fordi der er 35 dage til jul.', shape: 'square',
        items: [9]},
      {id: 'podcasts', title: 'Podcasts', ai: false, why: 'Dem, I har gemt', shape: 'square', items: [3, 10]},
    ],
  };
  if (candidate) {
    body.candidateSet = {schema: 'podview.music-search-context.v1', bootId, roomId, configEntryId: account,
      source: 'spotify_web_api', query: 'shelves:collection', sourceKind: 'shelves', candidateSetId: setId,
      revisionScope: 'music_selection', sessionId: 'touch:session', turnId: 'touch:turn', taskId: 'touch:task',
      inputRevision: 1, revision: 1,
      items: ITEMS.map((_row, index) => ({id: String(index).padStart(24, setId[0]), index}))};
  }
  return body;
}

// A paired live screen in the room: the real start flow behind a recording, inert transport.
export function liveFixture({body = shelvesBody(), selection = true, setup = null, action = null} = {}) {
  const root = document.createElement('div');
  root.innerHTML = '<article id="music-response"><div id="find-musik"></div></article>';
  document.body.append(root);
  const snapshot = {bootId: 'boot', roomId: 'room', answers: {}, voice: {},
    capabilities: {musicRead: ['shelves', 'targets', 'playback'], musicSelection: selection}};
  bindRoom(snapshot);
  const reads = [], setups = [], sent = [];
  const target = {accountId: 'account', kind: 'spotify_device', targetId: 'device', name: 'Stuen'};
  let current = body;
  const transport = {
    connected: true, generation: 1, recordDiagnostic() {},
    async musicShelves(account) {
      reads.push(account);
      return typeof current === 'function' ? current() : structuredClone(current);
    },
    async music(kind) {
      if (kind !== 'targets') throw Error('unexpected read');
      return {ok: true, coverage: 'account_targets', bootId: 'boot', roomId: 'room',
        roomBinding: {...snapshot.mediaRoomBindings[0]},
        data: {targets: [{...target, restricted: false, readOnly: false}]}};
    },
    async musicSelectionSetup(candidateSetId, issuedTarget, candidateIds) {
      setups.push({candidateSetId, issuedTarget, candidateIds});
      if (setup) return setup(candidateSetId, issuedTarget, candidateIds);
      const view = host.liveSelection;
      return {ok: true, schema: 'podview.music-selection.v1', candidateSetId, accountId: 'account',
        target: {kind: 'spotify_device', targetId: 'device'},
        taskId: 'music-selection:' + String(setups.length).padStart(32, 'b'),
        revision: 1, startVolumePercent: 35, expiresIn: 40,
        options: view.source.tracks.map((track, index) => ({id: String(index).padStart(24, 'c'), label: track.name,
          artist: track.artist}))};
    },
    async musicSelectionAction(offer, optionId) {
      sent.push({offer, optionId});
      return action ? action(offer, optionId) : {ok: true, outcome: 'accepted', retryAllowed: false,
        physicalResultVerified: false, requestId: 'r'};
    },
  };
  let renders = 0;
  const host = Object.assign(root, {
    liveTransport: transport, liveSnapshot: snapshot, state: {focus: 'music'},
    liveMedia: {account: 'account', playback: null, render() { renders += 1; }},
  });
  const shelves = new MusicShelvesView(host);
  host.liveCatalogue = shelves;
  const node = () => ({textContent: '', hidden: false, disabled: false, value: '', open: false, setAttribute() {},
    replaceChildren() {}, append() {}, showModal() { this.open = true; }, close() { this.open = false; }});
  const view = Object.create(LiveMusicSelectionView.prototype);
  Object.assign(view, {host, account: 'account', generation: 0, active: false, used: false, pending: false,
    source: null, offer: null, targets: [], dialog: node(), searchDialog: node(), note: node(), detail: node(),
    volume: node(), confirmButton: node(), targetSelect: node(), targetLabel: node(),
    render() { shelves.render(); }, showTargets() {}});
  host.liveSelection = view;
  shelves.resetAccount('account');
  shelves.updateCapabilities(true, snapshot.capabilities.musicRead);
  return {
    root, host, shelves, view, snapshot, reads, setups, sent,
    serve(next) { current = next; },
    renders: () => renders,
    tile: name => [...root.querySelectorAll('button[data-uri]')].find(button =>
      button.querySelector('strong')?.textContent === name),
    cleanup() { shelves.dispose(); clearTimeout(view.expiryTimer); root.remove(); },
  };
}
