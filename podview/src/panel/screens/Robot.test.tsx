import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it} from 'vitest';
import {Providers} from '../../app/Providers';
import {commands} from '../../lib/ha/commands';
import {robotVehicleFake} from '../../lib/ha/fixtures/robot-vehicle';
import {createFakeHass, FAKE_PANEL} from '../../lib/ha/ha-fixture';
import type {FakeHass} from '../../lib/ha/ha-fixture';
import {transportActions} from '../../lib/ha/robot';
import {transport} from '../../lib/ha/transport';
import {resetNav, useNav} from '../nav';
import {Shell} from '../Shell';
import {RobotTile} from './Robot';

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
  const view = render(
    <Providers>
      <Shell />
      {extra}
    </Providers>,
  );
  act(() => {
    useNav.getState().push('robot');
  });
  return view;
}

const robotCalls = () => fake.calls.filter(call => call.service === 'robot_command');
const view = () => document.getElementById('robot-view') ?? document.body;

describe('Robot on HA', () => {
  beforeEach(() => {
    resetNav();
    commands.store.setState({wishes: {}});
  });

  it('offers exactly what the add-on transport table admits', () => {
    const every = 4 | 8 | 16 | 8192;
    expect(transportActions('cleaning', every)).toEqual(['pause', 'stop', 'return']);
    expect(transportActions('paused', every)).toEqual(['resume', 'stop', 'return']);
    expect(transportActions('returning', every)).toEqual(['stop']);
    expect(transportActions('idle', every)).toEqual(['return']);
    expect(transportActions('docked', every)).toEqual([]);
    expect(transportActions('cleaning', 8)).toEqual(['stop']);
  });

  it('shows the docked robot with the old screen’s words and no transport', async () => {
    mount();
    expect(await within(view()).findByText('I basen')).toBeTruthy();
    expect(within(view()).getByText(/Batteri 87/)).toBeTruthy();
    expect(within(view()).queryByRole('group', {name: 'Betjening'})).toBeNull();
  });

  it('Pause shows at once, is sent once from the state the user saw, and HA’s next state ends it', async () => {
    const user = userEvent.setup();
    mount(hass => {
      hass.patch('vacuum.qrevo', 'cleaning');
    });
    const pause = await within(view()).findByRole('button', {name: 'Pause'});
    await user.click(pause);
    expect(pause.getAttribute('aria-busy')).toBe('true');
    expect(robotCalls()).toHaveLength(1);
    expect(robotCalls()[0]?.data).toMatchObject({
      entity_id: 'vacuum.qrevo',
      action: 'pause',
      expected_state: 'cleaning',
      expected_features: 4 | 8 | 16 | 8192,
    });
    expect(await within(view()).findByRole('button', {name: 'Fortsæt'})).toBeTruthy();
    await waitFor(() => {
      expect(commands.store.getState().wishes['vacuum.qrevo:transport']).toBeUndefined();
    });
    expect(robotCalls()).toHaveLength(1);
  });

  it('Kør til basen asks first in a React Aria dialog; nothing is inert, cancel sends nothing', async () => {
    const user = userEvent.setup();
    mount(hass => {
      hass.patch('vacuum.qrevo', 'cleaning');
    });
    await user.click(await within(view()).findByRole('button', {name: 'Kør til basen'}));
    const dialog = await screen.findByRole('alertdialog', {name: 'Kør til basen?'});
    expect(within(dialog).getByText('Robotten sendes til basen.')).toBeTruthy();
    expect(document.querySelector('[inert]')).toBeNull();
    expect(document.querySelector('dialog[open]')).toBeNull();
    await user.click(within(dialog).getByRole('button', {name: 'Behold turen'}));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(robotCalls()).toHaveLength(0);
    await user.click(within(view()).getByRole('button', {name: 'Kør til basen'}));
    const again = await screen.findByRole('alertdialog', {name: 'Kør til basen?'});
    await user.click(within(again).getByRole('button', {name: 'Kør til basen'}));
    expect(robotCalls()).toHaveLength(1);
    expect(robotCalls()[0]?.data.action).toBe('return');
    expect(await within(view()).findByText('På vej til basen')).toBeTruthy();
  });

  it('Afslut rengøring tells what happens and is not the same as Pause', async () => {
    const user = userEvent.setup();
    mount(hass => {
      hass.patch('vacuum.qrevo', 'cleaning');
    });
    await user.click(await within(view()).findByRole('button', {name: 'Afslut rengøring'}));
    const dialog = await screen.findByRole('alertdialog', {name: 'Afslut rengøringen?'});
    expect(within(dialog).getByText(/Robotten sendes ikke til basen/)).toBeTruthy();
  });

  it('a refusal is shown honestly and never resent', async () => {
    const user = userEvent.setup();
    mount(hass => {
      hass.patch('vacuum.qrevo', 'cleaning');
    });
    const pause = await within(view()).findByRole('button', {name: 'Pause'});
    fake.mode = 'refuse';
    await user.click(pause);
    expect(await within(view()).findByText(/Home Assistant afviste handlingen/)).toBeTruthy();
    expect(robotCalls()).toHaveLength(1);
    // Never locked: the next tap is its own command.
    expect(pause.hasAttribute('disabled')).toBe(false);
  });

  it('without a vacuum in HA the screen says so and the Home tile hides', async () => {
    mount(
      hass => {
        robotVehicleFake(hass).robot = false;
      },
      <RobotTile />,
    );
    expect(await within(view()).findByText(/Forbind robotten i Home Assistant/)).toBeTruthy();
    expect(document.getElementById('home-robot')).toBeNull();
  });

  it('the Home tile line is the robot’s status and battery', async () => {
    mount(undefined, <RobotTile />);
    await waitFor(() => {
      expect(document.getElementById('home-robot')?.textContent).toContain('I basen · 87 %');
    });
  });
});
