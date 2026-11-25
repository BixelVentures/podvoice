// Vejr's place on the HA panel: podvoice.weather_place (the add-on's podview_weather_city, else HA's location name,
// else the home zone), never the weather entity's friendly name (»Forecast Hjem«).
import {act, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Providers} from '../../app/Providers';
import {fakeWeatherPlace} from '../../lib/ha/fixtures/addon';
import {createFakeHass, FAKE_PANEL} from '../../lib/ha/ha-fixture';
import {transport} from '../../lib/ha/transport';
import {queryClient} from '../../lib/query/client';
import {resetNav, useNav} from '../nav';
import {Shell} from '../Shell';

function mount() {
  const fake = createFakeHass({confirmMs: 20});
  transport.setPanel(FAKE_PANEL);
  transport.setHass(fake.hass);
  transport.resync();
  render(
    <Providers>
      <Shell />
    </Providers>,
  );
  act(() => {
    useNav.getState().push('weather');
  });
  return fake;
}

const place = () => document.getElementById('weather-title')?.textContent;

describe('Vejr’s place', () => {
  beforeEach(() => {
    resetNav();
    queryClient.clear();
  });
  afterEach(() => {
    Object.assign(fakeWeatherPlace, {name: 'Mårslet', source: 'configured_label'});
  });

  it('names the place the add-on was given (»Mårslet«), read once; never the entity’s »Forecast Hjem«', async () => {
    const fake = mount();
    await waitFor(() => {
      expect(place()).toBe('Mårslet');
    });
    expect(screen.queryByText(/Forecast/)).toBeNull();
    expect(fake.calls.filter(call => call.service === 'weather_place')).toHaveLength(1);
    // A configured label is not found automatically: no GeoNames credit.
    expect(screen.queryByText(/GeoNames/)).toBeNull();
  });

  it('HA’s own place stands in when the add-on names none', async () => {
    Object.assign(fakeWeatherPlace, {name: 'Tranbjerg', source: 'ha_location_name'});
    mount();
    await waitFor(() => {
      expect(place()).toBe('Tranbjerg');
    });
  });

  it('with no place at all the hero says »Vejr«, still never the entity’s name', async () => {
    Object.assign(fakeWeatherPlace, {name: '', source: 'none'});
    const fake = mount();
    await waitFor(() => {
      expect(fake.calls.some(call => call.service === 'weather_place')).toBe(true);
    });
    await waitFor(() => {
      expect(place()).toBe('Vejr');
    });
    expect(screen.queryByText(/Forecast/)).toBeNull();
  });
});
