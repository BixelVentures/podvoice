// A volume gesture belongs to the source shown at its first input (the session's witness, session.ts) and is one
// volume tap for that source when released (the Volume range in Player.tsx). Moved from
// tests/podview/radio117-volume-gesture.test.mjs (which bound PlayerView's listeners to fake inputs and painted with
// player-controls.js) onto the real React player over a radio owner stub; the taps reach the shell's own music()
// routing (cut from widget-view.js as before). Same assertions: one commit per gesture for its owner, any owner,
// transport or access replacement before release sends nothing, a captured witness cannot bypass the routing, a
// keyboard gesture keeps its source, passive paints keep a live gesture's value and drop a lost one.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {act, fireEvent} from '@testing-library/react';
import {test} from 'vitest';
import {createStore} from 'zustand/vanilla';
import {playerShell} from './player-fixture.js';
import {beginVolumeGesture, playerSession} from './session';

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../widget-view.js'), 'utf8');
const music = new Function('localRadioTransition', `return ({${source.slice(source.indexOf(' music(event){'),
  source.indexOf('\n build(){')).trim()}}).music;`)(() => {
  throw Error('unexpected local dispatch');
});

function fixture(kind = 'radio') {
  let current = kind, allowed = true, volume = 41;
  const effects = [];
  // The radio owner as the player reads it: a store whose model and controls follow `volume` and `allowed`.
  const radio = Object.assign(createStore(() => ({tick: 0})), {
    value: {bootId: 'boot', roomId: 'room', ownerProcessId: 'radio-manager-1',
      state: {targetId: 'radio-A', ownerGeneration: 1}},
    ownsPlayer: () => current === 'radio',
    hasSource: () => current === 'radio',
    presentsPlayer: () => current === 'radio',
    pendingStart: () => null,
    progress: () => null,
    can: () => allowed,
    playerModel: () => ({active: true, sourceKind: 'radio', playing: true, fresh: true, title: 'P3',
      artist: 'Direkte radio', target: 'Stuen', volume, canOutput: true, canDiscover: true, canSeek: false,
      feedback: null}),
    controls: () => ({sourceKind: 'radio', playing: true, toggle: true, blocked: false, loadingControlId: null,
      volume, canVolume: allowed}),
    closeOutputs() {},
    outputsModel: () => null,
    control(event) {
      effects.push(['radio', event.type, Number(event.value)]);
    },
  });
  const getState = radio.getState;
  radio.getState = () => ({...getState(), value: radio.value, outputOpen: false});
  const {host, $} = playerShell({live: true, liveSnapshot: {bootId: 'boot', roomId: 'room'},
    liveTransport: {connected: true, generation: 1}, playerView: playerSession,
    liveMedia: {playback: {state: 'playing', config_entry_id: 'account', owner_epoch: 'spotify-1',
      target: {id: 'spotify-target'}, roomBinding: 'native-room'}, render() {}},
    liveControls: {optimisticPlaying: observed => observed, musicContext: () => allowed ? {key: 'fresh'} : null,
      musicIntent(action, args) {
        effects.push(['spotify', action, args.percent]);
      }},
    liveRadio: radio});
  host.music = music.bind(host);
  const input = $('volume');
  return {host, radio, input, effects, $,
    setKind: value => {
      current = value;
    },
    setAllowed: value => {
      allowed = value;
    },
    // A passive repaint of the player with radio's volume.
    paint: (next = 41) => act(() => {
      volume = next;
      radio.setState(state => ({tick: state.tick + 1}));
    })};
}
const draft = (input, value) => {
  fireEvent.input(input, {target: {value: String(value)}});
};
const release = input => act(() => {
  input.dispatchEvent(new Event('change', {bubbles: true}));
});

test('same radio owner commits once and does not write to the independent source', () => {
  const f = fixture(), input = f.input;
  fireEvent.pointerDown(input);
  draft(input, 49);
  release(input);
  assert.deepEqual(f.effects, [['radio', 'volume', 49]]);
});

for (const boundary of ['transport', 'transport-generation', 'radio-process', 'target', 'owner-generation', 'access'])
  test(`radio gesture rejects ${boundary} replacement before commit`, () => {
    const f = fixture(), input = f.input;
    fireEvent.pointerDown(input);
    draft(input, 65);
    if (boundary === 'transport') f.host.liveTransport = {...f.host.liveTransport};
    if (boundary === 'transport-generation') f.host.liveTransport.generation++;
    if (boundary === 'radio-process') f.radio.value.ownerProcessId = 'radio-manager-2';
    if (boundary === 'target') f.radio.value.state.targetId = 'radio-B';
    if (boundary === 'owner-generation') f.radio.value.state.ownerGeneration++;
    if (boundary === 'access') f.setAllowed(false);
    release(input);
    assert.deepEqual(f.effects, []);
  });

test('a retained captured radio event cannot bypass host routing after a source replacement', () => {
  const f = fixture();
  const witness = beginVolumeGesture('volume');
  f.setKind('music');
  f.host.music({type: 'volume', value: 70, volumeSource: witness});
  assert.deepEqual(f.effects, []);
});

test('keyboard gesture keeps its source until keyup and does not adopt a replacement on repeat input', () => {
  const f = fixture(), input = f.input;
  fireEvent.keyDown(input, {key: 'ArrowRight'});
  draft(input, 42);
  release(input);
  f.setKind('music');
  draft(input, 43);
  release(input);
  assert.deepEqual(f.effects, [['radio', 'volume', 42]]);
  fireEvent.keyUp(input, {key: 'ArrowRight'});
});

test('same radio execution owner survives passive timestamp and content updates during a gesture', () => {
  const f = fixture(), input = f.input;
  fireEvent.pointerDown(input);
  draft(input, 46);
  f.radio.value.retrievedAt = Date.now() / 1000;
  f.radio.value.state.observedAt = Date.now() / 1000;
  f.host.liveMedia.playback = {...f.host.liveMedia.playback, poll_sequence: 99, observedAt: new Date().toISOString(),
    item: {uri: `spotify:track:${'2'.repeat(22)}`, name: 'Next song', artwork: null}};
  f.paint();
  release(input);
  assert.deepEqual(f.effects, [['radio', 'volume', 46]]);
});

test('passive radio paint retains the current native gesture until one explicit commit', () => {
  const f = fixture(), input = f.input;
  fireEvent.pointerDown(input);
  draft(input, 31);
  f.paint();
  assert.equal(input.value, '31');
  assert.equal(input.getAttribute('aria-valuetext'), '31 %');
  release(input);
  assert.deepEqual(f.effects, [['radio', 'volume', 31]]);
});

for (const boundary of ['owner', 'access'])
  test(`passive radio paint drops a gesture after ${boundary} changes`, () => {
    const f = fixture(), input = f.input;
    fireEvent.pointerDown(input);
    draft(input, 31);
    if (boundary === 'owner') f.radio.value.state.ownerGeneration++;
    else f.setAllowed(false);
    f.paint();
    assert.equal(input.value, '41');
    assert.equal(input.getAttribute('aria-valuetext'), '41 %');
    release(input);
    assert.deepEqual(f.effects, []);
  });

test('unchanged radio pointer release permits later passive volume paint', () => {
  const f = fixture(), input = f.input;
  fireEvent.pointerDown(input);
  fireEvent.pointerUp(input);
  f.paint(52);
  assert.equal(input.value, '52');
  assert.equal(input.getAttribute('aria-valuetext'), '52 %');
  assert.deepEqual(f.effects, []);
});

test('radio pointer release retains custody for the subsequent native change', () => {
  const f = fixture(), input = f.input;
  fireEvent.pointerDown(input);
  draft(input, 31);
  f.paint();
  fireEvent.pointerUp(input);
  release(input);
  assert.deepEqual(f.effects, [['radio', 'volume', 31]]);
});
