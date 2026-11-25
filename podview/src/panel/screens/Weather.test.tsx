// Vejr's place on the HA panel: podvoice.weather_place (the add-on's podview_weather_city, else HA's location name,
// else the home zone), never the weather entity's friendly name (»Forecast Hjem«).
import {act, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Providers} from '../../app/Providers';
import {fakeWeatherAdvice, fakeWeatherPlace, resetFakeWeatherAdvice} from '../../lib/ha/fixtures/addon';
import {createFakeHass, FAKE_PANEL} from '../../lib/ha/ha-fixture';
import {transport} from '../../lib/ha/transport';
import {queryClient} from '../../lib/query/client';
import {resetNav, useNav} from '../nav';
import {Shell} from '../Shell';

function mount(open = true) {
  const fake = createFakeHass({confirmMs: 20});
  transport.setPanel(FAKE_PANEL);
  transport.setHass(fake.hass);
  transport.resync();
  render(
    <Providers>
      <Shell />
    </Providers>,
  );
  if (open) {
    act(() => {
      useNav.getState().push('weather');
    });
  }
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

// A-Vejr's AI advice (DECISIONS §9): podvoice.weather_advice, lazy, started once per visit, faded in; honest without.
describe('Vejr’s AI advice', () => {
  const advice = (fake: ReturnType<typeof createFakeHass>) =>
    fake.calls.filter(call => call.service === 'weather_advice');
  beforeEach(() => {
    resetNav();
    queryClient.clear();
  });
  afterEach(() => {
    resetFakeWeatherAdvice();
  });

  it('is never asked for while Vejr is not shown (Hjem is not a reason to pay for advice)', async () => {
    const fake = mount(false);
    await waitFor(() => {
      expect(fake.calls.length).toBeGreaterThan(0);
    });
    expect(advice(fake)).toHaveLength(0);
  });

  it('starts once on the visit and shows the sentence as AI, without the rule sentence in the title', async () => {
    const fake = mount();
    await waitFor(() => {
      expect(screen.getByText(fakeWeatherAdvice.summary)).toBeTruthy();
    });
    expect(screen.getByLabelText(`AI-råd baseret på vejrudsigten: ${fakeWeatherAdvice.summary}`)).toBeTruthy();
    expect(advice(fake).map(call => call.data)).toEqual([{start: true}]);
  });

  it('on its way it holds its place with the pulsing bars, then reads until it is ready', async () => {
    fakeWeatherAdvice.pendingReads = 1;
    const fake = mount();
    await waitFor(() => {
      expect(screen.getByRole('status', {name: 'Et vejrråd er på vej'})).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText(fakeWeatherAdvice.summary)).toBeTruthy();
    }, {timeout: 4000});
    expect(advice(fake).map(call => call.data)).toEqual([{start: true}, {start: false}]);
  });

  it('an unknown outcome is said plainly and never retried; no AI means no AI claim', async () => {
    fakeWeatherAdvice.status = 'error';
    const fake = mount();
    await waitFor(() => {
      expect(screen.getByText('Vejrrådet er ikke tilgængeligt lige nu.')).toBeTruthy();
    });
    await new Promise(resolve => setTimeout(resolve, 1700));
    expect(advice(fake)).toHaveLength(1);
    act(() => {
      useNav.getState().back();
    });
    resetNav();
    queryClient.clear();
    fakeWeatherAdvice.status = 'unavailable';
    mount();
    await waitFor(() => {
      expect(place()).toBe('Mårslet');
    });
    expect(screen.queryByText('AI')).toBeNull();
    expect(screen.queryByText('Vejrrådet er ikke tilgængeligt lige nu.')).toBeNull();
  });
});
