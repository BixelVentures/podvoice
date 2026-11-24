import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it} from 'vitest';
import {Providers} from '../../app/Providers';
import {commands} from '../../lib/ha/commands';
import {robotVehicleFake} from '../../lib/ha/fixtures/robot-vehicle';
import {createFakeHass, FAKE_PANEL} from '../../lib/ha/ha-fixture';
import type {FakeHass} from '../../lib/ha/ha-fixture';
import {transport} from '../../lib/ha/transport';
import {resetNav, useNav} from '../nav';
import {Shell} from '../Shell';
import {useRobotChoice} from './Robot';
import {useRobotDraft} from './robot-cleaning';

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
  const view = render(
    <Providers>
      <Shell />
    </Providers>,
  );
  act(() => {
    useNav.getState().push('robot');
  });
  return view;
}

const view = () => document.getElementById('robot-view') ?? document.body;
// A level rail (Type, Sugeevne, Antal gange …): a radiogroup named by its label.
const rail = (name: string) => within(view()).getByRole('radiogroup', {name});
const calls = (service: string) => fake.calls.filter(call => call.service === service);
const rooms = () => within(view()).findByRole('group', {name: 'Vælg rum'});

describe('Robot on HA: rooms, settings, recipes and the journal', () => {
  beforeEach(() => {
    resetNav();
    commands.store.setState({wishes: {}});
    useRobotDraft.setState({drafts: {}});
    useRobotChoice.setState({entityId: null});
  });

  it('S1: the page reads Robot on start, so the first open shows the robot, never »Henter aktuel betjening…«', async () => {
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
    transport.setPanel(FAKE_PANEL);
    transport.setHass(fake.hass);
    transport.resync();
    render(
      <Providers>
        <Shell />
      </Providers>,
    );
    // Hjem only: both of Robot's reads are made without the screen.
    await waitFor(() => {
      expect(calls('robot_cleaning_state')).toHaveLength(1);
    });
    expect(document.getElementById('robot-view')).toBeNull();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    act(() => {
      useNav.getState().push('robot');
    });
    // The first frame of the screen already has the rooms.
    expect(within(view()).queryByText('Henter aktuel betjening…')).toBeNull();
    expect(within(view()).getByRole('group', {name: 'Vælg rum'})).toBeTruthy();
  });

  it('shows the floor’s rooms and the settings HA has, with the old screen’s words', async () => {
    mount();
    const list = await rooms();
    expect(within(list).getAllByRole('button').map(button => button.textContent)).toEqual([
      'Entré',
      'Køkkenalrum',
      'Stue',
    ]);
    expect(within(view()).getByText('Stueplan')).toBeTruthy();
    const type = within(view()).getByRole('radiogroup', {name: 'Type'});
    expect(within(type).getByRole('radio', {name: 'Støvsug og vask'}).getAttribute('aria-checked')).toBe('true');
    const suction = within(view()).getByRole('radiogroup', {name: 'Sugeevne'});
    expect(within(suction).getByRole('radio', {name: 'Balanceret'}).getAttribute('aria-checked')).toBe('true');
    expect(within(view()).getByRole('radiogroup', {name: 'Vandmængde'})).toBeTruthy();
    expect(within(view()).getByRole('radiogroup', {name: 'Rute'})).toBeTruthy();
    const start = within(view()).getByRole('button', {name: 'Vælg rum'});
    expect(start.hasAttribute('disabled')).toBe(true);
    expect(within(view()).getByText('Vælg antal gange')).toBeTruthy();
  });

  it('Start sends the chosen rooms, repeat and settings once, from the offer the user saw', async () => {
    const user = userEvent.setup();
    mount();
    const list = await rooms();
    await user.click(within(list).getByRole('button', {name: 'Køkkenalrum'}));
    await user.click(within(list).getByRole('button', {name: 'Stue'}));
    await user.click(within(rail('Antal gange')).getByRole('radio', {name: '2×'}));
    await user.click(within(rail('Sugeevne')).getByRole('radio', {name: 'Turbo'}));
    expect(within(view()).getByText('Køkkenalrum, Stue · 2 gange', {selector: 'p'})).toBeTruthy();
    // The draft is not sent: nothing reaches HA before Start.
    expect(calls('robot_setting')).toHaveLength(0);
    await user.click(within(view()).getByRole('button', {name: 'Start · 2 rum'}));
    expect(calls('robot_start')).toHaveLength(1);
    expect(calls('robot_start')[0]?.data).toMatchObject({
      entity_id: 'vacuum.qrevo',
      area_ids: ['kokken', 'stue'],
      repeat: 2,
      settings: {cleaning_mode: 'vac_and_mop', mop_intensity: 'moderate', mop_mode: 'standard', suction: 'turbo'},
      expected_state: 'docked',
      revision: 'a'.repeat(64),
    });
    expect(calls('robot_start')[0]?.data.recipe_id).toBeUndefined();
    // The integration pushes the robot's room as soon as it cleans (podvoice/robot_subscribe), no poll in between.
    const hero = within(view());
    expect(await hero.findByText('Robotten er i Køkken', {selector: '[role=status]'}, {timeout: 3000})).toBeTruthy();
    await waitFor(
      () => {
        expect(commands.store.getState().wishes['vacuum.qrevo:start']).toBeUndefined();
      },
      {timeout: 3000},
    );
    expect(calls('robot_start')).toHaveLength(1);
  });

  it('Brug seneste valg fills the draft from the journal; the start names that recipe', async () => {
    const user = userEvent.setup();
    mount();
    await rooms();
    expect(within(view()).getByText('Seneste rumvalg', {selector: 'p'})).toBeTruthy();
    await user.click(within(view()).getByRole('button', {name: 'Brug seneste valg'}));
    expect(within(view()).getByRole('button', {name: 'Valg brugt'})).toBeTruthy();
    expect(within(view()).getByText('Køkkenalrum, Stue · 2 gange', {selector: 'p'})).toBeTruthy();
    const type = within(view()).getByRole('radiogroup', {name: 'Type'});
    expect(within(type).getByRole('radio', {name: 'Støvsug'}).getAttribute('aria-checked')).toBe('true');
    // Vacuum only: water and route do not apply (model.ts irrelevantSetting).
    expect(within(view()).queryByRole('group', {name: 'Vandmængde'})).toBeNull();
    await user.click(within(view()).getByRole('button', {name: 'Start · 2 rum'}));
    expect(calls('robot_start')[0]?.data).toMatchObject({
      area_ids: ['kokken', 'stue'],
      repeat: 2,
      recipe_id: '1'.repeat(32),
    });
    expect((calls('robot_start')[0]?.data.settings as Record<string, string>).suction).toBe('turbo');
  });

  it('Start denne rengøring repeats the latest recipe as it was', async () => {
    const user = userEvent.setup();
    mount();
    await rooms();
    const reuse = within(view()).getByRole('region', {name: 'Gentag den valgte rengøring'});
    expect(within(reuse).getByText('Køkkenalrum, Stue · 2 gange · Støvsug · Turbo')).toBeTruthy();
    await user.click(within(reuse).getByRole('button', {name: 'Start denne rengøring'}));
    expect(calls('robot_start')).toHaveLength(1);
    expect(calls('robot_start')[0]?.data).toMatchObject({
      area_ids: ['kokken', 'stue'],
      repeat: 2,
      settings: {cleaning_mode: 'vacuum', suction: 'turbo'},
      recipe_id: '1'.repeat(32),
    });
  });

  it('the journal lists the last starts; a recipe from another floor is not offered', async () => {
    mount(hass => {
      hass.patch('select.qrevo_selected_map', '1. sal');
    });
    const journal = await within(view()).findByRole('region', {name: 'Seneste rumvalg'});
    expect(within(journal).getByText('Valgte rum er ikke oplyst · 2 gange')).toBeTruthy();
    expect(within(view()).queryByRole('button', {name: 'Brug seneste valg'})).toBeNull();
    expect(within(view()).queryByRole('region', {name: 'Gentag den valgte rengøring'})).toBeNull();
    expect(within(await rooms()).getAllByRole('button').map(button => button.textContent)).toEqual(['Kontor']);
  });

  it('a refusal from the integration is shown honestly and never resent', async () => {
    const user = userEvent.setup();
    mount(hass => {
      hass.handle('podvoice.robot_start', () => ({response: {outcome: 'rejected', reason: 'changed_observation'}}));
    });
    await user.click(within(await rooms()).getByRole('button', {name: 'Stue'}));
    await user.click(within(rail('Antal gange')).getByRole('radio', {name: '1×'}));
    const start = within(view()).getByRole('button', {name: 'Start i Stue'});
    await user.click(start);
    expect(
      await within(view()).findByText('Home Assistant afviste handlingen: Du kan ikke ændre rengøringen her lige nu.'),
    ).toBeTruthy();
    expect(calls('robot_start')).toHaveLength(1);
    expect(start.hasAttribute('disabled')).toBe(false);
  });

  it('an earlier unknown start blocks the next one and says why', async () => {
    mount(hass => {
      robotVehicleFake(hass).journal.push({
        id: '2'.repeat(32),
        source: 'panel',
        recordedAt: Date.now() / 1000 - 60,
        outcome: 'unknown',
        mapName: 'Stueplan',
        areaIds: ['stue'],
        repeat: 1,
        settings: {},
      });
    });
    await rooms();
    expect(within(view()).getAllByText('Tidligere start er uvis; kontrollér robotten, gentag ikke').length).toBe(2);
    expect(within(view()).getByRole('button', {name: 'Vælg rum'}).hasAttribute('disabled')).toBe(true);
  });

  it('while the robot cleans, a setting is changed directly: one tap, one podvoice.robot_setting', async () => {
    const user = userEvent.setup();
    mount(hass => {
      hass.patch('vacuum.qrevo', 'cleaning');
    });
    const suction = await within(view()).findByRole('radiogroup', {name: 'Sugeevne'});
    expect(within(view()).queryByRole('group', {name: 'Vælg rum'})).toBeNull();
    await user.click(within(suction).getByRole('radio', {name: 'Turbo'}));
    expect(calls('robot_setting')).toHaveLength(1);
    expect(calls('robot_setting')[0]?.data).toMatchObject({
      entity_id: 'vacuum.qrevo',
      key: 'suction',
      setting_entity_id: 'vacuum.qrevo',
      value: 'turbo',
      expected_current: 'balanced',
    });
    await waitFor(() => {
      expect(fake.hass.states['vacuum.qrevo']?.attributes.fan_speed).toBe('turbo');
    });
    await waitFor(() => {
      expect(commands.store.getState().wishes['vacuum.qrevo:setting:suction']).toBeUndefined();
    });
    expect(within(suction).getByRole('radio', {name: 'Turbo'}).getAttribute('aria-checked')).toBe('true');
  });

  it('the floor is chosen while the robot rests; its rooms follow', async () => {
    const user = userEvent.setup();
    mount();
    await rooms();
    await user.selectOptions(within(view()).getByRole('combobox', {name: 'Vælg etage'}), '1. sal');
    expect(calls('robot_setting')[0]?.data).toMatchObject({key: 'map', value: '1. sal', expected_current: 'Stueplan'});
    await waitFor(async () => {
      expect(within(await rooms()).getAllByRole('button').map(button => button.textContent)).toEqual(['Kontor']);
    });
  });

  it('with one vacuum there is no choice; with two a segmented choice shows the chosen one', async () => {
    const user = userEvent.setup();
    const first = mount();
    await rooms();
    expect(within(view()).queryByRole('radiogroup', {name: 'Robotstøvsuger'})).toBeNull();
    first.unmount();
    mount(hass => {
      robotVehicleFake(hass).secondRobot = true;
    });
    const choice = await within(view()).findByRole('radiogroup', {name: 'Robotstøvsuger'});
    expect(within(choice).getByRole('radio', {name: 'Qrevo'}).getAttribute('aria-checked')).toBe('true');
    await user.click(within(choice).getByRole('radio', {name: 'S8'}));
    expect(await within(view()).findByText('Ingen rum at vælge på denne etage.')).toBeTruthy();
    expect(within(view()).getByRole('heading', {level: 1}).parentElement?.textContent).toContain('S8');
  });

  it('without the add-on its journal is said to be unavailable, the panel’s own still shows', async () => {
    mount(hass => {
      robotVehicleFake(hass).addon = 'addon_unavailable';
    });
    expect(await within(view()).findByText('PodVoice svarer ikke lige nu – prøv igen om et minut')).toBeTruthy();
    expect(within(view()).queryByRole('button', {name: 'Brug seneste valg'})).toBeNull();
  });
});

describe('the dialog belongs to React Aria', () => {
  it('nothing on the robot screen is a native modal', async () => {
    mount();
    await rooms();
    expect(document.querySelector('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
