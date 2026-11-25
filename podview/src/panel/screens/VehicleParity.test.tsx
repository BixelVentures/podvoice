import {act, render, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it} from 'vitest';
import {Providers} from '../../app/Providers';
import {commands} from '../../lib/ha/commands';
import {robotVehicleFake} from '../../lib/ha/fixtures/robot-vehicle';
import {createFakeHass, FAKE_PANEL} from '../../lib/ha/ha-fixture';
import type {FakeHass} from '../../lib/ha/ha-fixture';
import {transport} from '../../lib/ha/transport';
import {useVehicleConfirm} from '../../lib/ha/vehicle';
import {resetNav, useNav} from '../nav';
import {Shell} from '../Shell';
import {eventText, useVehicleChoice, vehicleStatus} from './Vehicle';

let fake: FakeHass;

function mount(setup?: (fake: FakeHass) => void) {
  let own: FakeHass | null = null;
  own = createFakeHass({
    confirmMs: 30,
    onChange: hass => {
      if (!own || fake !== own) return;
      act(() => {
        transport.setHass(hass);
      });
    },
  });
  fake = own;
  setup?.(fake);
  transport.setPanel(FAKE_PANEL);
  transport.setHass(fake.hass);
  transport.resync();
  const result = render(
    <Providers>
      <Shell />
    </Providers>,
  );
  act(() => {
    useNav.getState().push('vehicle');
  });
  return result;
}

const view = () => document.getElementById('vehicle-view') ?? document.body;
const hero = () => within(view()).findByRole('region', {name: 'Bilens status'});

describe('Tesla on HA: the hero, history and several cars', () => {
  beforeEach(() => {
    resetNav();
    commands.store.setState({wishes: {}});
    useVehicleConfirm.setState({pending: null});
    useVehicleChoice.setState({deviceId: null});
  });

  it('a car not reported for a while says when on the Hjem widget, in K-Fresh’s words (G7 #8)', async () => {
    mount(fake => {
      fake.patch('sensor.model_y_fleet_status', 'stale');
    });
    act(() => {
      useNav.getState().back();
    });
    await waitFor(() => {
      expect(document.querySelector('[data-kind=tesla]')?.textContent).toMatch(/Opdateret \d\d\.\d\d/);
    });
    expect(document.querySelector('[data-kind=tesla]')?.textContent).not.toMatch(/Ikke opdateret/);
  });

  it('draws the dot car filled to the battery level, in the parked tone, with the model', async () => {
    mount();
    const section = await hero();
    expect(section.getAttribute('data-car-tone')).toBe('parked');
    expect(section.getAttribute('data-car-level')).toBe('0.71');
    expect(section.querySelectorAll('svg circle').length).toBeGreaterThan(100);
    // Not charging: nothing flows.
    expect(section.querySelectorAll('.animate-pv-flow')).toHaveLength(0);
    expect(within(section).getByText('Model Y')).toBeTruthy();
  });

  it('the tone follows the car: climate on shows the warm cabin; charging flows only then', async () => {
    mount(hass => {
      hass.patch('climate.model_y_climate', 'heat_cool');
    });
    await waitFor(async () => {
      expect((await hero()).getAttribute('data-car-tone')).toBe('climate');
    });
    expect((await hero()).querySelectorAll('.animate-pv-warm').length).toBeGreaterThan(0);
    act(() => {
      fake.patch('climate.model_y_climate', 'off');
      fake.patch('sensor.model_y_charging', 'charging');
    });
    await waitFor(async () => {
      expect((await hero()).getAttribute('data-car-tone')).toBe('charging');
    });
    const section = await hero();
    expect(section.querySelectorAll('.animate-pv-flow').length).toBeGreaterThan(0);
    expect(section.querySelectorAll('.animate-pv-warm')).toHaveLength(0);
    expect(within(section).getByRole('heading', {name: 'Lader'})).toBeTruthy();
    expect(within(section).getByText('11 kW')).toBeTruthy();
  });

  it('with two cars a segmented choice shows the chosen one', async () => {
    const user = userEvent.setup();
    mount(hass => {
      robotVehicleFake(hass).secondCar = true;
    });
    const choice = await within(view()).findByRole('radiogroup', {name: 'Tesla'});
    // Sorted by name as the integration does: Model 3 first.
    expect(within(choice).getByRole('radio', {name: 'Model 3'}).getAttribute('aria-checked')).toBe('true');
    expect((await hero()).getAttribute('data-car-tone')).toBe('charging');
    expect(within(await hero()).getByRole('heading', {name: 'Lader'})).toBeTruthy();
    expect(within(await hero()).getByText('11 kW')).toBeTruthy();
    await user.click(within(choice).getByRole('radio', {name: 'Model Y'}));
    await waitFor(async () => {
      expect((await hero()).getAttribute('data-car-tone')).toBe('parked');
    });
  });

  it('with one car there is no choice', async () => {
    mount();
    await hero();
    expect(within(view()).queryByRole('radiogroup', {name: 'Tesla'})).toBeNull();
  });

  it('Seneste hændelser lists the car’s recorded changes in the old words, newest first', async () => {
    const at = Date.now() / 1000;
    mount(hass => {
      robotVehicleFake(hass).history = [
        {at: at - 3600, field: 'locked', value: 'unlocked'},
        {at: at - 1800, field: 'locked', value: 'locked'},
        {at: at - 600, field: 'charging', value: 'charging'},
        {at: at - 300, field: 'charging', value: 'disconnected'},
      ];
    });
    const history = await within(view()).findByRole('region', {name: 'Seneste hændelser'});
    expect([...history.querySelectorAll('.font-bold')].map(item => item.textContent)).toEqual([
      'Lader',
      'Låst',
      'Ulåst',
    ]);
  });

  it('an empty history says so; without HA’s recorder the section is not shown', async () => {
    const first = mount();
    const history = await within(view()).findByRole('region', {name: 'Seneste hændelser'});
    expect(within(history).getByText('Ingen hændelser at vise endnu.')).toBeTruthy();
    first.unmount();
    mount(hass => {
      robotVehicleFake(hass).history = null;
    });
    await hero();
    await waitFor(() => {
      expect(fake.calls.some(call => call.service === 'vehicle_history')).toBe(true);
    });
    expect(within(view()).queryByRole('region', {name: 'Seneste hændelser'})).toBeNull();
  });
});

describe('the rules the screen shows', () => {
  it('the status is the old live line', () => {
    const car = {
      deviceId: 'car',
      name: 'Model Y',
      status: 'observed' as const,
      entities: {},
      controls: [],
      fieldObservedAt: {},
      data: {locked: true},
    };
    const since = new Date(2026, 10, 23, 9, 44).getTime() / 1000;
    const now = new Date(2026, 10, 23, 12, 0).getTime();
    expect(vehicleStatus({...car, connection: {state: 'online'}}, {now})).toBe('Låst');
    expect(vehicleStatus({...car, connection: {state: 'offline'}}, {now})).toBe('Ikke forbundet');
    expect(vehicleStatus({...car, connection: {state: 'asleep', since}}, {now})).toBe('Låst · I dvale siden 09.44');
    expect(vehicleStatus({...car, connection: {state: 'asleep', since}}, {now, short: true})).toBe('Låst · I dvale');
    expect(vehicleStatus({...car, data: {locked: true, charging: {status: 'stopped'}}}, {now})).toBe(
      'Tilsluttet · lader ikke',
    );
    expect(eventText('trunk', 'open')).toBe('Bagagerum · Åbent');
    expect(eventText('charging', 'disconnected')).toBe('');
  });
});
