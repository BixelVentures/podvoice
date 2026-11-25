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
import {TEMPERATURE_SETTLE_MS, VehicleTile} from './Vehicle';

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

  it('shows what the car reported: the state as the title, range, battery, Adgang and Klima', async () => {
    mount();
    const hero = await within(view()).findByRole('region', {name: 'Bilens status'});
    expect(within(hero).getByRole('heading', {name: 'Parkeret'})).toBeTruthy();
    expect(within(hero).getByText('Ikke tilsluttet')).toBeTruthy();
    // Range, and Tesla's own sleep (vehicle-model.js vehicleStatus): only with a source.
    expect(within(hero).getByText('320 km rækkevidde · I dvale')).toBeTruthy();
    expect(hero.textContent).toContain('71 %');
    // Parked: the metrics are the access and the climate, never a 0 kW charge.
    expect(within(hero).getByText('adgang')).toBeTruthy();
    expect(hero.textContent).not.toContain('kW');
    expect(within(view()).getByRole('button', {name: 'Døre: Låst. Tryk for at låse op'})).toBeTruthy();
    expect(within(view()).getByRole('button', {name: 'Bagagerum: Lukket. Tryk for at åbne'})).toBeTruthy();
    expect(within(view()).getByRole<HTMLInputElement>('switch', {name: 'Klima'}).checked).toBe(false);
  });

  it('Lås op asks first: the dialog tells of wake and consequence, then sends once with the token', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await within(view()).findByRole('button', {name: /^Døre: Låst/}));
    const dialog = await screen.findByRole('alertdialog', {name: 'Lås bilen op?'});
    expect(within(dialog).getByText(/Bilen låses op\. Den låses ikke automatisk igen herfra\./)).toBeTruthy();
    expect(within(dialog).getByText(/Handlingen kan vække bilen\./)).toBeTruthy();
    // Only the integration's prepare step so far: nothing reached the car.
    expect(commandCalls()).toHaveLength(1);
    expect(commandCalls()[0]?.data.confirmation).toBeUndefined();
    expect(fake.hass.states['lock.model_y_lock']?.state).toBe('locked');
    // The car answers when the test says so: the surface's busy state is seen before HA's next state.
    fake.mode = 'silent';
    await user.click(within(dialog).getByRole('button', {name: 'Lås op'}));
    expect(commandCalls()).toHaveLength(2);
    expect(commandCalls()[1]?.data).toMatchObject({action: 'unlock', confirmation: '1'.padStart(32, '0'),
      acknowledge_prior_unresolved: false});
    // The feedback is in the surface itself: busy while it waits, then ✓ »Ulåst · Bekræftet«.
    expect(within(view()).getByRole('button', {name: 'Døre: Låser op…. Anmodning modtaget.'})).toBeTruthy();
    act(() => {
      fake.patch('lock.model_y_lock', 'unlocked');
    });
    // Answered, the dialog leaves nothing inert behind (the answer card's hidden parts are inert by design).
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    // Hidden stack screens are inert (G7 #19); nothing else is.
    expect([...document.querySelectorAll('[inert]:not([data-screen]:not([data-place=center]))')]).toEqual([]);
    await waitFor(() => {
      expect(fake.hass.states['lock.model_y_lock']?.state).toBe('unlocked');
    });
    expect(await within(view()).findByRole('button', {name: 'Døre: Ulåst. Bekræftet'})).toBeTruthy();
    expect(commandCalls()).toHaveLength(2);
  });

  it('cancel sends nothing to the car', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await within(view()).findByRole('button', {name: /^Døre: Låst/}));
    const dialog = await screen.findByRole('alertdialog', {name: 'Lås bilen op?'});
    await user.click(within(dialog).getByRole('button', {name: 'Annuller'}));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(commandCalls()).toHaveLength(1);
    expect(fake.hass.states['lock.model_y_lock']?.state).toBe('locked');
  });

  it('locking needs no confirmation (the owner’s rule); after an unresolved unlock the integration asks', async () => {
    const user = userEvent.setup();
    mount(hass => {
      hass.patch('lock.model_y_lock', 'unlocked');
    });
    await user.click(await within(view()).findByRole('button', {name: 'Døre: Ulåst. Tryk for at låse'}));
    // Sent at once, once: no dialog.
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(commandCalls()).toHaveLength(1);
    expect(commandCalls()[0]?.data).toMatchObject({action: 'lock'});
    expect(commandCalls()[0]?.data.confirmation).toBeUndefined();
    await waitFor(() => {
      expect(fake.hass.states['lock.model_y_lock']?.state).toBe('locked');
    });
    expect(await within(view()).findByRole('button', {name: 'Døre: Låst. Bekræftet'})).toBeTruthy();
    // Now unlock (confirmed) and lock again: the earlier unlock is unresolved, so lock needs the override.
    await user.click(await within(view()).findByRole('button', {name: /^Døre: Låst/}));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', {name: 'Lås op'}));
    await waitFor(() => {
      expect(fake.hass.states['lock.model_y_lock']?.state).toBe('unlocked');
    });
    await user.click(await within(view()).findByRole('button', {name: /^Døre: Ulåst/}));
    const dialog = await screen.findByRole('alertdialog', {name: 'Lås bilen?'});
    expect(within(dialog).getByText(/Tidligere anmodninger om at låse bilen og låse bilen op/)).toBeTruthy();
    expect(within(dialog).getByText(/Bekræft, at du vil fortsætte\./)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', {name: 'Lås bilen'}));
    expect(commandCalls().at(-1)?.data).toMatchObject({action: 'lock', acknowledge_prior_unresolved: true});
    await waitFor(() => {
      expect(fake.hass.states['lock.model_y_lock']?.state).toBe('locked');
    });
  });

  it('an unknown outcome is said honestly in the surface and the hero, and never resent', async () => {
    const user = userEvent.setup();
    mount(hass => {
      robotVehicleFake(hass).vehicleOutcome = {outcome: 'unknown', vehicleError: 'wake_failed'};
    });
    await user.click(await within(view()).findByRole('button', {name: /^Døre: Låst/}));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', {name: 'Lås op'}));
    expect(await within(view()).findByRole('button', {name: 'Døre: Ukendt. Kontrollér bilen.'})).toBeTruthy();
    const hero = within(view()).getByRole('region', {name: 'Bilens status'});
    expect(within(hero).getByText('Udfald ukendt · kontrollér bilen.')).toBeTruthy();
    expect(hero.textContent).toContain('Bilen kunne ikke vækkes.');
    expect(commandCalls()).toHaveLength(2);
  });

  it('Klima: on is confirmed; then −/+ (one command per run), seats, defrost and off go without a dialog',
    async () => {
    const user = userEvent.setup();
    mount();
    // With the climate off, what depends on it is shown but disabled (B6).
    expect((await within(view()).findByRole('button', {name: 'Hæv temperatur'})).hasAttribute('disabled'))
      .toBe(true);
    expect((within(view()).getByRole('button', {name: 'Sænk temperatur'})).hasAttribute('disabled')).toBe(true);
    for (const name of ['Førersæde', 'Afrim ruder']) {
      for (const radio of within(within(view()).getByRole('radiogroup', {name})).getAllByRole('radio'))
        expect(radio.hasAttribute('disabled')).toBe(true);
    }
    // Turning it on asks first (the owner's rule).
    await user.click(await within(view()).findByRole('switch', {name: 'Klima'}));
    const dialog = await screen.findByRole('alertdialog', {name: 'Tænd klima?'});
    await user.click(within(dialog).getByRole('button', {name: 'Tænd klima'}));
    await waitFor(() => {
      expect(within(view()).getByRole<HTMLInputElement>('switch', {name: 'Klima'}).checked).toBe(true);
    });
    expect(commandCalls().map(call => call.data.action)).toEqual(['climateOn', 'climateOn']);
    expect(commandCalls()[1]?.data.confirmation).toBeTruthy();
    expect(await within(view()).findByText('Tændt · 21 °C')).toBeTruthy();
    // The cabin glows while the climate heats (the hero's tone).
    expect(within(view()).getByRole('region', {name: 'Bilens status'}).getAttribute('data-car-tone')).toBe('climate');
    // −/+: each tap moves the shown target at once; the run is sent once, after the last tap.
    const raise = within(view()).getByRole('button', {name: 'Hæv temperatur'});
    await user.click(raise);
    expect(within(view()).getByText('21,5°')).toBeTruthy();
    await user.click(raise);
    await user.click(raise);
    expect(within(view()).getByText('22,5°')).toBeTruthy();
    await user.click(within(view()).getByRole('button', {name: 'Sænk temperatur'}));
    expect(within(view()).getByText('22°')).toBeTruthy();
    expect(commandCalls()).toHaveLength(2);
    await waitFor(() => {
      expect(commandCalls()).toHaveLength(3);
    }, {timeout: TEMPERATURE_SETTLE_MS + 1000});
    expect(commandCalls()[2]?.data).toMatchObject({action: 'temperature', args: {temperature: 22}});
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(await within(view()).findByText('Tændt · 22 °C')).toBeTruthy();
    await new Promise(resolve => setTimeout(resolve, TEMPERATURE_SETTLE_MS + 100));
    expect(commandCalls()).toHaveLength(3);
    // Seats and defrost go at once too.
    const seat = within(view()).getByRole('radiogroup', {name: 'Førersæde'});
    await user.click(within(seat).getByRole('radio', {name: 'Høj'}));
    await waitFor(() => {
      expect(commandCalls().at(-1)?.data).toMatchObject({action: 'driverSeatHeat', args: {option: 'high'}});
    });
    const defrost = within(view()).getByRole('radiogroup', {name: 'Afrim ruder'});
    expect(within(defrost).getByRole('radio', {name: 'Fra'}).getAttribute('aria-checked')).toBe('true');
    await user.click(within(defrost).getByRole('radio', {name: 'Til'}));
    await waitFor(() => {
      expect(commandCalls().at(-1)?.data).toMatchObject({action: 'defrostOn'});
    });
    // Off goes at once too.
    await user.click(within(view()).getByRole('switch', {name: 'Klima'}));
    await waitFor(() => {
      expect(commandCalls().at(-1)?.data).toMatchObject({action: 'climateOff'});
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(commandCalls().slice(2).every(call => call.data.confirmation === undefined)).toBe(true);
  });

  it('a −/+ run not yet sent is sent at once when the screen goes away', async () => {
    const user = userEvent.setup();
    const {unmount} = mount(hass => {
      hass.patch('climate.model_y_climate', 'heat_cool');
    });
    const raise = await within(view()).findByRole('button', {name: 'Hæv temperatur'});
    await waitFor(() => {
      expect(raise.hasAttribute('disabled')).toBe(false);
    });
    await user.click(raise);
    const result = commandCalls().length;
    unmount();
    await waitFor(() => {
      expect(commandCalls()).toHaveLength(result + 1);
    }, {timeout: TEMPERATURE_SETTLE_MS / 2});
    expect(commandCalls().at(-1)?.data).toMatchObject({action: 'temperature', args: {temperature: 21.5}});
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
      expect(document.getElementById('home-vehicle')?.textContent).toContain('71 %Låst · I dvale');
    });
  });
});
