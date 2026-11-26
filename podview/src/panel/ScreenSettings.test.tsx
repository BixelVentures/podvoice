import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it} from 'vitest';
import {Providers} from '../app/Providers';
import {commands} from '../lib/ha/commands';
import {photoAlbum} from '../lib/ha/fixtures/photos';
import {WALL, wallSettings} from '../lib/ha/fixtures/wall';
import {createFakeHass, FAKE_PANEL} from '../lib/ha/ha-fixture';
import type {FakeHass} from '../lib/ha/ha-fixture';
import {transport} from '../lib/ha/transport';
import {findWallDevices} from '../lib/ha/wall';
import {resetNav} from './nav';
import {restClock} from './Rest';
import {DIM_KIOSK_TEXT, DIM_NO_KIOSK_TEXT, KIOSK_OFF_NOTE, KIOSK_TEXT, NO_ALBUM_TEXT, NO_KIOSK_TEXT}
  from './ScreenSettings';
import {useScreenSettings} from './screen-settings';
import {Shell} from './Shell';

let fake: FakeHass;

function mount() {
  let own: FakeHass | null = null;
  own = createFakeHass({confirmMs: 20, onChange: hass => {
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

const openSheet = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', {name: /Skærm og enhed$/}));
  return screen.findByRole('dialog', {name: 'Skærm og enhed'});
};

describe('Skærm og enhed (A-Skaerm)', () => {
  beforeEach(() => {
    resetNav();
    commands.store.setState({wishes: {}});
    localStorage.clear();
    useScreenSettings.setState({autoDim: true});
    photoAlbum.reset();
  });

  it('opens from the topbar clock: the brightness of the wall through the Companion app\'s kiosk mode', async () => {
    const user = userEvent.setup();
    mount();
    const sheet = await openSheet(user);
    expect(within(sheet).getByText(KIOSK_TEXT)).toBeTruthy();
    const slider = within(sheet).getByRole('slider', {name: 'Lysstyrke'});
    expect((slider as HTMLInputElement).value).toBe('70');
    expect(within(sheet).getByText('70 %')).toBeTruthy();
    // The canvas's rows: Wi-Fi, the device and the room; no »Denne skærm« section.
    expect(within(sheet).getByText('Hjemme')).toBeTruthy();
    expect(within(sheet).getByText('iPad Air · Køkken-iPad')).toBeTruthy();
    // The room row says what it shows (»Rum«, G7 #23), not »Hjemmet«.
    expect(within(sheet).getByText('Køkkenalrum').previousElementSibling?.textContent).toBe('Rum');
    expect(within(sheet).queryByText('Hjemmet')).toBeNull();
    expect(within(sheet).queryByText(/Denne skærm|Tilpas|Fastgør|Skjul widget/)).toBeNull();
    // The version line moved here from the stage, visible, under its label »Version«.
    expect(within(sheet).getByText(/^PodVoice 0\.1\.25 · build /).previousElementSibling?.textContent)
      .toBe('Version');
    // A keyboard step is one command: kiosk_set_brightness on the app's notify service.
    act(() => {
      slider.focus();
    });
    await user.keyboard('{ArrowRight}');
    await waitFor(() => {
      expect(fake.calls.filter(call => call.domain === 'notify')).toHaveLength(1);
    });
    expect(fake.calls.find(call => call.domain === 'notify')).toMatchObject({service: WALL.notify,
      data: {message: 'kiosk_set_brightness', data: {level: 71}}});
    await waitFor(() => {
      expect(fake.hass.states[WALL.brightness]?.state).toBe('71');
    });
    expect(within(sheet).getByText('71 %')).toBeTruthy();
    await user.click(within(sheet).getByRole('button', {name: 'Luk'}));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', {name: 'Skærm og enhed'})).toBeNull();
    });
  });

  it('without kiosk mode the brightness is shown as unavailable, never faked', async () => {
    const user = userEvent.setup();
    mount();
    act(() => {
      fake.patch(WALL.kiosk, 'off');
    });
    const sheet = await openSheet(user);
    const slider = within(sheet).getByRole('slider', {name: 'Lysstyrke'});
    expect(slider.hasAttribute('disabled')).toBe(true);
    expect(within(sheet).getByText(KIOSK_OFF_NOTE)).toBeTruthy();
    await user.keyboard('{ArrowRight}');
    expect(fake.calls.filter(call => call.domain === 'notify')).toHaveLength(0);
  });

  it('with no Companion kiosk device at all it says so', async () => {
    const user = userEvent.setup();
    mount();
    act(() => {
      fake.removeEntities([WALL.brightness, WALL.kiosk, WALL.ssid]);
    });
    expect(findWallDevices(fake.hass)).toEqual([]);
    const sheet = await openSheet(user);
    expect(within(sheet).getByText(NO_KIOSK_TEXT)).toBeTruthy();
    // Wi-Fi and the device are not known (once the integration has answered again); the room still is.
    await waitFor(() => {
      expect(within(sheet).getAllByText('Ikke oplyst')).toHaveLength(2);
    });
    expect(within(sheet).getByText('—')).toBeTruthy();
  });

  it('automatic dimming is on by default; off, Ro keeps its day look at night', async () => {
    const user = userEvent.setup();
    mount();
    const sheet = await openSheet(user);
    const dim = within(sheet).getByRole('switch', {name: 'Automatisk dæmpning'});
    expect((dim as HTMLInputElement).checked).toBe(true);
    await user.click(dim);
    expect(useScreenSettings.getState().autoDim).toBe(false);
    expect(JSON.parse(localStorage.getItem('podview.screen-settings.v1') ?? '{}')).toMatchObject(
      {state: {autoDim: false}});
    // Ro's clock still knows it is night; the dimming follows the setting (Rest.tsx).
    expect(restClock(new Date('2026-11-19T22:30:00+01:00')).night).toBe(true);
  });

  it('G3: without a link to Home Assistant »Prøv igen« reads everything again and sends nothing', async () => {
    const user = userEvent.setup();
    mount();
    const sheet = await openSheet(user);
    expect(within(sheet).getByText('Forbundet')).toBeTruthy();
    act(() => {
      fake.setConnected(false);
    });
    expect(await within(sheet).findByText('Ingen forbindelse')).toBeTruthy();
    act(() => {
      fake.connected = true;
    });
    await user.click(within(sheet).getByRole('button', {name: 'Prøv igen'}));
    // Reads again (the catalogue, the timers); no action is sent or repeated.
    expect(fake.calls.filter(call => ['light', 'media_player', 'notify', 'scene'].includes(call.domain)
      || call.service.includes('command'))).toHaveLength(0);
  });
  it('Fotoalbum: the album\'s name, »N billeder · opdateret hh.mm« and »Hent nu«, which reads it at once', async () => {
    const user = userEvent.setup();
    mount();
    const sheet = await openSheet(user);
    const row = await waitFor(() => {
      const found = sheet.querySelector<HTMLElement>('[data-photo-album]');
      if (!found) throw new Error('no Fotoalbum row');
      expect(found.textContent).toContain('4 billeder · opdateret 16.15');
      return found;
    });
    expect(within(row).getByText('HA podview')).toBeTruthy();
    photoAlbum.add('A-new');
    await user.click(within(row).getByRole('button', {name: 'Hent nu'}));
    await waitFor(() => {
      expect(row.textContent).toContain('5 billeder · opdateret');
    });
    expect(fake.calls.filter(call => call.service === 'photos_refresh')).toHaveLength(1);
  });

  it('Fotoalbum without a link says where to set it, and has no »Hent nu«', async () => {
    const user = userEvent.setup();
    photoAlbum.configured = false;
    mount();
    const sheet = await openSheet(user);
    expect(await within(sheet).findByText(NO_ALBUM_TEXT)).toBeTruthy();
    expect(within(sheet).queryByRole('button', {name: 'Hent nu'})).toBeNull();
  });

  it('Automatisk dæmpning is kept in Home Assistant, which dims the screen; the slider sets the day level', async () => {
    const user = userEvent.setup();
    mount();
    const sheet = await openSheet(user);
    expect(await within(sheet).findByText(DIM_KIOSK_TEXT(10))).toBeTruthy();
    await user.click(within(sheet).getByRole('switch', {name: 'Automatisk dæmpning'}));
    await waitFor(() => {
      expect(wallSettings.autoDim).toBe(false);
    });
    expect(fake.calls.find(call => call.service === 'wall' && 'auto_dim' in call.data)?.data).toEqual({auto_dim: false});
    const slider = within(sheet).getByRole('slider', {name: 'Lysstyrke'});
    act(() => {
      slider.focus();
    });
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => {
      expect(wallSettings.dayBrightness).toBe(69);
    });
    // Without kiosk mode the row says only Ro changes.
    act(() => {
      fake.patch(WALL.kiosk, 'off');
    });
    await user.click(within(sheet).getByRole('button', {name: 'Luk'}));
    const again = await openSheet(user);
    expect(await within(again).findByText(DIM_NO_KIOSK_TEXT)).toBeTruthy();
  });

  it('the wall is the device Home Assistant names for this user, not the first kiosk device by name', async () => {
    const user = userEvent.setup();
    mount();
    // An iPhone that also has kiosk sensors and sorts first by name.
    act(() => {
      fake.addEntities([
        {entity_id: 'sensor.anna_iphone_kiosk_brightness', state: '40', attributes: {},
          last_changed: '', last_updated: ''},
        {entity_id: 'binary_sensor.anna_iphone_kiosk_mode', state: 'on', attributes: {},
          last_changed: '', last_updated: ''},
      ], {'sensor.anna_iphone_kiosk_brightness': {entity_id: 'sensor.anna_iphone_kiosk_brightness',
        device_id: 'device-anna', platform: 'mobile_app'}},
      {'device-anna': {id: 'device-anna', area_id: null, name: 'Annas iPhone', model: 'iPhone 15'}});
    });
    expect(findWallDevices(fake.hass)[0]?.slug).toBe('anna_iphone');
    const sheet = await openSheet(user);
    await waitFor(() => {
      expect(within(sheet).getByText('iPad Air · Køkken-iPad')).toBeTruthy();
    });
    expect(within(sheet).getByRole<HTMLInputElement>('slider', {name: 'Lysstyrke'}).value).toBe('70');
  });
});
