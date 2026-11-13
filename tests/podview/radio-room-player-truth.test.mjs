// Testnoter 13/11 fejl 13: the room's media_player is the room. While it shows music, a stopped
// (or not updated) radio does not take the player, so the music card and the player agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveRadioView} from '../../podvoice/gatekeeper/static/podview/live-radio-view.js';
import {stations} from '../../podvoice/gatekeeper/static/podview/radio-model.js';
import {PlayerView} from '../../podvoice/gatekeeper/static/podview/player-view.js';

const now = Date.now(), snapshot = {bootId: 'boot', roomId: 'room'};
const stopped = (overrides = {}) => ({
 ok: true, schema: 'podview.radio.v1', ...snapshot, revision: 2, enabled: true, blockedReasons: [],
 stations: stations.map(s => ({id: s.id, name: s.label})),
 targets: [{id: 'r0', name: 'Køkkenalrum', availability: 'available', selectable: true, default: true}],
 actions: ['start', 'stop', 'move'],
 state: {status: 'stopped', stationId: null, targetId: null, generation: 2, sourceKind: 'none',
  ownerGeneration: null, volumePercent: null, observedAt: now / 1000 - 60},
 retrievedAt: now / 1000, validUntil: now / 1000 + 30, physicalResultVerified: false, ...overrides,
});
// As parsed by roomPlayerObservation: In Da Club paused in this room after the radio stopped
// (radio stop observed 60 s ago), no PodConnect session.
const room = (overrides = {}) => ({
 projectionVersion: 4, config_entry_id: 'account', ...snapshot, state: 'paused', source: 'spotify',
 observedAt: new Date(now - 30000).toISOString(), receivedAt: now, expiresAt: now + 30000,
 item: {type: 'track', uri: 'spotify:track:' + '1'.repeat(22), name: 'In Da Club', artists: ['50 Cent']},
 controls: {actions: ['resume'], maxVolume: 50}, owner_epoch: null, poll_sequence: null, target: null,
 roomBinding: null, roomBound: true, ...overrides,
});
function fixture(playback) {
 const calls = [];
 const host = {
  isConnected: true, liveSnapshot: snapshot, liveTransport: {connected: true},
  liveMedia: {account: 'account', playback},
  playerView: {renderPlayer: vm => calls.push(vm), renderControls: () => {}, renderQueue: () => {}},
 };
 // The real source owner of the shared player.
 for (const name of ['sourceScope', 'sourceFocused', 'radioHistorySuperseded'])
  host.playerView[name] = PlayerView.prototype[name];
 host.playerView.host = host;
 const radio = new LiveRadioView(host);
 host.liveRadio = radio;
 radio.value = stopped();
 radio.lastConfirmed = {sourceKind: 'radio', stationId: 'p3', targetId: 'r0', generation: 1};
 radio.lastConfirmedAt = now - 60000;
 radio.render = () => {};
 return {radio, calls, host};
}

test('music in the room takes the player from a stopped radio, also without a PodConnect session', () => {
 const {radio, calls} = fixture(room());
 assert.equal(radio.knownStopped(), true, 'the radio history is still known');
 assert.equal(radio.ownsPlayer(), false, 'the room player shows the room');
 assert.equal(radio.renderPlayer(), false);
 assert.deepEqual(calls, []);
});

test('a song paused before the radio stopped does not replace the station; the music card agrees', () => {
 const {radio, host} = fixture(room({observedAt: new Date(now - 120000).toISOString()}));
 assert.equal(radio.ownsPlayer(), true, 'the stopped station stays like a paused song');
 host.live = true;
 host.playerView.sourceModel = PlayerView.prototype.sourceModel;
 host.liveMedia.observedPlayerModel = () => ({active: true, title: 'In Da Club'});
 assert.deepEqual(host.playerView.sourceModel('music'), {}, 'the music card shows no older song');
});

test('a stopped radio still shows when the room has nothing else', () => {
 const {radio} = fixture(room({state: 'idle', item: null}));
 assert.equal(radio.ownsPlayer(), true);
});

test('a radio playing in the room keeps the player', () => {
 const {radio} = fixture(room({source: 'radio', state: 'playing'}));
 radio.value = stopped({state: {status: 'playing', stationId: 'p3', targetId: 'r0', generation: 3,
  sourceKind: 'radio', ownerGeneration: 3, volumePercent: 20, observedAt: now / 1000}});
 assert.equal(radio.ownsPlayer(), true);
});
