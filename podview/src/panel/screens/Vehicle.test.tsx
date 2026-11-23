import {act, render, screen, waitFor, within} from '@testing-library/react';
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
import {VehicleTile} from './Vehicle';

let fake: FakeHass;

function mount(setup?: (fake: FakeHass) => void, extra?: React.ReactNode) {
  fake = createFakeHass({
    confirmMs: 30,
    onChange: hass => {
      act(() => {
        transport.setHass(hass);
      });
    },
  });
  setup?.(fake);
  transport.setPanel(FAKE_PANEL);
  transport.setHass(fake.hass);
  transport.resync();
  const result = render(
    <Providers>
      <Shell />
      {extra}
    </Providers>,
  );
  act(() => {
    useNav.getState().push('vehicle');
  });
  return result;
}

const view = () => document.getElementById('vehicle-view') ?? document.body;
const commandCalls = () => fake.calls.filter(call => call.service === 'vehicle_command');

describe('Bil on HA', () => {
  beforeEach(() => {
    resetNav();
    commands.store.setState({wishes: {}});
    useVehicleConfirm.setState({pending: null});
  });

  it('shows what the car reported with the old screen’s words', async () => {
    mount();
    expect(await within(view()).findByText('I dvale · Låst')).toBeTruthy();
    expect(within(view()).getByText(/71 % · 320 km/)).toBeTruthy();
    expect(within(view()).getByText('Låst')).toBeTruthy();
    expect(within(view()).getByText('Lukket')).toBeTruthy();
    expect(within(view()).getByRole('switch', {name: 'Klima: Slukket'})).toBeTruthy();
  });

  it('Lås op asks first: the dialog tells of the wake and the consequence, then sends once with the token', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await within(view()).findByRole('button', {name: 'Lås op'}));
    const dialog = await screen.findByRole('alertdialog', {name: 'Lås bilen op?'});
    expect(within(dialog).getByText(/Bilen låses op\. Den låses ikke automatisk igen herfra\./)).toBeTruthy();
    expect(within(dialog).getByText(/Handlingen kan vække bilen\./)).toBeTruthy();
    expect(document.querySelector('[inert]')).toBeNull();
    // Only the integration's prepare step so far: nothing reached the car.
    expect(commandCalls()).toHaveLength(1);
    expect(commandCalls()[0]?.data.confirmation).toBeUndefined();
    expect(fake.hass.states['lock.model_y_lock']?.state).toBe('locked');
    await user.click(within(dialog).getByRole('button', {name: 'Lås op'}));
    expect(commandCalls()).toHaveLength(2);
    expect(commandCalls()[1]?.data).toMatchObject({action: 'unlock', confirmation: '1'.padStart(32, '0'),
      acknowledge_prior_unresolved: false});
    await waitFor(() => {
      expect(fake.hass.states['lock.model_y_lock']?.state).toBe('unlocked');
    });
    expect(await within(view()).findByRole('button', {name: 'Lås bilen'})).toBeTruthy();
    expect(commandCalls()).toHaveLength(2);
  });

  it('cancel sends nothing to the car', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await within(view()).findByRole('button', {name: 'Lås op'}));
    const dialog = await screen.findByRole('alertdialog', {name: 'Lås bilen op?'});
    await user.click(within(dialog).getByRole('button', {name: 'Annuller'}));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(commandCalls()).toHaveLength(1);
    expect(fake.hass.states['lock.model_y_lock']?.state).toBe('locked');
  });

  it('Lås bilen goes at once, unless an earlier unlock is unresolved: then it is a confirmed override', async () => {
    const user = userEvent.setup();
    mount(hass => {
      hass.patch('lock.model_y_lock', 'unlocked');
    });
    await user.click(await within(view()).findByRole('button', {name: 'Lås bilen'}));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => {
      expect(fake.hass.states['lock.model_y_lock']?.state).toBe('locked');
    });
    // Now unlock (confirmed) and lock again: the earlier unlock is unresolved, so lock needs the override.
    await user.click(await within(view()).findByRole('button', {name: 'Lås op'}));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', {name: 'Lås op'}));
    await user.click(await within(view()).findByRole('button', {name: 'Lås bilen'}));
    const dialog = await screen.findByRole('alertdialog', {name: 'Lås bilen?'});
    expect(within(dialog).getByText(/Tidligere anmodninger om at låse bilen og låse bilen op/)).toBeTruthy();
    expect(within(dialog).getByText(/Bekræft, at du vil fortsætte\./)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', {name: 'Lås bilen'}));
    expect(commandCalls().at(-1)?.data).toMatchObject({action: 'lock', acknowledge_prior_unresolved: true});
    await waitFor(() => {
      expect(fake.hass.states['lock.model_y_lock']?.state).toBe('locked');
    });
  });

  it('an unknown outcome is said honestly and never resent', async () => {
    const user = userEvent.setup();
    mount(hass => {
      robotVehicleFake(hass).vehicleOutcome = {outcome: 'unknown', vehicleError: 'wake_failed'};
    });
    await user.click(await within(view()).findByRole('button', {name: 'Lås op'}));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', {name: 'Lås op'}));
    expect(await within(view()).findByText('Udfald ukendt · kontrollér bilen. Bilen kunne ikke vækkes.')).toBeTruthy();
    expect(commandCalls()).toHaveLength(2);
  });

  it('Klima: turning it on is confirmed, then the temperature and seats can be set', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await within(view()).findByRole('switch', {name: 'Klima: Slukket'}));
    const dialog = await screen.findByRole('alertdialog', {name: 'Tænd klima?'});
    await user.click(within(dialog).getByRole('button', {name: 'Tænd klima'}));
    expect(await within(view()).findByRole('switch', {name: 'Klima: Tændt'})).toBeTruthy();
    await user.click(await within(view()).findByRole('button', {name: 'Højere temperatur'}));
    const temperature = await screen.findByRole('alertdialog', {name: 'Indstil temperatur: 21,5 °C?'});
    await user.click(within(temperature).getByRole('button', {name: 'Indstil temperatur'}));
    expect(commandCalls().at(-1)?.data).toMatchObject({action: 'temperature', args: {temperature: 21.5}});
    const seat = within(view()).getByRole('radiogroup', {name: 'Fører'});
    await user.click(within(seat).getByRole('radio', {name: 'Høj'}));
    const seatDialog = await screen.findByRole('alertdialog', {name: 'Indstil førersæde: Høj?'});
    expect(within(seatDialog).getByText(/Handlingen kan tænde klimaet\./)).toBeTruthy();
  });

  it('without a Tesla in HA the screen says so and the Home tile hides', async () => {
    mount(
      hass => {
        robotVehicleFake(hass).vehicle = false;
      },
      <VehicleTile />,
    );
    expect(await within(view()).findByText('Forbind bilen i Home Assistant for at se status her.')).toBeTruthy();
    expect(document.getElementById('home-vehicle')).toBeNull();
  });

  it('the Home tile line is the status and the battery', async () => {
    mount(undefined, <VehicleTile />);
    await waitFor(() => {
      expect(document.getElementById('home-vehicle')?.textContent).toContain('I dvale · Låst · 71 %');
    });
  });
});
