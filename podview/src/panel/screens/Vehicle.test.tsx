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
  // Only this test's fake feeds the transport (an earlier test's fake may still publish late effects).
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
    // The old live status: the lock, then Tesla's own sleep (vehicle-model.js vehicleStatus).
    expect(await within(view()).findByText('Låst · I dvale')).toBeTruthy();
    const hero = within(view()).getByRole('region', {name: 'Bilens status'});
    expect(within(hero).getByText('Batteri').nextElementSibling?.textContent).toBe('71 %');
    expect(within(hero).getByText('320 km')).toBeTruthy();
    expect(within(view()).getByText('Låst')).toBeTruthy();
    expect(within(view()).getByText('Lukket')).toBeTruthy();
    expect(within(view()).getByRole('switch', {name: 'Klima: Slukket'})).toBeTruthy();
  });

  it('Lås op asks first: the dialog tells of wake and consequence, then sends once with the token', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await within(view()).findByRole('button', {name: 'Lås op'}));
    const dialog = await screen.findByRole('alertdialog', {name: 'Lås bilen op?'});
    expect(within(dialog).getByText(/Bilen låses op\. Den låses ikke automatisk igen herfra\./)).toBeTruthy();
    expect(within(dialog).getByText(/Handlingen kan vække bilen\./)).toBeTruthy();
    // Only the integration's prepare step so far: nothing reached the car.
    expect(commandCalls()).toHaveLength(1);
    expect(commandCalls()[0]?.data.confirmation).toBeUndefined();
    expect(fake.hass.states['lock.model_y_lock']?.state).toBe('locked');
    await user.click(within(dialog).getByRole('button', {name: 'Lås op'}));
    expect(commandCalls()).toHaveLength(2);
    expect(commandCalls()[1]?.data).toMatchObject({action: 'unlock', confirmation: '1'.padStart(32, '0'),
      acknowledge_prior_unresolved: false});
    // Answered, the dialog leaves nothing inert behind (the answer card's hidden parts are inert by design).
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect([...document.querySelectorAll('[inert]')]).toEqual([]);
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

  it('Lås bilen asks first (it can wake the car), then goes once; an unresolved unlock: an override', async () => {
    const user = userEvent.setup();
    mount(hass => {
      hass.patch('lock.model_y_lock', 'unlocked');
    });
    await user.click(await within(view()).findByRole('button', {name: 'Lås bilen'}));
    // The old screen's step before every live action: nothing has reached the integration yet.
    const wake = await screen.findByRole('alertdialog', {name: 'Lås bilen?'});
    expect(within(wake).getByText('Handlingen kan vække bilen.')).toBeTruthy();
    expect(commandCalls()).toHaveLength(0);
    await user.click(within(wake).getByRole('button', {name: 'Lås bilen'}));
    expect(commandCalls()).toHaveLength(1);
    expect(commandCalls()[0]?.data.confirmation).toBeUndefined();
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
    const unknown = 'Udfald ukendt · kontrollér bilen. Bilen kunne ikke vækkes.';
    expect(await within(view()).findByText(unknown)).toBeTruthy();
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
      expect(document.getElementById('home-vehicle')?.textContent).toContain('Låst · I dvale · 71 %');
    });
  });
});
