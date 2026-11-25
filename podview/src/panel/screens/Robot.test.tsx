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

  it('Robot and Bil are pushed by the integration, never polled as recorded service calls', async () => {
    mount();
    expect(await within(view()).findByText('I basen')).toBeTruthy();
    expect(fake.ws.map(message => message.type)).toEqual(
      expect.arrayContaining(['podvoice/robot_subscribe', 'podvoice/vehicle_subscribe']),
    );
    // A change of the vacuum is pushed: the screen follows without a read.
    act(() => {
      fake.patch('vacuum.qrevo', 'cleaning');
    });
    expect(await within(view()).findByRole('button', {name: 'Pause'})).toBeTruthy();
    const polled = fake.calls.filter(call => /^(robot|vehicle)_panel_state$/.test(call.service));
    expect(polled).toEqual([]);
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
    // The robot answers when the test says so: the wish is seen before HA's next state.
    fake.mode = 'silent';
    await user.click(pause);
    expect(pause.dataset.busy).toBe('true');
    act(() => {
      fake.patch('vacuum.qrevo', 'paused');
    });
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

  it('Kør til basen (under »Mere ▾«) asks first in the kit dialog; cancel sends nothing, nothing inert', async () => {
    const user = userEvent.setup();
    mount(hass => {
      hass.patch('vacuum.qrevo', 'cleaning');
    });
    // At most two keys in the hero: the primary and »Mere ▾«, which folds out what else is possible now.
    const more = await within(view()).findByRole('button', {name: 'Mere'});
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(within(view()).queryByRole('button', {name: 'Kør til basen'})).toBeNull();
    await user.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    await user.click(await within(view()).findByRole('button', {name: 'Kør til basen'}));
    const dialog = await screen.findByRole('alertdialog', {name: 'Kør til basen?'});
    expect(within(dialog).getByText('Robotten sendes til basen.')).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBe(within(dialog).getByText('Robotten sendes til basen.').id);
    await user.click(within(dialog).getByRole('button', {name: 'Behold turen'}));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    // The page behind is hidden only while the dialog asks. The answer card's hidden parts are inert by the wall
    // page's design (AnswerCard.tsx); nothing else is.
    // Hidden stack screens are inert (G7 #19); nothing else is.
    expect([...document.querySelectorAll('[inert]:not([data-screen]:not([data-place=center]))')]).toEqual([]);
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(robotCalls()).toHaveLength(0);
    await user.click(within(view()).getByRole('button', {name: 'Kør til basen'}));
    const again = await screen.findByRole('alertdialog', {name: 'Kør til basen?'});
    await user.click(within(again).getByRole('button', {name: 'Kør til basen'}));
    expect(robotCalls()).toHaveLength(1);
    expect(robotCalls()[0]?.data.action).toBe('return');
    expect(await within(view()).findByRole('heading', {name: 'Til basen'})).toBeTruthy();
  });

  it('Afslut rengøring tells what happens and is not the same as Pause', async () => {
    const user = userEvent.setup();
    mount(hass => {
      hass.patch('vacuum.qrevo', 'cleaning');
    });
    await user.click(await within(view()).findByRole('button', {name: 'Mere'}));
    await user.click(await within(view()).findByRole('button', {name: 'Afslut rengøring'}));
    const dialog = await screen.findByRole('alertdialog', {name: 'Afslut rengøringen?'});
    expect(within(dialog).getByText(/Robotten sendes ikke til basen/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', {name: 'Behold turen'}));
    expect(robotCalls()).toHaveLength(0);
  });

  it('the hero says the state as a title, the progress only from a reported value, and the trip’s rooms', async () => {
    mount(hass => {
      hass.patch('vacuum.qrevo', 'cleaning');
    });
    expect(await within(view()).findByRole('heading', {name: 'Rengør'})).toBeTruthy();
    expect(within(view()).getByText('Støvsugning og gulvvask')).toBeTruthy();
    expect(within(view()).getByRole('img', {name: '38 %'})).toBeTruthy();
    // Denne tur: the newest confirmed start's rooms, while the robot's job matches it.
    const trip = within(view()).getByRole('list', {name: 'Rum på denne tur'});
    expect(within(trip).getByText('Køkkenalrum')).toBeTruthy();
    expect(within(trip).getByText('Stue')).toBeTruthy();
    // Docked: no progress is invented.
    act(() => {
      fake.patch('vacuum.qrevo', 'docked');
    });
    expect(await within(view()).findByRole('heading', {name: 'I basen'})).toBeTruthy();
    expect(within(view()).queryByRole('img', {name: /%$/})).toBeNull();
  });

  it('a fault is the red title with the recovery help; unknown is grey and says why nothing is confirmed', async () => {
    mount(hass => {
      hass.patch('vacuum.qrevo', 'error');
    });
    const title = await within(view()).findByRole('heading', {name: 'Robotten melder en fejl'});
    expect(title.className).toContain('text-pv-danger');
    expect(within(view()).queryByRole('button', {name: 'Mere'})).toBeNull();
    act(() => {
      fake.patch('vacuum.qrevo', 'unavailable');
    });
    expect(await within(view()).findByRole('heading', {name: 'Status ukendt'})).toBeTruthy();
    expect(await within(view()).findByText('Effekten af en kommando kan ikke bekræftes, før robotten svarer'))
      .toBeTruthy();
  });

  it('Vedligehold shows the robot’s own counters; a part nearly due is red', async () => {
    mount();
    const care = await within(view()).findByRole('region', {name: 'Vedligehold'});
    expect(within(care).getByRole('meter', {name: 'Hovedbørste: 142 t'})).toBeTruthy();
    const sensor = within(care).getByRole('meter', {name: 'Sensorer: 2 t'});
    expect(sensor.firstElementChild?.className).toContain('bg-pv-danger');
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
      expect(document.getElementById('home-robot')?.textContent).toContain('I basenBatteri 87 %');
    });
  });

  it('the Home tile pauses directly while the robot cleans, and »+N« counts the other vacuums', async () => {
    const user = userEvent.setup();
    mount(hass => {
      hass.patch('vacuum.qrevo', 'cleaning');
      robotVehicleFake(hass).secondRobot = true;
    }, <RobotTile />);
    // The tile rendered beside the shell (the shell's own Hjem is behind Robot, hidden).
    const own = () => [...document.querySelectorAll('#home-robot')].at(-1);
    await waitFor(() => {
      expect(own()?.getAttribute('aria-label')).toContain('1 robot mere');
    });
    const tile = own()?.parentElement?.parentElement ?? document.body;
    await user.click(within(tile).getByRole('button', {name: 'Pause'}));
    expect(robotCalls().map(call => call.data.action)).toEqual(['pause']);
  });
});
