// The Tesla card on Home (HomeVehicleCard.tsx), mounted once in its #home-vehicle card as the shell mounts it and
// driven by what the shell publishes (publishVehicleScene; live, the home read's car through the query cache).
// Ported from the vehicle parts of tests/podview/root-overview-media-cards.test.mjs (battery value, card state, charge
// cue) and root-overview-facts.test.mjs (facts through the shared fact anatomy) when the card moved to React; same
// scenarios and assertions. The legacy fake card took the raw value the shell passed; here every reading goes through
// the admitted observation, so invalid batteries are observations with invalid battery fields.
import {afterEach, beforeEach, test} from 'vitest';
import assert from 'node:assert/strict';
import {act} from 'react';
import {vehicleObservation} from '../../lib/api/vehicle';
import {ingestVehicle} from '../../lib/query/vehicle';
import {connectShell} from '../../lib/store/shell';
import {vehicleFixture} from './model';
import {mountHomeVehicle} from './HomeVehicleCard';
import {publishVehicleScene, resetVehicle} from './state';

const LOCAL = {connected: true, readGranted: true, scope: 'local', sourceScope: 'local'};
let card;
let root;

beforeEach(() => {
  resetVehicle();
  ingestVehicle(null);
  document.body.innerHTML = '<button id="home-vehicle"></button>';
  card = document.getElementById('home-vehicle');
  act(() => {
    root = mountHomeVehicle(card);
  });
});
afterEach(() => {
  act(() => {
    root.unmount();
  });
  connectShell({motion: null});
  resetVehicle();
});

const publish = (scene, options) => {
  act(() => {
    publishVehicleScene({live: false, focus: 'now', connectionDetail: null, chargeContext: LOCAL, vehicleActions: [],
      snapshot: null, ...scene}, options);
  });
};
const live = (value, scene = {}, options) => {
  ingestVehicle(value);
  publish({live: true, ...scene}, options);
};
const observed = (data, at = 100) =>
  vehicleObservation({status: 'observed', source: 'home_assistant_state', observedAt: at, entityIds: ['sensor.car'],
    data: {charging: {}, climate: {}, ...data}});
const value = () => card.querySelector(':scope > span > .resource-value');
const facts = () => [...card.querySelectorAll('.resource-fact')].map(row => ({
  id: row.dataset.factId,
  label: row.querySelector('.resource-fact-label').textContent,
  value: row.querySelector('.resource-fact-value').textContent,
}));

test('S M L Tesla promote the same valid observed battery and omit unknown or invalid readings', () => {
  publish({value: vehicleFixture({charging: true})});
  const shown = value();
  assert.equal(shown.textContent, '72 %');
  assert.equal(shown.hidden, false);
  assert.equal(card.dataset.hasOverviewValue, 'true');
  for (const batteryPercent of [null, NaN, -1, 101, '72']) {
    live(observed({batteryPercent}));
    assert.equal(shown.hidden, true);
    assert.equal(shown.textContent, '');
    assert.equal(card.dataset.hasOverviewValue, 'false');
  }
  publish({value: null});
  assert.equal(shown.hidden, true);
  live(observed({batteryPercent: 0}));
  assert.equal(shown.textContent, '0 %');
  assert.equal(shown.hidden, false);
  for (const size of ['s', 'm', 'l']) {
    card.dataset.kitSize = size;
    live(observed({batteryPercent: 0}, 101));
    assert.equal(shown.hidden, false);
    assert.equal(shown.textContent, '0 %');
    assert.strictEqual(value(), shown);
    for (const batteryPercent of [null, NaN, -1, 101, '72']) {
      live(observed({batteryPercent}, 102));
      assert.equal(shown.hidden, true);
      assert.equal(shown.textContent, '');
    }
  }
});

test('Tesla Card unavailable state reflects the actual model mode and identical render does not rewrite it', () => {
  const records = new MutationObserver(() => {});
  records.observe(card, {attributes: true, attributeFilter: ['data-kit-state']});
  publish({value: null});
  assert.equal(card.dataset.kitState, 'unavailable');
  assert.equal(records.takeRecords().length, 1);
  publish({value: null});
  assert.equal(records.takeRecords().length, 0);
  publish({value: vehicleFixture({charging: true})});
  assert.equal(card.dataset.kitState, 'ready');
  assert.equal(records.takeRecords().length, 1);
  records.disconnect();
});

test('actual overview charge cue shares source gating, preserves value node and cancels on hidden or foreign owners',
  () => {
    const calls = [];
    const context = {connected: true, readGranted: true, scope: 'current', sourceScope: 'current'};
    const sample = (at, percent = 71) =>
      vehicleObservation({status: 'observed', source: 'home_assistant_state', observedAt: at,
        entityIds: ['sensor.car_charge'], data: {batteryPercent: percent, charging: {status: 'charging'}, climate: {}}});
    connectShell({motion: {animate(node, frames, duration) {
      const animation = {cancelled: false, cancel() { this.cancelled = true; }};
      calls.push({node, frames, duration, animation, text: node.textContent});
      return animation;
    }}});
    live(sample(100), {chargeContext: context});
    const shown = value();
    assert.equal(calls.length, 0);
    live(sample(101, 72), {chargeContext: context});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].node, shown);
    assert.equal(calls[0].text, '72 %');
    assert.equal(calls[0].duration, 120);
    assert.deepEqual(calls[0].frames, [{opacity: 0.65}, {opacity: 1}]);
    live(sample(101, 72), {chargeContext: context});
    live(sample(102, 72), {chargeContext: context});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].animation.cancelled, false);
    live(sample(103, 73), {chargeContext: context, focus: 'vehicle'});
    assert.equal(calls[0].animation.cancelled, true);
    assert.equal(calls.length, 1);
    live(sample(103, 73), {chargeContext: context}, {viewChanged: true});
    assert.equal(calls.length, 1);
    live(sample(104, 74), {chargeContext: context});
    assert.equal(calls.length, 2);
    live(sample(105, 75), {chargeContext: {...context, sourceScope: 'foreign'}});
    assert.equal(calls[1].animation.cancelled, true);
    assert.equal(calls.length, 2);
    assert.equal(value(), shown);
    assert.equal(shown.textContent, '75 %');
  });

test('music/vehicle/weather/timer adapters preserve real known metadata through the shared fact port', () => {
  publish({value: vehicleFixture({charging: true})});
  const car = facts();
  assert.equal(car.find(row => row.id === 'battery').value, '72 %');
  assert.equal(car.find(row => row.id === 'power').value, '11 kW');
  assert(car.some(row => row.id === 'ends'));
  assert.equal(card.dataset.factCount, String(car.length));
  assert.equal(card.dataset.hasFacts, 'true');
});

test('radio and empty/stale variants omit unsupported program/album/future-time fields', () => {
  live(null);
  assert.deepEqual(facts(), []);
  assert.equal(card.querySelector('.resource-facts').hidden, true);
  assert.equal(card.querySelector('.resource-context').hidden, true);
});

// The status line under the title (K-Widget tesla): an offline car keeps its last-known access (»sidstkendt«).
test('an offline car keeps its last-known lock and trunk under the title, never the battery over Ikke forbundet', () => {
  const status = () => card.querySelector('#home-vehicle-status').textContent;
  publish({value: null});
  assert.equal(status(), 'Ikke forbundet');
  const offline = vehicleObservation({status: 'observed', source: 'home_assistant_state', observedAt: 100,
    entityIds: ['lock.car'], connection: {state: 'offline', since: null},
    data: {locked: false, trunk: 'open', batteryPercent: 81, charging: {}, climate: {}}});
  live(offline);
  assert.equal(status(), 'Ulåst · bagagerum åbent');
  live(observed({locked: true, trunk: 'open'}));
  assert.equal(status(), 'Bagagerum åbent');
  live(observed({locked: true}));
  assert.equal(status(), 'Låst');
});
