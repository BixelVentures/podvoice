// Weather model tests (formerly tests/podview node:test suites), on the TypeScript model.
import assert from 'node:assert/strict';
import {test} from 'vitest';
import {weatherObservation} from './observation.ts';
import {liveWeatherModel} from './view-model.ts';

const raw = (): Record<string, unknown> & {current: {temperature: number; condition: string}} => ({
  source: 'Home Assistant / Met.no',
  location: 'hjemmet',
  retrievedAt: new Date().toISOString(),
  observedAt: Date.now() / 1000,
  units: {temperature: '°C', precipitation: 'mm', windSpeed: 'km/h'},
  current: {temperature: 13.9, condition: 'cloudy'},
  forecastType: 'hourly',
  forecast: [{datetime: new Date(Date.now() + 3600000).toISOString(), temperature: 14.7}],
  displayLocation: {name: 'Mårslet', source: 'configured_label'},
});

test('configured local city changes display title, preserves actual weather source location/provenance', () => {
  const source = raw();
  const observed = weatherObservation(source);
  const model = liveWeatherModel(observed);
  assert.equal(model.title, 'Mårslet');
  assert.equal(observed.location, 'hjemmet');
  assert.deepEqual(observed.displayLocation, {name: 'Mårslet', source: 'configured_label'});
  assert.equal(model.source, 'Kilde: Met.no');
  assert.equal(model.current?.temperature, '14°');
  assert.equal(source.current.temperature, 13.9);
});

test('absent or malformed city never claims automatic location', () => {
  const labels = [
    undefined,
    {name: 'Mårslet', source: 'ha_address'},
    {name: 'Mår\\nslet', source: 'configured_label', extra: true},
  ];
  for (const label of labels) {
    const source = raw();
    source.displayLocation = label;
    const observed = weatherObservation(source);
    assert.equal(liveWeatherModel(observed).title, 'hjemmet');
    assert.equal(observed.displayLocation, undefined);
  }
});
