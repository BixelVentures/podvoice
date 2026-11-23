// The player as drawn by React (Player.tsx): the card on Home, the empty card and the full player with the queue.
// Replaces player-view.test.js, player-render.test.js, player-dom-delta.test.js and output-header.test.js, which drove
// the pre-React PlayerView controller and its Paint faces. Their behavioural assertions are kept here against the
// drawn DOM (the music owner publishes into the player store; the shell's ports record taps). Assertions about
// deleted internals (Paint faces and settle(), flushSync, PlayerView methods and row expandos, listener identities,
// bfcache re-binding of native listeners) are dropped: React owns those elements and their listeners now.
import assert from 'node:assert/strict';
import {act, fireEvent} from '@testing-library/react';
import {afterEach, test, vi} from 'vitest';
import {createStore} from 'zustand/vanilla';
import {roomPlayerObservation} from '../../lib/api/media';
import {setFocus} from '../../lib/store/shell';
import {OTHER_ACCOUNT, livePlayerModel} from './player-model';
import {click, playerShell, settle} from './player-fixture.js';
import {playerSession} from './session';
import {publishBusy, publishControls, publishFindMusic, publishPlayer, publishQueue, clearQueue} from './store';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  act(() => {
    setFocus('now');
  });
});

const show = (model, controls, queue) => {
  act(() => {
    if (model) publishPlayer(model);
    if (controls) publishControls(controls);
    if (queue) publishQueue(...queue);
  });
};
const URI = 'spotify:track:' + 'a'.repeat(22);
const snapshot = {bootId: 'boot', roomId: 'kitchen', capabilities: {musicRead: ['targets', 'playback', 'mood']}};
const body = (changes = {}) => ({ok: true, schema: 'podview.room-player.v1', bootId: 'boot', roomId: 'kitchen',
  configEntryId: 'account', state: 'playing', source: 'spotify', title: 'Hey Jude', artist: 'The Beatles', album: '1',
  uri: URI, positionMs: 84000, positionAt: Date.now(), durationMs: 187000, volumePercent: 27,
  actions: ['pause', 'resume', 'next', 'previous', 'seek', 'volume'], maxVolume: 40, session: null, ...changes});
const playing = {active: true, playing: true, fresh: true, title: 'A song', artist: 'An artist', target: 'Køkken',
  canOutput: true, canDiscover: true};

// ---------------------------------------------------------------------------------------------------------------
// Empty and loading

test('a first read shows the empty card busy, inert and honest; settled empty texts replace it', () => {
  const {$, host} = playerShell();
  for (const canDiscover of [undefined, false, true]) {
    show({active: false, loading: true, canDiscover}, {blocked: true});
    assert.equal(host.querySelector('.player').hidden, true);
    assert.equal($('player-empty').hidden, false);
    assert.equal($('player-empty').getAttribute('aria-busy'), 'true');
    assert.equal($('player-empty').dataset.state, 'loading');
    assert.equal($('player-empty').querySelector('.player-empty-copy > p').textContent, 'Henter afspilningsstatus');
    assert.equal($('empty-find-music').disabled, canDiscover !== true);
    assert.equal($('output').disabled, true, 'no speaker list while the room is read');
    assert.equal($('cover').style.visibility, 'hidden');
    assert.equal($('track').disabled, true);
  }
  for (const empty of ['Der spiller ikke noget lige nu.', 'Afspilningen kunne ikke hentes.', 'Forbindelsen mangler.']) {
    show({active: false, loading: false, empty, canDiscover: false});
    assert.equal($('player-empty').getAttribute('aria-busy'), 'false');
    assert.equal($('player-empty').querySelector('.player-empty-copy > p').textContent, empty);
  }
  show({active: true, loading: true, title: 'Retained song', artist: 'Artist'});
  assert.equal($('player-empty').hidden, true);
  assert.equal(host.querySelector('.player').hidden, false);
  assert.equal($('track-name').textContent, 'Retained song');
  assert.equal(host.querySelector('.player').getAttribute('aria-busy'), 'true');
});

test('unknown playback uses actionable copy and a domain heading, never a stopped claim or an invented room', () => {
  const {$} = playerShell({live: true});
  show({active: false, canDiscover: true}, {blocked: true, volume: null});
  assert.equal($('player-empty').querySelector('.player-empty-copy > p').textContent, 'Vælg en stemning eller sang.');
  assert.equal($('player-room').textContent, 'Musik');
  assert.equal($('player-state').textContent, '');
  assert.equal($('output').getAttribute('aria-label'), 'Musik');
  assert.equal($('play-pause').disabled, true);
  assert.equal($('track-name').textContent, '');
  assert.equal($('volume-value').textContent, '—');
  show(livePlayerModel(null, true, 'error', snapshot));
  assert.equal($('player-empty').querySelector('.player-empty-copy > p').textContent, 'Afspilningen kunne ikke hentes.');
  assert.equal($('empty-find-music').disabled, false);
  show(livePlayerModel(null, false, 'ready', snapshot));
  assert.equal($('player-empty').dataset.state, 'offline');
});

test('the idle speaker chip takes the empty card title’s place and names the configured or next speaker', () => {
  const {$, taps} = playerShell({live: true});
  show({active: false, canOutput: true});
  const copy = $('player-empty').querySelector('.player-empty-copy');
  assert.equal(copy.firstElementChild, $('output'), 'the chip stands where the title was');
  assert.equal(copy.querySelector('h2:not(#player-title)'), null);
  assert.equal($('output').getAttribute('aria-label'), 'Musik · Se aktuelle højttalere');
  assert.equal($('output').disabled, false, 'a read of the empty room never greys the picker');
  show({active: false, canOutput: true, configuredTarget: 'Køkkenalrum HomePod'});
  assert.equal($('player-room').textContent, 'Køkkenalrum HomePod');
  assert.equal($('output').getAttribute('aria-label'), 'Konfigureret højttaler: Køkkenalrum HomePod');
  show({active: false, canOutput: true, configuredTarget: 'Køkkenalrum HomePod', nextDestinationLabel: 'Frida'});
  assert.equal($('player-room').textContent, 'Frida');
  assert.equal($('output').getAttribute('aria-label'), 'Næste afspilning: Frida');
  click($('output'));
  assert.equal(taps.speakers.length, 1);
  for (let i = 0; i < 3; i++) show({active: false, canOutput: true, nextDestinationLabel: `F${String(i)}`});
  assert.equal(document.querySelectorAll('#output').length, 1, 'repeated renders never duplicate the chip');
  // Music plays: the same chip moves back into the card, before the volume.
  show(playing);
  const card = document.querySelector('aside.player');
  assert.ok(card.contains($('output')));
  assert.equal($('output').nextElementSibling, card.querySelector('.volume'));
  assert.equal(document.querySelectorAll('#output').length, 1);
  assert.equal($('player-empty').querySelector('.player-empty-copy h2').textContent, 'Musik');
});

test('the empty card’s music entry: Find musik, the account choice, hidden only on the music page itself', () => {
  const {$, taps} = playerShell({live: true});
  show({active: false, canDiscover: true});
  assert.equal($('empty-find-music').dataset.action, 'music');
  assert.match($('empty-find-music').textContent, /^Vælg musik/);
  click($('empty-find-music'));
  assert.deepEqual(taps.findMusic, ['music']);
  act(() => {
    setFocus('music');
  });
  assert.equal($('empty-find-music').hidden, true, 'its destination is already visible');
  show({active: false, emptyState: 'account-selection', canChooseAccount: true});
  assert.equal($('empty-find-music').hidden, false, 'the account choice stays actionable on the music page');
  assert.equal($('empty-find-music').dataset.action, 'account');
  assert.match($('empty-find-music').textContent, /^Vælg musikkonto/);
  click($('empty-find-music'));
  assert.deepEqual(taps.findMusic, ['music', 'account']);
  show({active: false, emptyState: 'account-selection', canChooseAccount: false});
  assert.equal($('empty-find-music').disabled, true);
});

// ---------------------------------------------------------------------------------------------------------------
// Playing: state line, output labels, placements

test('a live room player shows its song, »Spiller på« and the current output; a stale one says so', () => {
  const {$, host} = playerShell({live: true});
  const p = roomPlayerObservation(body(), 'account', snapshot);
  show(livePlayerModel(p, true, 'ready', snapshot, 'Køkkenalrum HomePod'));
  assert.equal($('track-name').textContent, 'Hey Jude');
  assert.equal($('track-artist').textContent, 'The Beatles');
  assert.equal($('player-state').textContent, 'Spiller på');
  assert.equal($('player-state').dataset.routineOutput, 'true');
  assert.equal($('player-room').textContent, 'Køkkenalrum HomePod');
  assert.equal($('output').getAttribute('aria-label'),
    'Spiller på · Køkkenalrum HomePod · Aktuelt output · Vælg højttaler');
  assert.equal(host.dataset.playback, 'active');
  show({...livePlayerModel(p, true, 'ready', snapshot, 'Køkkenalrum HomePod'), fresh: false});
  assert.equal($('player-state').textContent, 'Ikke opdateret');
  assert.equal($('detail-status').textContent, 'Afspilningen er ikke opdateret');
  for (const id of ['output', 'detail-output']) assert.match($(id).getAttribute('aria-label'), /Seneste output/);
  // The connection itself explains a stale player: no »Ikke opdateret« over it.
  show({...livePlayerModel(p, true, 'ready', snapshot, 'Køkkenalrum HomePod'), fresh: false,
    connectionExplained: true});
  assert.equal($('player-state').textContent, '');
});

test('an operation status shows in overview and detail and the detail is busy while it runs', () => {
  const {$} = playerShell({live: true});
  const vm = {...playing, feedback: {pending: true, message: 'Afventer svar fra højttaleren'}};
  show(vm);
  assert.equal($('player-state').textContent, vm.feedback.message);
  assert.equal($('detail-status').textContent, vm.feedback.message);
  assert.equal($('music-detail').getAttribute('aria-busy'), 'true');
  show({...vm, feedback: null, fresh: false});
  assert.equal($('music-detail').getAttribute('aria-busy'), 'false');
});

test('paused elsewhere is routine output; a stale pause is not', () => {
  const {$} = playerShell({live: true});
  const vm = {active: true, playing: false, fresh: true, readOnly: true, placement: 'elsewhere', title: 'Morgensang',
    artist: 'En kunstner', target: 'MacBook Pro', canOutput: true};
  show(vm);
  assert.equal($('player-state').textContent, 'På pause');
  assert.equal($('player-state').dataset.routineOutput, 'true');
  assert.ok($('output').getAttribute('aria-label').includes('På pause'));
  show({...vm, fresh: false});
  assert.equal($('player-state').dataset.routineOutput, 'false');
});

test('f) own music on another device: »Flyt til <rum>«, then »Flytter til <rum>…« until the room plays it', () => {
  const {$, host, taps} = playerShell({live: true});
  const vm = {active: true, playing: true, fresh: true, readOnly: true, placement: 'elsewhere', title: 'Let It Be',
    target: 'iPhone', configuredTarget: 'Køkken', canOutput: true};
  show(vm);
  assert.equal(host.querySelector('.player').dataset.placement, 'elsewhere');
  assert.equal($('player-state').textContent, 'Spiller på');
  assert.equal($('move-here').hidden, false);
  assert.equal($('move-here').dataset.action, 'move');
  assert.equal($('move-here-label').textContent, 'Flyt til Køkken');
  assert.match($('output').getAttribute('aria-label'), /Flyt til Køkken$/);
  click($('move-here'));
  assert.equal(taps.moveHere.length, 1);
  show({...vm, selectedTarget: 'Køkken'});
  assert.equal($('move-here').dataset.pending, 'true');
  assert.equal($('move-here-label').textContent, 'Flytter til Køkken…');
  assert.equal($('player-state').textContent, 'Skifter til');
  show({...vm, configuredTarget: ''});
  assert.equal($('move-here').hidden, true, 'no room to move to: no button');
});

test('anden konto: their track read-only, never a name, no speaker choice; »Vælg musik« starts own music', () => {
  const {$, host} = playerShell({live: true});
  const p = roomPlayerObservation(body({account: 'other', actions: [], maxVolume: null}), 'account', snapshot);
  show(livePlayerModel(p, true, 'ready', snapshot, 'Køkkenalrum'), {blocked: false, toggle: false, previous: false,
    next: false, volume: null});
  assert.equal(host.querySelector('.player').dataset.placement, 'other-account');
  assert.equal($('player-state').textContent, OTHER_ACCOUNT);
  assert.equal($('detail-status').textContent, OTHER_ACCOUNT);
  assert.equal($('output').disabled, true);
  assert.equal($('play-pause').disabled, true);
  assert.equal($('move-here').hidden, false);
  assert.equal($('move-here').dataset.action, 'music');
  assert.equal($('move-here-label').textContent, 'Vælg musik');
  assert.equal($('move-here').querySelector('img').getAttribute('src'), 'assets/icons/music-note-beamed.svg');
});

// ---------------------------------------------------------------------------------------------------------------
// Transport and the busy ring

test('transport follows the source’s grants; a tap is one music event; the ring shows only on its button', () => {
  const {$, taps} = playerShell({live: true});
  show(playing, {playing: true, previous: true, next: false, toggle: true});
  assert.equal($('previous').disabled, false);
  assert.equal($('next').disabled, true);
  assert.equal($('play-pause').disabled, false);
  assert.equal($('play-pause').getAttribute('aria-label'), 'Sæt musik på pause');
  assert.equal($('play-icon').getAttribute('src'), 'assets/icons/pause-fill.svg');
  click($('play-pause'));
  click($('previous'));
  click($('next'));
  assert.deepEqual(taps.music, [{type: 'toggle'}, {type: 'skip', delta: -1}], 'a disabled button sends nothing');
  act(() => {
    publishBusy({ring: 'pause', transport: true, volume: false});
  });
  assert.equal($('play-pause').getAttribute('aria-busy'), 'true');
  assert.equal($('previous').getAttribute('aria-busy'), 'false');
  assert.equal(document.querySelector('.player .transport').getAttribute('aria-busy'), 'true');
  assert.equal($('play-pause').disabled, false, 'a running call never locks its button');
  act(() => {
    publishBusy({ring: 'next', transport: true, volume: false});
  });
  assert.equal($('next').getAttribute('aria-busy'), 'false', 'a button the user cannot use shows no spinner');
  show(null, {playing: false, previous: true, next: true, toggle: true});
  assert.equal($('play-pause').getAttribute('aria-label'), 'Fortsæt musikken');
  show(null, {blocked: true, playing: false, previous: true, next: true, toggle: true});
  for (const id of ['previous', 'play-pause', 'next']) assert.equal($(id).disabled, true);
});

// A radio source on the live host, as screens/radio/source.ts exposes it.
function radioSourceStub(state) {
  const store = createStore(() => ({outputOpen: false, value: null, ...state}));
  return Object.assign(store, {
    presentsPlayer: () => store.getState().model !== null,
    playerModel: () => store.getState().model,
    controls: () => store.getState().controls,
    pendingStart: () => store.getState().pendingStart ?? null,
    progress: () => store.getState().progress ?? null,
    ownsPlayer: () => store.getState().model !== null,
    hasSource: () => true,
    can: () => true,
    closeOutputs: () => undefined,
    outputsModel: () => null,
  });
}

test('radio holds the shared player: its own controls, live phase and no queue; music comes back after', () => {
  const radioModel = {active: true, sourceKind: 'radio', playing: true, fresh: true, title: 'P3',
    artist: 'Direkte radio', fixtureArt: 'assets/radio-p3.svg', target: 'Køkken', canOutput: true};
  const radio = radioSourceStub({model: radioModel, controls: {sourceKind: 'radio', playing: true, toggle: true,
    blocked: false, volume: 30, canVolume: true, loadingControlId: null}});
  const {$, taps} = playerShell({live: true, liveRadio: radio});
  show(playing, {playing: true, previous: true, next: true, toggle: true}, [[{id: 'q1', title: 'Next song', order: 1}]]);
  assert.equal($('track-name').textContent, 'P3');
  assert.equal($('radio-live').hidden, false);
  assert.equal($('radio-live').dataset.phase, 'live');
  assert.equal($('radio-live').textContent, 'Direkte');
  assert.equal($('previous').hidden, true);
  assert.equal($('next').hidden, true);
  assert.equal($('play-pause').getAttribute('aria-label'), 'Stop radio');
  assert.equal($('play-icon').getAttribute('src'), 'assets/icons/stop-fill.svg');
  assert.equal($('player-state').hidden, true);
  assert.equal($('queue').hidden, true);
  assert.equal(document.querySelector('aside.player').dataset.sourceKind, 'radio');
  click($('play-pause'));
  assert.deepEqual(taps.music, [{type: 'toggle', controlId: 'play-pause'}]);
  // A move to a chosen speaker: the speaker chip shows radio's progress.
  act(() => {
    radio.setState({progress: {kind: 'output', id: 'speaker'}});
  });
  assert.equal($('output').getAttribute('aria-busy'), 'true');
  assert.equal($('output').dataset.feedback, 'progress');
  assert.equal($('output').disabled, true);
  // A pending start shows its spinner on the toggle.
  act(() => {
    radio.setState({progress: null, controls: {sourceKind: 'radio', playing: true, toggle: true, blocked: false,
      loadingControlId: 'play-pause', pendingLabel: 'Starter P3…'}});
  });
  assert.equal($('play-pause').getAttribute('aria-busy'), 'true');
  assert.equal($('play-pause').getAttribute('aria-label'), 'Starter P3…');
  assert.equal($('detail-toggle').getAttribute('aria-busy'), 'true');
  // Radio gives the player back: music, its controls and its queue.
  act(() => {
    radio.setState({model: null});
  });
  assert.equal($('track-name').textContent, 'A song');
  assert.equal($('previous').hidden, false);
  assert.equal($('radio-live').hidden, true);
  assert.equal($('queue').hidden, false);
  assert.equal($('play-pause').getAttribute('aria-label'), 'Sæt musik på pause');
});

// ---------------------------------------------------------------------------------------------------------------
// Volume and mute

test('volume shows the observed percent or an honest unknown, on the kit slider', () => {
  const {$} = playerShell();
  for (const volume of [0, 40, 100]) {
    show(playing, {canVolume: true, volume});
    for (const id of ['volume', 'detail-volume']) {
      assert.equal($(id).value, String(volume));
      assert.equal($(id).getAttribute('aria-valuetext'), `${String(volume)} %`);
      assert.equal($(id).dataset.kitValueKnown, 'true');
      assert.equal($(id).style.getPropertyValue('--pv-slider-progress'), `${String(volume)}%`);
    }
    assert.equal($('volume-value').textContent, `${String(volume)} %`);
  }
  show(null, {canVolume: true, volume: null});
  assert.equal($('volume').getAttribute('aria-valuetext'), 'Ukendt lydstyrke');
  assert.equal($('volume').disabled, true);
  assert.equal($('volume').dataset.kitValueKnown, 'false');
  assert.equal($('volume').value, '100', 'an unknown volume leaves the range where it was');
  assert.equal($('volume-value').textContent, '—');
  show(null, {canVolume: true, volume: 30, max: 35});
  assert.equal($('volume').max, '100', 'the absolute percent scale stays');
  assert.equal($('volume').dataset.actionMax, '35');
});

function liveVolumeShell(extra = {}) {
  const p = roomPlayerObservation(body(), 'account', snapshot);
  const transport = {connected: true, generation: 1};
  const f = playerShell({live: true, liveSnapshot: snapshot, liveTransport: transport,
    liveMedia: {playback: p, account: 'account', render() {}},
    liveControls: {player: {can: action => action === 'volume'}}, ...extra});
  show(livePlayerModel(p, true, 'ready', snapshot), {playing: true, toggle: true, canVolume: true, volume: 27,
    min: 0, max: 40});
  return f;
}

test('a volume drag keeps its value against redraws and its release is one volume for that source', () => {
  const {$, taps} = liveVolumeShell();
  const input = $('volume');
  fireEvent.pointerDown(input);
  fireEvent.input(input, {target: {value: '33'}});
  assert.equal(input.value, '33');
  assert.equal($('volume-value').textContent, '33 %');
  show(null, {playing: true, toggle: true, canVolume: true, volume: 27, min: 0, max: 40});
  assert.equal(input.value, '33', 'a redraw never moves the finger’s value');
  act(() => {
    input.dispatchEvent(new Event('change', {bubbles: true}));
  });
  assert.equal(taps.music.length, 1);
  assert.equal(taps.music[0].type, 'volume');
  assert.equal(taps.music[0].value, '33');
  assert.equal(taps.music[0].volumeSource.sourceKind, 'music');
  // A value above the room's maximum stops there and says so.
  fireEvent.pointerDown(input);
  fireEvent.input(input, {target: {value: '60'}});
  assert.equal(input.value, '40');
  assert.deepEqual(taps.feedback.at(-1), {text: 'Højst 40 %', source: 'music-volume'});
});

test('a volume gesture that lost its source sends nothing on release', () => {
  const {$, taps, host} = liveVolumeShell();
  const input = $('volume');
  fireEvent.pointerDown(input);
  fireEvent.input(input, {target: {value: '20'}});
  host.liveTransport = {connected: true, generation: 2};
  act(() => {
    input.dispatchEvent(new Event('change', {bubbles: true}));
  });
  assert.deepEqual(taps.music, []);
});

test('mute restores the last audible volume of the same source, once, with no optimistic icon', () => {
  const {$, taps} = playerShell({state: {sessionId: 's', music: {playback: {accountId: 'a', kind: 'k',
    targetId: 't', room: 'r'}}}});
  show(playing, {canVolume: true, volume: 30, min: 0, max: 100});
  const mute = $('volume-mute');
  assert.equal(mute.disabled, false);
  assert.equal(mute.getAttribute('aria-pressed'), 'false');
  assert.equal(mute.getAttribute('aria-label'), 'Slå lyden fra');
  click(mute);
  assert.deepEqual(taps.music, [{type: 'volume', value: 0}]);
  assert.equal(mute.disabled, true, 'one request at a time');
  assert.equal(mute.getAttribute('aria-pressed'), 'false', 'no optimistic icon');
  click(mute);
  assert.equal(taps.music.length, 1);
  show(null, {canVolume: true, volume: 0, min: 0, max: 100});
  assert.equal(mute.getAttribute('aria-pressed'), 'true');
  assert.equal(mute.getAttribute('aria-label'), 'Slå lyden til');
  assert.equal(mute.querySelector('img').getAttribute('src'), 'assets/icons/volume-mute.svg');
  click(mute);
  assert.deepEqual(taps.music.at(-1), {type: 'volume', value: 30});
  show(null, {canVolume: false, volume: 30, min: 0, max: 100});
  assert.equal(mute.disabled, true, 'no volume grant: no mute');
});

test('a muted source without a known audible volume cannot be unmuted', () => {
  const {$} = playerShell({state: {sessionId: 's', music: {playback: {accountId: 'a', kind: 'k', targetId: 't',
    room: 'r'}}}});
  show(playing, {canVolume: true, volume: 0, min: 0, max: 100});
  assert.equal($('volume-mute').disabled, true);
});

// ---------------------------------------------------------------------------------------------------------------
// Progress, seek and the display clock

test('position reaches the card and the detail as a display value; stale is labelled; invalid clears', () => {
  const {$} = playerShell();
  const vm = {...playing, progressMs: 84000, durationMs: 187000, positionFresh: true};
  show(vm);
  for (const prefix of ['player', 'detail']) {
    assert.equal($(`${prefix}-progress`).hidden, false);
    assert.equal($(`${prefix}-elapsed`).textContent, '1:24');
    assert.equal($(`${prefix}-duration`).textContent, '3:07');
    assert.equal($(`${prefix}-progress-meter`).getAttribute('value'), '84000');
    assert.match($(`${prefix}-progress-meter`).getAttribute('aria-label'), /^Observeret position.*Kun visning/);
  }
  assert.equal($('detail-seek').hidden, true, 'no seek affordance without a grant');
  show({...vm, positionFresh: false});
  assert.equal($('player-progress').dataset.stale, 'true');
  assert.match($('player-progress-meter').getAttribute('aria-label'), /^Position ikke opdateret/);
  for (const patch of [{progressMs: null}, {progressMs: 188000}, {progressMs: -1}, {durationMs: 0}, {active: false}]) {
    show({...vm, ...patch});
    for (const prefix of ['player', 'detail']) {
      assert.equal($(`${prefix}-progress`).hidden, true);
      assert.equal($(`${prefix}-elapsed`).textContent, '');
      assert.equal($(`${prefix}-progress-meter`).getAttribute('value'), '0');
    }
  }
});

test('the live position moves once a second from the observation, then holds where it was when it goes stale', async () => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']});
  const {$} = playerShell({live: true, liveTransport: {connected: true}});
  const now = Date.now();
  const vm = {...playing, progressMs: 84000, durationMs: 187000, positionFresh: true,
    positionAnchor: {key: 'song', observedAt: now, expiresAt: now + 30000}};
  show(vm);
  assert.equal($('player-elapsed').textContent, '1:24');
  // The display clock is read again just after each second (lib/hooks/clock.ts useRefreshAt).
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1001);
  });
  assert.equal($('player-elapsed').textContent, '1:25');
  assert.match($('player-progress-meter').getAttribute('aria-label'), /^Beregnet position fra seneste observation/);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2002);
  });
  assert.equal($('player-elapsed').textContent, '1:27');
  // The observation stops being fresh: the shown position stays, labelled stale, and never hops back.
  show({...vm, positionFresh: false});
  assert.equal($('player-elapsed').textContent, '1:27');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  assert.equal($('player-elapsed').textContent, '1:27');
  assert.equal($('player-progress').dataset.stale, 'true');
  // A correction or a pause replaces the display clock.
  show({...vm, playing: false, positionFresh: true, progressMs: 90000});
  assert.equal($('player-elapsed').textContent, '1:30');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  assert.equal($('player-elapsed').textContent, '1:30', 'paused never advances');
});

test('a local seek drag previews, commits once for its song and is dropped on a track change or blur', () => {
  const {$, taps} = playerShell();
  const vm = {...playing, canSeek: true, examplePosition: true, trackId: 't1', seekOperation: 1, progressMs: 84000,
    durationMs: 180000, positionFresh: true};
  show(vm);
  const seek = $('detail-seek');
  assert.equal(seek.hidden, false);
  assert.equal($('player-progress-meter').hidden, true, 'the range replaces the read-only meter');
  assert.equal(seek.getAttribute('aria-valuetext'), '1:24 af 3:00');
  fireEvent.pointerDown(seek);
  fireEvent.input(seek, {target: {value: '100000'}});
  assert.equal($('player-elapsed').textContent, '1:40');
  show({...vm, title: 'A song (redrawn)'});
  assert.equal(seek.value, '100000', 'a background render keeps the draft');
  act(() => {
    seek.dispatchEvent(new Event('change', {bubbles: true}));
  });
  assert.deepEqual(taps.seek, [{positionMs: 100000, trackId: 't1', operation: 1}]);
  // Another song while dragging: the draft goes and the release seeks nothing.
  fireEvent.pointerDown(seek);
  fireEvent.input(seek, {target: {value: '120000'}});
  show({...vm, trackId: 't2'});
  assert.equal($('player-elapsed').textContent, '1:24');
  act(() => {
    seek.dispatchEvent(new Event('change', {bubbles: true}));
  });
  assert.equal(taps.seek.length, 1);
  // Blur cancels an uncommitted preview.
  fireEvent.input(seek, {target: {value: '150000'}});
  fireEvent.blur(seek);
  assert.equal($('player-elapsed').textContent, '1:24');
  // Radio and loading never seek.
  show({...vm, sourceKind: 'radio'});
  assert.equal(seek.hidden, true);
});

// ---------------------------------------------------------------------------------------------------------------
// The queue

const row = (id, order, extra = {}) => ({id, title: `Song ${String(order)}`, artist: 'Artist', order, ...extra});

test('queue rows name their place, song and artist; a selectable row chooses, the current row is the toggle', () => {
  const {$, taps} = playerShell();
  show(playing, {playing: true, toggle: true}, [[row('c', 0, {current: true, playing: true}),
    row('a', 1, {selectable: true, revision: 3}), row('b', 2)], {status: 'ready'}]);
  const rows = [...$('queue').querySelectorAll('.queue-track:not([data-pv-leave])')];
  assert.deepEqual(rows.map(node => node.getAttribute('aria-label')), ['Spiller nu: Song 0 · Artist · Sæt på pause',
    'Afspil 1 · Song 1 · Artist', 'Kun visning: 2 · Song 2 · Artist']);
  assert.equal(rows[0].getAttribute('aria-current'), 'true');
  assert.equal(rows[0].dataset.playback, 'playing');
  assert.ok(rows[0].querySelector('.queue-eq'), 'the playing row shows the equalizer');
  assert.equal(rows[1].dataset.revision, '3');
  assert.equal(rows[2].disabled, true);
  assert.equal($('queue-title').textContent, 'Kø');
  assert.equal($('queue-meta').textContent, '3 numre · Køkken');
  click(rows[1]);
  assert.equal(taps.queue.length, 1);
  assert.equal(taps.queue[0].id, 'a');
  click(rows[0]);
  assert.deepEqual(taps.music, [{type: 'toggle'}], 'the current row uses the existing transport');
  show(null, {playing: true, toggle: false});
  assert.equal($('queue').querySelector('[data-track-id="c"]').disabled, true, 'revoked authority: no replay');
  click($('queue').querySelector('[data-track-id="c"]'));
  assert.equal(taps.music.length, 1);
  show(null, null, [[row('c', 0, {current: true, playing: false}), row('a', 1, {selectable: true})], {}]);
  const current = $('queue').querySelector('[data-track-id="c"]');
  assert.equal(current.getAttribute('aria-label'), 'På pause: Song 0 · Artist · Fortsæt');
  assert.equal(current.querySelector('.queue-order img').getAttribute('src'), 'assets/icons/pause-fill.svg');
});

test('a loading queue keeps its height with four inert placeholders; an empty or failed queue says so', () => {
  const {$} = playerShell();
  show(playing, null, [[], {status: 'loading', placeholders: true}]);
  const placeholders = $('queue').querySelectorAll('[data-placeholder]');
  assert.equal(placeholders.length, 4);
  for (const node of placeholders) {
    assert.equal(node.getAttribute('aria-hidden'), 'true');
    assert.equal(node.disabled, true);
  }
  assert.equal($('queue').getAttribute('aria-busy'), 'true');
  assert.equal($('queue-meta').textContent, '');
  show(null, null, [[], {status: 'ready', empty: 'Ingen sange i køen.'}]);
  assert.equal($('queue').querySelectorAll('[data-placeholder]').length, 0);
  assert.equal($('queue').querySelector('.queue-empty').textContent, 'Ingen sange i køen.');
  show(null, null, [[row('a', 1)], {status: 'stale'}]);
  assert.equal($('queue-meta').textContent, 'Køen er ikke opdateret');
  assert.equal($('queue').getAttribute('aria-label'), 'Køen er ikke opdateret');
  show(null, null, [[], {status: 'error', errorKind: 'choice', empty: 'Køvalget blev afvist.'}]);
  assert.equal($('queue-meta').textContent, 'Køvalget blev afvist');
  // Rows without a title are not shown.
  show(null, null, [[row('a', 1, {title: ''}), row('b', 2)], {}]);
  assert.deepEqual([...$('queue').querySelectorAll('.queue-track:not([data-pv-leave])')].map(node => node.dataset.trackId), ['b']);
});

test('a live room shows its playing song first in the queue when the list does not name it; never invented', () => {
  const {$} = playerShell({live: true});
  const vm = {...playing, uri: URI, metadataKnown: true};
  show(vm, {playing: true, toggle: true}, [[row('a', 1)], {status: 'ready'}]);
  const rows = [...$('queue').querySelectorAll('.queue-track:not([data-pv-leave])')];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].dataset.trackId, `current:${URI}`);
  assert.equal(rows[0].getAttribute('aria-label'), 'Spiller nu: A song · An artist · Sæt på pause');
  show({...vm, metadataKnown: false});
  assert.equal($('queue').querySelectorAll('.queue-track:not([data-pv-leave])').length, 1, 'no title: no current row');
  show({...vm, readOnly: true, placement: 'elsewhere'});
  assert.equal($('queue').querySelectorAll('.queue-track:not([data-pv-leave])').length, 1);
});

test('a revoked room clears the drawn queue at once and the next rows draw again', () => {
  const {$} = playerShell();
  show(playing, null, [[row('a', 1), row('b', 2)], {}]);
  assert.equal($('queue').querySelectorAll('.queue-track:not([data-pv-leave])').length, 2);
  act(() => {
    clearQueue();
  });
  assert.equal($('queue').querySelectorAll('.queue-track:not([data-pv-leave])').length, 0);
  show(null, null, [[row('a', 1)], {}]);
  assert.equal($('queue').querySelectorAll('.queue-track:not([data-pv-leave])').length, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// The full player

test('the full player keeps its heading, back, queue, seek, volume and output ids; the mini player stays hidden', () => {
  const {$, taps} = playerShell();
  show(playing, {canVolume: true, volume: 30});
  for (const id of ['player-back', 'detail-title', 'detail-status', 'queue-title', 'queue-meta', 'queue', 'detail-seek',
    'detail-volume', 'detail-output', 'detail-toggle'])
    assert.equal(document.querySelectorAll(`#${id}`).length, 1, id);
  assert.equal($('detail-title').textContent, 'Afspiller');
  assert.equal(document.querySelector('#music-detail .now-playing-detail').hidden, true);
  click($('player-back'));
  assert.equal(taps.back, 1);
  click($('detail-output'));
  assert.equal(taps.speakers.length, 1);
  click($('track'));
  click($('player-detail'));
  assert.equal(taps.detail.length, 2);
});

// ---------------------------------------------------------------------------------------------------------------
// Artwork and the cover tone

class LoadedImage {
  static created = [];
  constructor() {
    LoadedImage.created.push(this);
    this.onload = null;
    this.onerror = null;
  }
  set src(value) {
    this._src = value;
    queueMicrotask(() => (value.includes('broken') ? this.onerror?.() : this.onload?.()));
  }
  get src() {
    return this._src;
  }
  decode() {
    return Promise.resolve();
  }
}

test('a cover shows once decoded; a missing or failed one is the neutral note, with one diagnostic', async () => {
  vi.stubGlobal('Image', LoadedImage);
  const diagnostics = [];
  const {$} = playerShell({live: true, liveTransport: {connected: true, recordDiagnostic: (stage, fields) =>
    diagnostics.push([stage, fields])}});
  show(playing);
  assert.equal($('cover').getAttribute('src'), 'assets/icons/music-note-beamed.svg');
  assert.ok($('cover').classList.contains('live-art-fallback'));
  assert.equal($('cover').alt, 'Omslag ikke tilgængeligt');
  show({...playing, fixtureArt: 'assets/lake.webp', trackId: 't1'});
  await settle();
  assert.equal($('cover').getAttribute('src'), 'assets/lake.webp');
  assert.equal($('cover').alt, 'Albumomslag til A song');
  assert.ok(!$('cover').classList.contains('live-art-fallback'));
  // The shown picture fails later: the note, and one diagnostic row.
  act(() => {
    $('cover').dispatchEvent(new Event('error'));
  });
  await settle();
  assert.equal($('cover').getAttribute('src'), 'assets/icons/music-note-beamed.svg');
  assert.deepEqual(diagnostics, [['artwork', {code: 'resource_error'}]]);
  // A room player cover that cannot load is remembered for that song; redraws keep the note.
  show({...playing, uri: URI, artworkUrl: 'music/player/artwork?v=broken'});
  await settle();
  // (the card's cover and the detail's cover each tried it once)
  assert.equal(diagnostics.length, 3);
  show({...playing, uri: URI, artworkUrl: 'music/player/artwork?v=broken', title: 'A song again'});
  await settle();
  assert.equal($('cover').getAttribute('src'), 'assets/icons/music-note-beamed.svg');
  assert.equal(diagnostics.length, 3, 'not tried again for the same song');
});

test('a radio station shows its logo; the cover tone stays neutral for an unreadable picture', async () => {
  vi.stubGlobal('Image', LoadedImage);
  LoadedImage.created = [];
  const {$} = playerShell();
  show({...playing, sourceKind: 'radio', title: 'P3', fixtureArt: 'assets/radio-p3.svg'});
  await settle();
  assert.equal($('cover').getAttribute('src'), 'assets/radio-p3.svg');
  assert.equal($('cover').alt, 'Stationslogo til P3');
  const card = document.querySelector('aside.player');
  assert.equal(card.style.getPropertyValue('--pv-cover'), 'transparent');
  const tone = LoadedImage.created.find(image => image.crossOrigin === 'anonymous');
  assert.ok(tone, 'the palette is read through an anonymous CORS probe, never the visible image');
  assert.equal(tone.referrerPolicy, 'no-referrer');
  show({active: false});
  assert.equal(card.style.getPropertyValue('--player-cover-tone'), 'transparent');
});

// ---------------------------------------------------------------------------------------------------------------
// No redraw of unchanged content

test('an identical publish writes nothing; a volume-only change touches only the volume', () => {
  const {$} = playerShell();
  const vm = {...playing, progressMs: 84000, durationMs: 187000, positionFresh: true};
  const controls = {playing: true, toggle: true, previous: true, next: true, canVolume: true, volume: 30};
  show(vm, controls, [[row('a', 1, {selectable: true}), row('b', 2)], {status: 'ready'}]);
  const roots = [document.querySelector('aside.player'), $('player-empty'), $('music-detail')];
  const records = [];
  const observer = new MutationObserver(list => records.push(...list));
  for (const node of roots) observer.observe(node, {subtree: true, childList: true, attributes: true,
    characterData: true});
  const firstRow = $('queue').querySelector('[data-track-id="a"]');
  show({...vm}, {...controls}, [[row('a', 1, {selectable: true}), row('b', 2)], {status: 'ready'}]);
  assert.equal(observer.takeRecords().length + records.length, 0);
  show(null, {...controls, volume: 31});
  const touched = [...observer.takeRecords(), ...records];
  assert.ok(touched.length > 0);
  for (const record of touched) {
    const node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
    assert.ok(node.closest('.volume'), `only volume leaves change (${node.id || node.className})`);
  }
  assert.equal($('queue').querySelector('[data-track-id="a"]'), firstRow, 'rows keep their identity');
  observer.disconnect();
});

// ---------------------------------------------------------------------------------------------------------------
// What the shell decides and reads

test('the shell decides whether Find musik opens; until it says, the model decides; the kit button anatomy stays',
  () => {
    const {$} = playerShell();
    show({active: false, canDiscover: false});
    assert.equal($('empty-find-music').disabled, true, 'nothing to discover yet');
    for (const [variant, value] of [['kit', 'button'], ['kitVariant', 'secondary']])
      assert.equal($('empty-find-music').dataset[variant], value);
    act(() => {
      publishFindMusic(true);
    });
    assert.equal($('empty-find-music').disabled, false, 'known suggestions or an account to choose open Find musik');
    act(() => {
      publishFindMusic(false);
    });
    show({active: false, canDiscover: true});
    assert.equal($('empty-find-music').disabled, true, 'the shell said no');
  });

test('Home reads the queue the full player shows (titled rows and the queue status) from the session', () => {
  playerShell();
  show(null, null, [[{id: 'a', title: 'Next', order: 1}, {id: 'b', title: ' ', order: 2}], {status: 'stale'}]);
  assert.deepEqual(playerSession.queueRows().map(row => row.id), ['a']);
  assert.equal(playerSession.queueStatus(), 'stale');
});
