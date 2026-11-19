// Ported from tests/podview/radio117-live-radio-picker.test.mjs (node:test with a minimal fake DOM) to Vitest with a
// real DOM (happy-dom) when the speaker picker moved to React. Same assertions; each port was first run against the
// old speaker-output-view.js in the same real DOM. Adaptations for the real
// DOM: the fake nodes became the real shell (mountSpeakers) with the real LiveRadioView; the fake child arrays became
// [...children]; the fake `emit('click')` on a row became a real click (click(row)); `rooms.emit('cancel'|'close')`
// became a dispatched cancel/close event; the fake `rooms.open = true` and `rooms.close()` are the real dialog's
// (close() fires the same close event); the fake focus() and activeElement are the document's.
// 'closing or owner-resetting radio picker…' came from tests/podview/radio117-live-radio.test.mjs when live radio
// stopped clearing the picker's rows itself (it now asks the picker: closeRadioSheet): the fake liveOutputs became
// the real picker, the captured view model is taken from its renderRadioOutputs, and `cleared` is the rows' removal.
import assert from 'node:assert/strict';
import {test} from 'vitest';
import {LiveRadioView} from '../../../live-radio-view.js';
import {click, mountSpeakers} from './player-fixture.js';

function fixture() {
  const {host, view, $} = mountSpeakers({
    liveSnapshot: {bootId: 'b', roomId: 'r'}, liveTransport: {connected: true}, playerView: {},
  });
  const radio = host.liveRadio = new LiveRadioView(host);
  radio.render = () => {};
  const nodes = {rooms: $('rooms'), 'room-options': $('room-options'), 'room-title': $('room-title')};
  return {host, radio, view, nodes, doc: document};
}
const rowsOf = nodes => [...nodes['room-options'].children];
const targets = [
  {id: 'a', name: 'Stuen', availability: 'available', selectable: true, default: true},
  {id: 'b', name: 'Køkken', availability: 'available', selectable: true, default: false},
];

test('canonical radio picker retains exact keyed rows and focused control through passive updates', () => {
  const {view, nodes, doc} = fixture(), model = {targets, selectable: () => true};
  view.renderRadioOutputs(model);
  const [first, second] = rowsOf(nodes);
  second.focus();
  view.renderRadioOutputs({...model, targets: targets.map(t => ({...t})), actualTargetId: 'a'});
  assert.equal(rowsOf(nodes)[0], first);
  assert.equal(rowsOf(nodes)[1], second);
  assert.equal(doc.activeElement, second);
  assert.equal(first.children[2].textContent, 'Aktuelt output');
  view.renderRadioOutputs({...model, targets: [targets[0]]});
  assert.equal(doc.activeElement, view.refresh);
});

test('actual native cancel/close clears pending station before later radio output selection', () => {
  const {radio, view, nodes} = fixture();
  view.bindRadioClose();
  for (const event of ['cancel', 'close']) {
    radio.waitingStation = 'p3';
    radio.outputOpen = true;
    nodes.rooms.dispatchEvent(new Event(event));
    assert.equal(radio.waitingStation, null);
    assert.equal(radio.outputOpen, false);
  }
  let effects = 0;
  radio.act = () => effects++;
  radio.value = {enabled: true, bootId: 'b', roomId: 'r', validUntil: Date.now() / 1000 + 30, actions: ['start'],
    targets, state: {status: 'idle', sourceKind: 'none', stationId: null, targetId: null}};
  radio.outputOpen = true;
  nodes.rooms.open = true;
  radio.syncOutputs();
  click(rowsOf(nodes)[1]);
  assert.equal(effects, 0);
  assert.equal(radio.nextTarget, 'b');
});

test('late refresh after picker cancel cannot reclaim canonical sheet custody', async () => {
  const {radio, nodes} = fixture();
  let resolve;
  radio.refresh = () => new Promise(r => resolve = r);
  radio.openOutputs();
  nodes.rooms.close();
  nodes['room-options'].replaceChildren();
  resolve();
  await Promise.resolve();
  assert.equal(radio.outputOpen, false);
  assert.equal(rowsOf(nodes).length, 0);
});

test('move closes canonical picker and binds readonly progress to exact chosen target while retaining observed '
  + 'destination', () => {
  const {radio, view, nodes} = fixture();
  view.bindRadioClose();
  radio.value = {enabled: true, bootId: 'b', roomId: 'r', validUntil: Date.now() / 1000 + 30,
    actions: ['start', 'move'], targets,
    state: {status: 'playing', sourceKind: 'radio', stationId: 'p3', targetId: 'a', ownerGeneration: 1}};
  radio.outputOpen = true;
  nodes.rooms.open = true;
  const calls = [];
  radio.act = (...args) => calls.push(args);
  radio.syncOutputs();
  click(rowsOf(nodes)[1]);
  assert.equal(nodes.rooms.open, false);
  assert.equal(radio.outputOpen, false);
  assert.deepEqual(calls, [['move', {targetId: 'b'}, {kind: 'output', id: 'b'}]]);
  assert.equal(radio.value.state.targetId, 'a');
  assert.equal(radio.nextTarget, 'b');
});

// Green 13/11 17:37: the playing radio's own speaker row was locked in the picker.
test('the radio output that is playing is never locked; choosing it keeps the radio there', () => {
  const {radio, view, nodes} = fixture();
  view.bindRadioClose();
  radio.value = {enabled: true, bootId: 'b', roomId: 'r', validUntil: Date.now() / 1000 + 30,
    actions: ['start', 'move'], targets,
    state: {status: 'playing', sourceKind: 'radio', stationId: 'p3', targetId: 'a', ownerGeneration: 1}};
  radio.outputOpen = true;
  nodes.rooms.open = true;
  const calls = [];
  radio.act = (...args) => calls.push(args);
  radio.syncOutputs();
  const actual = rowsOf(nodes)[0];
  assert.equal(actual.disabled, false, 'the current output is usable');
  click(actual);
  assert.equal(nodes.rooms.open, false);
  assert.equal(radio.outputOpen, false);
  assert.deepEqual(calls, [], 'choosing the current output moves nothing');
});

test('closing or owner-resetting radio picker closes the actual dialog, invalidates retained rows and fences captured '
  + 'target callbacks', () => {
  const {radio, view, nodes} = fixture();
  radio.value = {enabled: true, bootId: 'b', roomId: 'r', validUntil: Date.now() / 1000 + 30, actions: ['start'],
    ownerProcessId: 'owner', targets: [...targets, {id: 'kitchen', name: 'Kitchen', availability: 'available',
      selectable: true, default: false}], state: {status: 'idle', sourceKind: 'none', stationId: null, targetId: null}};
  let captured, effects = 0;
  const render = view.renderRadioOutputs.bind(view);
  view.renderRadioOutputs = vm => {
    captured = vm;
    render(vm);
  };
  nodes.rooms.open = true;
  radio.outputOpen = true;
  radio.syncOutputs();
  const button = rowsOf(nodes)[2];
  assert.equal(captured.selectable(radio.value.targets[2]), true);
  radio.act = () => effects++;
  radio.closeOutputs();
  assert.equal(nodes.rooms.open, false);
  assert.equal(button.disabled, true);
  assert.equal(button.radioSelectable(), false);
  button.radioChoose();
  assert.equal(rowsOf(nodes).length, 0);
  assert.equal(view.radioRows.size, 0);
  assert.equal(view.radioSheet, false);
  radio.epoch++;
  radio.value = {...radio.value, ownerProcessId: 'replacement'};
  radio.outputOpen = true;
  nodes.rooms.open = true;
  captured.onChoose(radio.value.targets[2]);
  assert.equal(effects, 0, 'old captured picker callback cannot borrow new owner authority');
  assert.equal(radio.nextTarget, undefined);
});
