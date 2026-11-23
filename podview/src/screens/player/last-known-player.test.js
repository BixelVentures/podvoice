// The Home player right after an add-on restart (2.1.28, re-landed): the room as its speaker last reported it shows
// from the first frame, until this screen's own read of the room lands. The speaker picker is never locked by that
// last-known state: Green 2.1.28 greyed »Svend's HomePod« in all three checks, because without a live player the
// rows were judged by the start rule (Svend has none in this room, only a move rule) while the player showed music.
// Composed of the real player, speaker picker and media view on the real shell; only HA/PodVoice answers and the
// music command lane are stand-ins.
import assert from 'node:assert/strict';
import {afterEach, test} from 'vitest';
import {LiveMediaView} from '../../../live-media-view.js';
import {assign, click, playerShell} from './player-fixture.js';
import {PlayerView} from './PlayerView';
import {SpeakerOutputView} from './SpeakerOutputView';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const ACCOUNT = 'account';
const binding = {roomId: 'kitchen', accountId: ACCOUNT, targetId: 'engine', nativeRoomId: 'r0', nativeHomepodId: '42',
  bindingId: 'b'.repeat(64)};
const KITCHEN = 'a'.repeat(64), SVEND = 'd'.repeat(64);

// What PodVoice's snapshot carries after a restart: the room's last report, marked lastKnown, without controls.
function lastKnown(state = 'playing') {
  return {ok: true, schema: 'podview.room-player.v1', bootId: 'boot', roomId: 'kitchen', configEntryId: ACCOUNT,
    state, source: 'spotify', account: null, title: 'Yesterday', artist: 'The Beatles', album: null,
    uri: 'spotify:track:' + 'y'.repeat(22), positionMs: 3000, positionAt: Date.now() - 60000, durationMs: 125000,
    volumePercent: 20, artworkUrl: null, actions: [], maxVolume: null, session: null, elsewhere: null,
    lastKnown: true, observedAt: Date.now() / 1000 - 60};
}
// The room's own read (podview.room-player.v1), with PodConnect's session when music plays.
function live(state) {
  const active = state === 'playing';
  return {ok: true, schema: 'podview.room-player.v1', bootId: 'boot', roomId: 'kitchen', configEntryId: ACCOUNT, state,
    source: active ? 'spotify' : null, title: active ? 'Let It Be' : null, artist: active ? 'The Beatles' : null,
    album: null, uri: active ? 'spotify:track:' + 'l'.repeat(22) : null, positionMs: active ? 1000 : null,
    positionAt: active ? Date.now() : null, durationMs: active ? 243000 : null, volumePercent: 20, artworkUrl: null,
    actions: active ? ['pause', 'next', 'previous', 'volume'] : [], maxVolume: active ? 100 : null,
    session: active ? {binding: {...binding, validUntil: Date.now() / 1000 + 30}, ownerEpoch: 'epoch',
      pollSequence: 1, targetId: 'engine', targetName: 'Køkkenalrum HomePod'} : null, elsewhere: null};
}
// Green's speakers in Køkkenalrum: the room's own HomePod (start and move rule) and Svend's (a move rule only).
function speakers() {
  const row = {accountId: ACCOUNT, kind: 'configured_alias', availability: 'available', nativeSelected: false,
    outputSelected: null};
  return {ok: true, schema: 'podview.speaker-catalogue.v1', bootId: 'boot', roomId: 'kitchen', accountId: ACCOUNT,
    status: 'observed', catalogueId: 'c'.repeat(64), retrievedAt: Date.now() / 1000, source: 'podconnect.get_targets',
    speakers: [
      {...row, speakerId: KITCHEN, nativeRoomId: 'r0', homepodId: '42', name: 'Køkkenalrum HomePod', default: true,
        selectable: true, moveBlockedReason: null, startSelectable: true, startBlockedReason: null},
      {...row, speakerId: SVEND, nativeRoomId: 'r1', homepodId: '43', name: 'Svend’s HomePod', default: false,
        selectable: true, moveBlockedReason: null, startSelectable: false, startBlockedReason: 'no_rule'},
    ],
    moveAvailable: true, physicalResultVerified: false};
}

let views = [];
afterEach(() => {
  for (const view of views) view.cleanup?.();
  views = [];
});

// A fresh screen right after the restart: the snapshot has the last-known player; the room's own read is held.
function restarted({last = lastKnown()} = {}) {
  const host = playerShell();
  const response = document.createElement('section');
  response.id = 'music-response';
  host.append(response);
  let answer;
  const reads = [], moves = [];
  assign(host, {
    live: true, isConnected: true, state: {focus: 'player'},
    liveSnapshot: {bootId: 'boot', roomId: 'kitchen', mediaRoomBindings: [{...binding}], roomPlayer: last,
      capabilities: {musicRead: ['targets', 'playback'], controlSetup: ['music'], musicSelection: true}},
    liveTransport: {connected: true, generation: 0, music: (kind, account) => {
      reads.push(kind);
      if (kind === 'speakers') return Promise.resolve(speakers());
      return new Promise(resolve => {
        answer = resolve;
      });
    }},
    liveSelection: {pendingPlayer: () => null, controlHold: () => null},
    // The music command lane: a move needs PodConnect's session in the room's own read (live-control-view.js).
    liveControls: {pending: false, activeOperation: null, musicFence: null, musicIntentPending: false,
      render() {}, playerStatus: () => '', invalidateMusic() {},
      musicContext: () => host.liveMedia.playback?.roomBinding ? {key: 'music'} : null,
      moveSpeaker: row => {
        moves.push(row.name);
        return true;
      }},
  });
  const player = new PlayerView(host, {}), outputs = new SpeakerOutputView(host);
  host.playerView = player;
  host.liveOutputs = outputs;
  const media = new LiveMediaView(host);
  host.liveMedia = media;
  media.account = ACCOUNT;
  views.push(player, outputs);
  const reading = media.refresh({immediate: true});
  const $ = id => document.getElementById(id);
  const row = speakerId => $('room-options').querySelector(`[data-speaker-id="${speakerId}"]`);
  return {host, media, outputs, reads, moves, $, row,
    async land(body) {
      answer(body);
      await reading;
      await settle();
    }};
}

test('right after a restart the player shows the last report at once, never »Henter afspilningsstatus«', async () => {
  const f = restarted();
  await settle();
  assert.deepEqual(f.reads.filter(kind => kind === 'playback'), ['playback'],
    'the room is read once, still on its way');
  assert.equal(f.$('track-name').textContent, 'Yesterday');
  assert.equal(f.$('player-empty').hidden, true, 'no empty player');
  assert.doesNotMatch(document.body.textContent, /Henter afspilningsstatus/);
  assert.notEqual(f.$('player-state').textContent, 'Spiller på', 'last known claims nothing current');
  assert.match(f.$('output').getAttribute('aria-label'), /Seneste output/);
});

test('the speaker picker is usable while the room warms up: no speaker is locked by the last-known state',
  async () => {
    const f = restarted();
    await settle();
    assert.equal(f.$('output').disabled, false, 'the speaker chip opens the list');
    await f.outputs.open();
    for (const [id, name] of [[KITCHEN, 'Køkkenalrum'], [SVEND, 'Svend']])
      assert.equal(f.row(id).disabled, false, `${name} can be chosen during warm-up`);
    // Svend's HomePod is a move destination: the tap is taken at once and waits for the room's own read.
    click(f.row(SVEND));
    await settle();
    assert.deepEqual(f.moves, [], 'nothing is sent on a guess');
    assert.equal(f.$('player-room').textContent, 'Svend’s HomePod', 'the chosen speaker shows at once');
    assert.equal(f.row(SVEND).getAttribute('aria-pressed'), 'true');
    // Last tap wins: a second tap on the room's own HomePod replaces the first.
    await f.outputs.open();
    click(f.row(KITCHEN));
    await settle();
    assert.equal(f.$('player-room').textContent, 'Køkkenalrum HomePod');
    // The live read lands: playing in the room's own HomePod, which is already the last choice: nothing is sent.
    await f.land(live('playing'));
    assert.deepEqual(f.moves, [], 'the chosen speaker already plays');
  });

test('a speaker chosen during warm-up is moved once when the room’s own read confirms the music', async () => {
  const f = restarted();
  await settle();
  await f.outputs.open();
  click(f.row(SVEND));
  await settle();
  await f.land(live('playing'));
  assert.deepEqual(f.moves, ['Svend’s HomePod'], 'one explicit move, once');
  f.outputs.sync();
  f.media.render();
  assert.deepEqual(f.moves, ['Svend’s HomePod'], 'never replayed');
});

test('the live read replaces the last report honestly: its own song, »Spiller på«, current speaker', async () => {
  const f = restarted();
  await settle();
  assert.equal(f.$('track-name').textContent, 'Yesterday');
  await f.land(live('playing'));
  assert.equal(f.media.lastKnownPlayback(), null, 'the last report is gone once the room has answered');
  assert.equal(f.$('track-name').textContent, 'Let It Be');
  assert.equal(f.$('player-state').textContent, 'Spiller på');
  assert.match(f.$('output').getAttribute('aria-label'), /Aktuelt output/);
  await f.outputs.open();
  assert.equal(f.row(SVEND).disabled, false, 'Svend is a move destination for the playing music');
});

test('when the room answers that nothing plays, the last report and a warm-up choice it cannot start go', async () => {
  const f = restarted();
  await settle();
  await f.outputs.open();
  click(f.row(SVEND));
  await settle();
  await f.land(live('idle'));
  assert.equal(f.media.lastKnownPlayback(), null);
  assert.equal(f.$('player-empty').hidden, false, 'the empty player, as the room said');
  assert.doesNotMatch(f.$('player-empty').textContent, /Henter/);
  assert.deepEqual(f.moves, [], 'no move without music');
  assert.equal(f.outputs.nextDestinationLabel(), '', 'Svend has no start rule here: no silent next destination');
  // The start rule is the live answer now: the room's own HomePod is a start destination, Svend is not.
  await f.outputs.open();
  assert.equal(f.row(KITCHEN).disabled, false);
  assert.equal(f.row(SVEND).disabled, true);
});
