// Lys and Hjem's Lys widget against the fake HA with the owner's Hue shape (lib/ha/fixtures/lights.ts): Hue room
// groups are the rooms' power, never lamps; scenes come from the area and the active one from Hue's scene select;
// unavailable lamps are shown, locked and uncounted; »Sluk alt« / »Gendan lys«; a drag never switches a lamp.
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it} from 'vitest';
import {Providers} from '../../app/Providers';
import {commands} from '../../lib/ha/commands';
import {HUE} from '../../lib/ha/fixtures/lights';
import {createFakeHass, FAKE_PANEL} from '../../lib/ha/ha-fixture';
import type {FakeHass} from '../../lib/ha/ha-fixture';
import {transport} from '../../lib/ha/transport';
import {resetTapGuard} from '../../ui';
import {resetNav} from '../nav';
import {Shell} from '../Shell';
import {useLightSession} from './Lights';

let fake: FakeHass;

function mount(confirmMs = 30) {
  let own: FakeHass | null = null;
  own = createFakeHass({confirmMs, onChange: hass => {
    if (!own || fake !== own) return;
    act(() => {
      transport.setHass(hass);
    });
  }});
  fake = own;
  transport.setPanel(FAKE_PANEL);
  transport.setHass(fake.hass);
  transport.resync();
  return render(<Providers><Shell /></Providers>);
}

const lightCalls = () => fake.calls.filter(call => call.domain === 'light' || call.domain === 'scene');

async function openLights(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', {name: /^Lys/}));
  return screen.findByRole('region', {name: 'Køkkenalrum'});
}

describe('Lys with Philips Hue', () => {
  beforeEach(() => {
    resetNav();
    resetTapGuard();
    commands.store.setState({wishes: {}});
    useLightSession.setState({selected: null, folds: {}, restore: null});
  });

  it('Hjem: the room group is no lamp, and »+N« counts the other light rooms', () => {
    mount();
    // Køkkenalrum has two lamps and its Hue group: »1 af 2«, never »… af 3«.
    const widget = screen.getByRole('button', {name: /^Lys/});
    expect(widget.getAttribute('aria-label')).toMatch(/^Lys, Tændt, 1 rum mere · 1 af 2 tændt$/);
    expect(within(widget).getByText('+1')).toBeTruthy();
    expect(within(widget).getByText('Køkkenalrum · 50 %')).toBeTruthy();
  });

  it('rooms: this screen’s room first, groups and unplaced lamps never shown as lamps', async () => {
    const user = userEvent.setup();
    mount();
    const panel = await openLights(user);
    const cards = [...document.querySelectorAll('[data-room-id]')].map(node => node.getAttribute('data-room-id'));
    expect(cards).toEqual(['kokken', 'stue']);
    expect(within(panel).getByText('1 af 2 lamper tændt')).toBeTruthy();
    expect(within(panel).getByText('2 stk.')).toBeTruthy();
    const lamps = [...panel.querySelectorAll('[data-lamp-id]')].map(node => node.getAttribute('data-lamp-id'));
    expect(lamps).toEqual(['light.kokken_loft', 'light.kokken_o']);
    expect(document.querySelector(`[data-lamp-id="${HUE.unplaced}"]`)).toBeNull();
  });

  it('a room’s switch powers its Hue group in one call and shows the wish at once', async () => {
    const user = userEvent.setup();
    mount();
    await openLights(user);
    const power = screen.getByRole('switch', {name: 'Sluk alle lys i Køkkenalrum'});
    await user.click(power);
    expect(lightCalls()).toEqual([expect.objectContaining({domain: 'light', service: 'turn_off',
      entityId: HUE.kokkenGroup})]);
    // The lamps follow the room's switch at once; HA's group state confirms it.
    expect(screen.getByRole<HTMLInputElement>('switch', {name: 'Tænd Køkken loft'}).checked).toBe(false);
    await waitFor(() => {
      expect(fake.hass.states['light.kokken_loft']?.state).toBe('off');
    });
    await waitFor(() => {
      expect(commands.store.getState().wishes[`${HUE.kokkenGroup}:power`]).toBeUndefined();
    });
    expect(screen.getByRole('switch', {name: 'Tænd alle lys i Køkkenalrum'})).toBeTruthy();
  });

  it('scenes: the select’s scene is chosen; a tap runs scene.turn_on and shows it chosen before HA confirms', async () => {
    const user = userEvent.setup();
    mount(400);
    const panel = await openLights(user);
    const scenes = within(panel).getByRole('group', {name: 'Scener i Køkkenalrum'});
    expect(within(scenes).getByRole('button', {name: /Natlys/}).getAttribute('aria-pressed')).toBe('true');
    // A scene with Hue's brightness shows it; one without shows no % (never invented).
    expect(within(scenes).getByRole('button', {name: /Natlys/}).textContent).toBe('Natlys50 %');
    expect(within(scenes).getByRole('button', {name: 'Slap af'}).textContent).toBe('Slap af');
    await user.click(within(scenes).getByRole('button', {name: /Læs/}));
    expect(lightCalls().at(-1)).toMatchObject({domain: 'scene', service: 'turn_on',
      entityId: 'scene.kokkenalrum_kokkenalrum_laes'});
    const laes = within(scenes).getByRole('button', {name: /Læs/});
    expect(laes.getAttribute('aria-pressed')).toBe('true');
    expect(laes.getAttribute('data-sending')).toBe('true');
    await waitFor(() => {
      expect(fake.hass.states[HUE.kokkenSelect]?.state).toBe('Læs');
    });
    await waitFor(() => {
      expect(within(scenes).getByRole('button', {name: /Læs/}).getAttribute('data-sending')).toBeNull();
    });
    expect(within(scenes).getByRole('button', {name: /Natlys/}).getAttribute('aria-pressed')).toBe('false');
  });

  it('a lamp change leaves the scene: the select says so and no tile stays chosen', async () => {
    const user = userEvent.setup();
    mount();
    const panel = await openLights(user);
    await user.click(screen.getByRole('switch', {name: 'Tænd Køkkenø'}));
    await waitFor(() => {
      expect(fake.hass.states[HUE.kokkenSelect]?.state).toBe('unknown');
    });
    const scenes = within(panel).getByRole('group', {name: 'Scener i Køkkenalrum'});
    expect(within(scenes).getAllByRole('button').filter(tile => tile.getAttribute('aria-pressed') === 'true'))
      .toEqual([]);
  });

  it('unavailable lamps are shown locked and counted neither on nor off; the fold opens with more than two', async () => {
    const user = userEvent.setup();
    mount();
    await openLights(user);
    const stue = document.querySelector<HTMLElement>('[data-room-id="stue"]');
    if (!stue) throw Error('no Stue card');
    await user.click(within(stue).getByRole('button', {pressed: false}));
    const panel = await screen.findByRole('region', {name: 'Stue'});
    expect(within(panel).getByText('1 af 1 lamper tændt')).toBeTruthy();
    expect(within(panel).getByText('3 stk.')).toBeTruthy();
    // Three lamps: the fold starts closed.
    const fold = within(panel).getByRole('button', {name: /Lamper/});
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    await user.click(fold);
    const mushroom = within(panel).getByRole<HTMLInputElement>('switch', {name: 'Tænd Mushroom'});
    expect(mushroom.disabled).toBe(true);
    expect(within(panel).getAllByText('Ikke forbundet')).toHaveLength(2);
  });

  it('»Sluk alt« turns every lit room off and »Gendan lys« brings the same lamps back at their level', async () => {
    const user = userEvent.setup();
    mount();
    await openLights(user);
    await user.click(screen.getByRole('button', {name: 'Sluk alle lys i hjemmet'}));
    expect(lightCalls().map(call => [call.service, call.entityId])).toEqual([
      ['turn_off', HUE.kokkenGroup], ['turn_off', HUE.stueGroup]]);
    const restore = await screen.findByRole('button', {name: 'Gendan lyset i hjemmet som før slukning'});
    expect(restore.textContent).toContain('Gendan lys');
    fake.calls.length = 0;
    await user.click(restore);
    expect(lightCalls().map(call => [call.service, call.entityId, call.data.brightness_pct])).toEqual([
      ['turn_on', 'light.kokken_loft', 50], ['turn_on', 'light.stue_lampe', 100]]);
    await screen.findByRole('button', {name: 'Sluk alle lys i hjemmet'});
  });

  it('the room’s brightness sets its group; a lamp’s own slider sets that lamp', async () => {
    const user = userEvent.setup();
    mount();
    const panel = await openLights(user);
    const room = within(panel).getByRole('slider', {name: 'Lysstyrke'});
    fireEvent.keyDown(room, {key: 'ArrowRight'});
    expect(lightCalls().at(-1)).toMatchObject({service: 'turn_on', entityId: HUE.kokkenGroup,
      data: {brightness_pct: 51}});
    const lamp = within(panel).getByRole('slider', {name: 'Lysstyrke for Køkken loft'});
    fireEvent.keyDown(lamp, {key: 'ArrowLeft'});
    expect(lightCalls().at(-1)).toMatchObject({service: 'turn_on', entityId: 'light.kokken_loft'});
  });

  it('a horizontal drag that starts on a lamp’s switch never switches it; a tap does', async () => {
    const user = userEvent.setup();
    mount();
    await openLights(user);
    const lamp = screen.getByRole('switch', {name: 'Tænd Køkkenø'});
    const label = lamp.closest('label');
    if (!label) throw Error('no label');
    await user.pointer([
      {keys: '[MouseLeft>]', target: label, coords: {clientX: 600, clientY: 700}},
      {target: label, coords: {clientX: 640, clientY: 702}},
      {target: label, coords: {clientX: 700, clientY: 703}},
      {keys: '[/MouseLeft]', target: label, coords: {clientX: 700, clientY: 703}},
    ]);
    expect(lightCalls()).toEqual([]);
    expect(screen.getByRole<HTMLInputElement>('switch', {name: 'Tænd Køkkenø'}).checked).toBe(false);
    await user.click(lamp);
    expect(lightCalls()).toEqual([expect.objectContaining({service: 'turn_on', entityId: 'light.kokken_o'})]);
  });

  it('without a link: »Status ukendt« and the info line; a tap still answers, as not sent', async () => {
    const user = userEvent.setup();
    mount();
    const panel = await openLights(user);
    act(() => {
      fake.setConnected(false);
    });
    expect(screen.getByText('Lysoplysninger kunne ikke hentes. Prøv igen.')).toBeTruthy();
    expect(within(panel).getAllByText('Status ukendt').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('switch', {name: 'Tænd Køkkenø'}));
    expect(await screen.findByText('Ikke sendt – ingen forbindelse')).toBeTruthy();
    expect(lightCalls()).toEqual([]);
  });

  it('no lights in HA: »Ikke forbundet« with »Opdater lys«; Hjem says the same', async () => {
    const user = userEvent.setup();
    mount();
    act(() => {
      fake.removeEntities(Object.keys(fake.hass.states).filter(id => id.startsWith('light.')));
    });
    expect(screen.getByRole('button', {name: /^Lys, Ikke forbundet/})).toBeTruthy();
    await user.click(screen.getByRole('button', {name: /^Lys/}));
    expect(await screen.findByRole('heading', {name: 'Ikke forbundet'})).toBeTruthy();
    expect(screen.getByText('Forbind lys i Home Assistant for at se og styre dem her.')).toBeTruthy();
    await user.click(screen.getByRole('button', {name: 'Opdater lys'}));
  });
});
