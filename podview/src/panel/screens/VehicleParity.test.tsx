import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it} from 'vitest';
import {Providers} from '../../app/Providers';
import {commands} from '../../lib/ha/commands';
import {robotVehicleFake} from '../../lib/ha/fixtures/robot-vehicle';
import {createFakeHass, FAKE_PANEL} from '../../lib/ha/ha-fixture';
import type {FakeHass} from '../../lib/ha/ha-fixture';
import {transport} from '../../lib/ha/transport';
import {lockNeedsLocalStep, useVehicleConfirm} from '../../lib/ha/vehicle';
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
const commandCalls = () => fake.calls.filter(call => call.service === 'vehicle_command');

describe('Bil on HA: the old screen’s hero, history, several cars and the wake step', () => {
  beforeEach(() => {
    resetNav();
    commands.store.setState({wishes: {}});
    useVehicleConfirm.setState({pending: null});
    useVehicleChoice.setState({deviceId: null});
  });

  it('draws the dot car filled to the battery level, in the parked tone, with the model', async () => {
    mount();
    const section = await hero();
    expect(section.getAttribute('data-car-tone')).toBe('parked');
    expect(section.style.getPropertyValue('--pv-car-level')).toBe('0.71');
    expect([...section.querySelectorAll('[data-artwork=dots] > i')].map(i => i.getAttribute('data-layer'))).toEqual([
      'tires',
      'empty',
      'fill',
      'cabin',
    ]);
    expect(within(section).getByText('Model Y')).toBeTruthy();
    expect(section.querySelector('meter')?.getAttribute('value')).toBe('71');
    expect(within(section).getByText(/^Opdateret: /)).toBeTruthy();
  });

  it('the tone follows the car: climate on shows the warm cabin', async () => {
    mount(hass => {
      hass.patch('climate.model_y_climate', 'heat_cool');
    });
    await waitFor(async () => {
      expect((await hero()).getAttribute('data-car-tone')).toBe('climate');
    });
  });

  it('a car of an unknown model gets the icon, never the Model Y artwork', async () => {
    const user = userEvent.setup();
    mount(hass => {
      robotVehicleFake(hass).secondCar = true;
    });
    const choice = await within(view()).findByRole('radiogroup', {name: 'Tesla'});
    // Sorted by name as the integration does: Model 3 first.
    expect(within(choice).getByRole('radio', {name: 'Model 3'}).getAttribute('aria-checked')).toBe('true');
    expect((await hero()).getAttribute('data-car-tone')).toBe('none');
    expect(within(await hero()).getByText('Bilen lader')).toBeTruthy();
    expect(within(await hero()).getByText('11 kW')).toBeTruthy();
    await user.click(within(choice).getByRole('radio', {name: 'Model Y'}));
    await waitFor(async () => {
      expect((await hero()).getAttribute('data-car-tone')).toBe('parked');
    });
    expect(within(view()).getByRole('heading', {level: 1}).parentElement?.textContent).toContain('Model Y');
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
    expect(within(history).getAllByRole('listitem').map(item => item.firstChild?.textContent)).toEqual([
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

  it('cancelling the wake step sends nothing', async () => {
    const user = userEvent.setup();
    mount(hass => {
      hass.patch('lock.model_y_lock', 'unlocked');
    });
    await user.click(await within(view()).findByRole('button', {name: 'Lås bilen'}));
    const dialog = await screen.findByRole('alertdialog', {name: 'Lås bilen?'});
    await user.click(within(dialog).getByRole('button', {name: 'Annuller'}));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(commandCalls()).toHaveLength(0);
    expect(fake.hass.states['lock.model_y_lock']?.state).toBe('unlocked');
  });
});

describe('the rules the screen shows', () => {
  it('the wake step is skipped only when the integration will ask itself (an unresolved unlock)', () => {
    expect(lockNeedsLocalStep({risk: null})).toBe(true);
    expect(lockNeedsLocalStep({risk: {revision: 0, unresolved: {access: ['locked']}, pending: false}})).toBe(true);
    expect(lockNeedsLocalStep({risk: {revision: 0, unresolved: {access: ['unlocked']}, pending: false}})).toBe(false);
  });

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
