// Ported from tests/podview/root-robot-resource-detail, root-robot-setting-labels and root-robot-audit-metadata
// (node:test; the canonical-next-* copies were identical). Same assertions; the cases on the wall page's own
// observation parser (robotObservation) went with that parser.
import {expect, test} from 'vitest';
import {robotDetailMetadata, robotFacts, robotValue} from './observation';
import type {TelemetryRow} from './observation';

const now = Date.now() / 1000;
const row = (key: string, value: unknown, unit: string | null = null, stale = false): TelemetryRow =>
  ({key, value, unit, updatedAt: now - (stale ? 600 : 0), stale});

test('only known remaining-care counters show interval meaning with admitted source units', () => {
  const cases: [string, number, string][] = [['h', -120.9, '120,9 timer over interval'], ['h', 1, '1 time tilbage'],
    ['min', -80.1, '80,1 min over interval'], ['s', -120, '2 min over interval'], ['h', 0, '0 timer tilbage']];
  for (const [unit, value, expected] of cases) expect(robotValue(row('side_brush_time_left', value, unit))).toBe(expected);
  expect(robotValue(row('cleaning_time', -120, 's'))).toBe('-2 min');
  expect(robotValue(row('total_cleaning_time', 10, 'h'))).toBe('10 timer');
  expect(robotValue(row('future_time_left', -12, 'h'))).toBe('-12 timer');
});

test('error and clock display is exact-role and unknown-safe', () => {
  expect(robotValue(row('vacuum_error', 'none'))).toBe('Ingen');
  expect(robotValue(row('dock_error', 'ok'))).toBe('Ingen');
  expect(robotValue(row('dock_error', 'water_empty'))).toBe('Mangler vand');
  for (const value of ['future_error', 'constructor', '__proto__', 'toString']) {
    expect(robotValue(row('dock_error', value))).toBe(value);
  }
  expect(robotValue(row('vacuum_error', 'water_empty'))).toBe('water_empty');
  expect(robotValue(row('dnd_start_time', '22:00:00'))).toBe('22:00');
  expect(robotValue(row('dnd_end_time', '08:00:03'))).toBe('08:00:03');
  expect(robotValue(row('current_room', '22:00:00'))).toBe('22:00:00');
});

test('every detail row has one semantic group, stale sources stay quiet and canonical values unchanged', () => {
  const items = [row('filter_time_left', -80.1, 'h', true), row('dock_error', 'water_empty', null, true),
    row('dnd_start_time', '22:00:00'), row('total_cleaning_count', 20), row('battery', 90, '%')];
  const device = {status: 'docked', telemetry: {status: 'observed', items}};
  const before = JSON.stringify(device);
  const facts = robotFacts(device, now);
  expect(facts.details.map(fact => fact.group)).toEqual(['maintenance', 'dock', 'settings', 'maintenance', 'dock']);
  expect(facts.attention).toEqual([]);
  expect(facts.details[0]?.stale).toBe(true);
  expect(facts.details[0]?.value).toBe('80,1 timer over interval');
  expect(JSON.stringify(device)).toBe(before);
});

test('a fresh known dock error is translated without making stale reports current', () => {
  const telemetry = {status: 'observed', items: [row('dock_error', 'water_empty')]};
  expect(robotFacts({status: 'docked', telemetry}, now).attention).toEqual(['Dockfejl: Mangler vand']);
  expect(robotFacts({status: 'docked', stale: true, telemetry}, now).attention).toEqual([]);
});

const SETTINGS: Record<string, Record<string, string>> = {
  cleaning_mode: {vacuum: 'Støvsugning', vac_and_mop: 'Støvsugning og gulvvask', mop: 'Gulvvask', custom: 'Tilpasset'},
  mop_intensity: {off: 'Fra', low: 'Lav', medium: 'Mellem', high: 'Høj', custom_water_flow: 'Tilpasset vandmængde',
    custom: 'Tilpasset'},
  mop_mode: {standard: 'Standard', deep: 'Grundig', deep_plus: 'Ekstra grundig', fast: 'Hurtig', custom: 'Tilpasset'},
  dust_collection_mode: {smart: 'Smart', light: 'Let', balanced: 'Balanceret', max: 'Maksimal'},
};

for (const [key, values] of Object.entries(SETTINGS)) {
  test(`known ${key} values use the Danish setting vocabulary`, () => {
    for (const [value, expected] of Object.entries(values)) expect(robotValue({key, value})).toBe(expected);
  });
}

test('unknown and prototype-like values stay literal within each setting role', () => {
  for (const key of Object.keys(SETTINGS)) {
    for (const value of ['future_mode', 'constructor', 'toString', '__proto__', 'Kitchen custom_map']) {
      expect(robotValue({key, value})).toBe(value);
    }
  }
});

test('a known value under the wrong setting role is never translated', () => {
  for (const [key, value] of [['cleaning_mode', 'deep_plus'], ['mop_mode', 'custom_water_flow'],
    ['mop_intensity', 'vac_and_mop'], ['dust_collection_mode', 'vac_and_mop']] as const) {
    expect(robotValue({key, value})).toBe(value);
  }
});

test('room, map, status and unrelated telemetry keep their presentation', () => {
  expect(robotValue({key: 'current_room', value: 'smart'})).toBe('smart');
  expect(robotValue({key: 'selected_map', value: 'deep_plus'})).toBe('deep plus');
  expect(robotValue({key: 'status', value: 'vac_and_mop'})).toBe('vac and mop');
  expect(robotValue({key: 'volume', value: 35, unit: '%'})).toBe('35 %');
});

test('an ongoing wash at a coarse docked state does not turn current measurements into a previous result', () => {
  const at = Date.now() / 1000;
  const items = [{key: 'cleaning_area', value: 12.5, unit: 'm²', updatedAt: at, stale: false},
    {key: 'cleaning_time', value: 600, unit: 's', updatedAt: at, stale: false},
    {key: 'in_cleaning', value: true, updatedAt: at, stale: false}];
  const telemetry = {status: 'observed', items};
  expect(robotDetailMetadata({status: 'docked', battery: 76, telemetry}, at)).toBe('Batteri 76 %');
  const withoutJob = {...telemetry, items: items.filter(item => item.key !== 'in_cleaning')};
  expect(robotDetailMetadata({status: 'docked', battery: 76, localJob: {active: true}, telemetry: withoutJob}, at))
    .toBe('Batteri 76 %');
  expect(robotDetailMetadata({status: 'cleaning', battery: 76, telemetry}, at)).toBe('Batteri 76 % · 12,5 m² · 10 min');
});
