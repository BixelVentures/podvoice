import test from 'node:test';
import assert from 'node:assert/strict';
import {robotCare} from '../../podvoice/gatekeeper/static/podview/robot-observation.js';

// Lærred »A-Robot« Vedligehold: only the robot's own care counters, in the product's order, due at or below 0.
const now = 1_800_000_000;
const row = (key, value, unit = 'h', extra = {}) => ({key, entityId: `sensor.${key}`, value, unit, updatedAt: now - 10,
 retrievedAt: now, stale: false, ...extra});
const robot = (items, extra = {}) => ({id: 'vacuum.q', status: 'docked', stale: false,
 telemetry: {status: 'observed', items}, ...extra});

test('care rows keep the product order and labels and flag a counter at or below 0 as due', () => {
 const care = robotCare(robot([row('filter_time_left', 0), row('battery', 80, '%'), row('main_brush_time_left', 142),
  row('side_brush_time_left', -3)]), now);
 assert.deepEqual(care.map(item => item.label), ['Hovedbørste', 'Sidebørste', 'Filter']);
 assert.deepEqual(care.map(item => item.due), [false, true, true]);
 assert.equal(care[0].value, '142 timer tilbage');
 assert.equal(care[1].value, '3 timer over interval');
});

test('no telemetry, no care rows: nothing is invented for a robot that reports none', () => {
 assert.deepEqual(robotCare({id: 'vacuum.q', status: 'docked', telemetry: {status: 'unavailable', items: []}}, now), []);
 assert.deepEqual(robotCare(robot([row('battery', 80, '%')]), now), []);
});

test('an old reading stays visible but is marked stale', () => {
 const [item] = robotCare(robot([row('filter_time_left', 12, 'h', {updatedAt: now - 3600})]), now);
 assert.equal(item.stale, true);
 assert.equal(robotCare(robot([row('filter_time_left', 12)], {stale: true}), now)[0].stale, true);
});
