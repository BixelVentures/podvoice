// Weather model tests (formerly tests/podview node:test suites), on the TypeScript model.
import assert from 'node:assert/strict';
import {test} from 'vitest';
import {weatherAdvice} from './observation.ts';

const now = Date.parse('2026-10-15T08:45:00Z');
const weather = {
  source: 'Home Assistant / Met.no',
  retrievedAt: '2026-10-15T08:44:00Z',
  forecastType: 'hourly',
  units: {temperature: '°C', windSpeed: 'km/h', precipitation: 'mm'},
  forecast: [{datetime: '2026-10-15T09:00:00Z', temperature: 12}],
};
const evidence = {field: 'temperature', value: 12, unit: '°C', normalizedValue: 12, normalizedUnit: '°C'};
const advice = {
  id: 'advice:' + 'a'.repeat(32),
  ruleVersion: 'next-hour-clothing-v1',
  source: weather.source,
  retrievedAt: weather.retrievedAt,
  periodTime: '2026-10-15T09:00:00Z',
  evidence: [evidence],
  kind: 'practical_guidance',
  scope: 'next_hourly_period',
  summary: 'En jakke kan være rar at have med.',
  children: 'Tag en jakke med.',
  validUntil: Date.parse('2026-10-15T08:59:00Z') / 1000,
};

test('weather advice keeps the exact forecast source and expires without renewing age', () => {
  assert.ok(weatherAdvice(advice, weather, now));
  assert.equal(weatherAdvice(advice, weather, advice.validUntil * 1000), null);
  assert.equal(weatherAdvice({...advice, validUntil: Date.parse('2026-10-15T09:00:00Z') / 1000}, weather, now), null);
});

test('weather advice rejects source substitution, daily highs, absent evidence and changed forecast values', () => {
  assert.equal(weatherAdvice({...advice, source: 'another provider'}, weather, now), null);
  assert.equal(weatherAdvice(advice, {...weather, forecastType: 'daily'}, now), null);
  assert.equal(weatherAdvice(advice, {...weather, forecast: [{datetime: advice.periodTime}]}, now), null);
  const changed = {...weather, forecast: [{datetime: advice.periodTime, temperature: 20}]};
  assert.equal(weatherAdvice(advice, changed, now), null);
  assert.equal(weatherAdvice({...advice, evidence: [{...evidence, unit: '°F'}]}, weather, now), null);
});

test('weather advice rejects coerced expiry, future retrieval, loose fields and false normalization', () => {
  const changes = [
    {validUntil: String(advice.validUntil)},
    {privateUrl: 'http://local.invalid/'},
    {evidence: [{...evidence, normalizedValue: 999}]},
    {evidence: [{...evidence, html: '<img>'}]},
  ];
  for (const change of changes) assert.equal(weatherAdvice({...advice, ...change}, weather, now), null);
  const future = '2026-10-15T08:46:00Z';
  assert.equal(weatherAdvice({...advice, retrievedAt: future}, {...weather, retrievedAt: future}, now), null);
  assert.equal(weatherAdvice(advice, {...weather, forecast: [...weather.forecast, ...weather.forecast]}, now), null);
  assert.equal(weatherAdvice(advice, weather, NaN), null);
  assert.equal(weatherAdvice(advice, null, now), null);
});

test('weather advice checks source unit arithmetic and keeps quantity distinct from probability', () => {
  const cases: [string, string, number, number, string, string | null][] = [
    ['temperature', '°F', 42.8, 6, '°C', 'temperature'],
    ['wind_speed', 'km/h', 36, 10, 'm/s', 'windSpeed'],
    ['precipitation', 'in', 1 / 25.4, 1, 'mm', 'precipitation'],
    ['precipitation_probability', '%', 50, 50, '%', null],
  ];
  for (const [field, unit, value, normalizedValue, normalizedUnit, unitKey] of cases) {
    const raw = {
      ...weather,
      units: {...weather.units, ...(unitKey ? {[unitKey]: unit} : {})},
      forecast: [{datetime: advice.periodTime, [field]: value}],
    };
    const fact = {field, unit, value, normalizedValue, normalizedUnit};
    const item = {...advice, evidence: [fact]};
    assert.ok(weatherAdvice(item, raw, now));
    assert.equal(weatherAdvice({...item, evidence: [{...fact, normalizedValue: normalizedValue + 1}]}, raw, now), null);
  }
});

test('real server microsecond timestamps share the browser millisecond boundary', () => {
  const retrievedAt = '2026-10-15T08:44:00.123456+00:00';
  const periodTime = '2026-10-15T09:00:00.123456+00:00';
  const raw = {...weather, retrievedAt, forecast: [{...weather.forecast[0], datetime: periodTime}]};
  const item = {...advice, retrievedAt, periodTime, validUntil: Date.parse('2026-10-15T08:59:00Z') / 1000 + 0.123456};
  // Match exact Python timestamp arithmetic instead of re-dating source data.
  assert.ok(weatherAdvice(item, raw, now));
});
