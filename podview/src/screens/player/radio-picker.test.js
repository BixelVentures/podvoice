// Radio's speaker rows in the speaker sheet (SpeakerSheet.tsx draws them from the radio source's outputsModel).
// Ported from the node:test fake-DOM suite (radio117-live-radio-picker) through its first Vitest port against the
// imperative picker. Same behaviour: rows keep their elements (and focus) across passive updates, a cancelled or
// closed sheet drops a waiting station, a late read cannot reopen it, a move closes the sheet and is sent once, the
// playing output is never locked, and a row captured before an owner change cannot act for the new owner.
// Adaptations: the real React sheet on the shell fixture (playerShell) over the real radio source; renderRadioOutputs
// and syncOutputs are gone (the sheet reads the source on every change); the sheet opens and closes the dialog itself.
import assert from 'node:assert/strict';
import {act} from '@testing-library/react';
import {test} from 'vitest';
import {radioOf} from '../radio/source-fixture.js';
import {click, flush, playerShell, settle} from './player-fixture.js';
import {playerSession} from './session';
import {SpeakerPicker} from './speakers';

function fixture() {
  let radio;
  const {host, $} = playerShell({live: true, liveSnapshot: {bootId: 'b', roomId: 'r'},
    liveTransport: {connected: true}, playerView: playerSession}, shell => {
    radio = shell.liveRadio = radioOf(shell);
    shell.liveOutputs = new SpeakerPicker(shell);
  });
  const set = patch => act(() => {
    radio.setState(patch);
  });
  return {host, radio, set, rooms: $('rooms'), options: $('room-options'), doc: document};
}
const rowsOf = options => [...options.children];
const targets = [
  {id: 'a', name: 'Stuen', availability: 'available', selectable: true, default: true},
  {id: 'b', name: 'Køkken', availability: 'available', selectable: true, default: false},
];
const observed = (state, extra = {}) => ({enabled: true, bootId: 'b', roomId: 'r', validUntil: Date.now() / 1000 + 30,
  actions: ['start', 'move'], targets, state, ...extra});
const playing = {status: 'playing', sourceKind: 'radio', stationId: 'p3', targetId: 'a', ownerGeneration: 1,
  generation: 1};
const idle = {status: 'idle', sourceKind: 'none', stationId: null, targetId: null};

test('canonical radio picker retains exact keyed rows and focused control through passive updates', async () => {
  const {set, options, doc} = fixture();
  set({value: observed(idle), outputOpen: true});
  const [first, second] = rowsOf(options);
  second.focus();
  set({value: observed(playing, {targets: targets.map(t => ({...t}))})});
  // Element identity is compared with ok(): a failing equal() would print the whole DOM.
  assert.ok(rowsOf(options)[0] === first, 'the first row is the same element');
  assert.ok(rowsOf(options)[1] === second, 'the second row is the same element');
  assert.ok(doc.activeElement === second, 'focus stays on the second row');
  assert.equal(first.children[2].textContent, 'Aktuelt output');
  set({value: observed(playing, {targets: [targets[0]]})});
  await settle();
  assert.ok(doc.activeElement === doc.querySelector('.speaker-list-refresh'),
    `a removed focused row hands focus to Opdater liste, not ${doc.activeElement?.tagName}`);
});

test('actual native cancel/close clears pending station before later radio output selection', () => {
  const {radio, set, rooms, options} = fixture();
  for (const event of ['cancel', 'close']) {
    set({waitingStation: 'p3', outputOpen: true});
    act(() => {
      rooms.dispatchEvent(new Event(event));
    });
    assert.equal(radio.getState().waitingStation, null);
    assert.equal(radio.getState().outputOpen, false);
  }
  let effects = 0;
  radio.act = () => effects++;
  set({value: observed(idle, {actions: ['start']}), outputOpen: true});
  assert.equal(rooms.open, true, 'radio opens the sheet it needs');
  click(rowsOf(options)[1]);
  assert.equal(effects, 0);
  assert.equal(radio.getState().nextTarget, 'b');
});

test('late refresh after picker cancel cannot reclaim canonical sheet custody', async () => {
  const {radio, rooms, options} = fixture();
  let resolve;
  radio.refresh = () => new Promise(r => resolve = r);
  act(() => {
    radio.openOutputs();
  });
  act(() => {
    rooms.close();
  });
  resolve();
  await settle();
  assert.equal(radio.getState().outputOpen, false);
  assert.equal(rooms.open, false);
  assert.equal(rowsOf(options).length, 0);
});

test('move closes canonical picker and binds readonly progress to exact chosen target while retaining observed '
  + 'destination', () => {
  const {radio, set, rooms, options} = fixture();
  set({value: observed(playing), outputOpen: true});
  const calls = [];
  radio.act = (...args) => calls.push(args);
  click(rowsOf(options)[1]);
  flush();
  assert.equal(rooms.open, false);
  assert.equal(radio.getState().outputOpen, false);
  assert.deepEqual(calls, [['move', {targetId: 'b'}, {kind: 'output', id: 'b'}]]);
  assert.equal(radio.getState().value.state.targetId, 'a');
  assert.equal(radio.getState().nextTarget, 'b');
});

// Green 13/11 17:37: the playing radio's own speaker row was locked in the picker.
test('the radio output that is playing is never locked; choosing it keeps the radio there', () => {
  const {radio, set, rooms, options} = fixture();
  set({value: observed(playing), outputOpen: true});
  const calls = [];
  radio.act = (...args) => calls.push(args);
  const actual = rowsOf(options)[0];
  assert.equal(actual.disabled, false, 'the current output is usable');
  click(actual);
  flush();
  assert.equal(rooms.open, false);
  assert.equal(radio.getState().outputOpen, false);
  assert.deepEqual(calls, [], 'choosing the current output moves nothing');
});

test('closing or owner-resetting radio picker closes the actual dialog, invalidates retained rows and fences captured '
  + 'target callbacks', () => {
  const {radio, set, rooms, options} = fixture();
  set({value: observed(idle, {actions: ['start'], ownerProcessId: 'owner', targets: [...targets,
    {id: 'kitchen', name: 'Kitchen', availability: 'available', selectable: true, default: false}]}),
  outputOpen: true});
  const captured = radio.outputsModel();
  assert.equal(rowsOf(options).length, 3);
  assert.equal(captured.selectable(radio.getState().value.targets[2]), true);
  let effects = 0;
  radio.act = () => effects++;
  act(() => {
    radio.closeOutputs();
  });
  assert.equal(rooms.open, false);
  // The old drawn rows' own callbacks (radioSelectable/radioChoose) went with the rows: they are no longer drawn.
  assert.equal(rowsOf(options).length, 0);
  assert.equal(captured.selectable(radio.getState().value.targets[2]), false, 'a captured row no longer chooses');
  set({epoch: radio.getState().epoch + 1});
  set({value: {...radio.getState().value, ownerProcessId: 'replacement'}, outputOpen: true});
  captured.onChoose(radio.getState().value.targets[2]);
  assert.equal(effects, 0, 'old captured picker callback cannot borrow new owner authority');
  assert.equal(radio.getState().nextTarget, null);
});
