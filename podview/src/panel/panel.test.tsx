import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {Providers} from '../app/Providers';
import {commands} from '../lib/ha/commands';
import {createFakeHass, FAKE_PANEL} from '../lib/ha/ha-fixture';
import type {FakeHass} from '../lib/ha/ha-fixture';
import {transport} from '../lib/ha/transport';
import {useNav, resetNav, routeArea} from './nav';
import {PREVIOUS_KEEP_MS, Shell, STALE_TEXT, WARM_KEEP_MS} from './Shell';

let fake: FakeHass;

function mount(config: Record<string, unknown> = {}) {
  // Only this test's fake feeds the transport (an earlier test's fake may still publish late effects).
  let own: FakeHass | null = null;
  own = createFakeHass({confirmMs: 50, onChange: hass => {
    if (!own || fake !== own) return;
    act(() => {
      transport.setHass(hass);
    });
  }});
  fake = own;
  transport.setPanel({...FAKE_PANEL, config: {...FAKE_PANEL.config, ...config}});
  transport.setHass(fake.hass);
  // Each test starts from an empty cache (test/setup.ts): write everything, as a page that wakes up does.
  transport.resync();
  return render(
    <Providers>
      <Shell />
    </Providers>,
  );
}

const home = () => screen.getByRole('heading', {level: 1, name: 'Køkkenalrum'});

describe('PodView HA panel', () => {
  beforeEach(() => {
    resetNav();
    commands.store.setState({wishes: {}});
  });

  it('shows the room from HA areas with its tiles, all from HA data', async () => {
    mount();
    expect(home()).toBeTruthy();
    expect(screen.getByRole('radio', {name: 'Stue'})).toBeTruthy();
    expect(screen.getByRole('button', {name: /Musik.*Holocene · Bon Iver/})).toBeTruthy();
    expect(screen.getByRole('button', {name: /Lys.*1 af 2 tændt/})).toBeTruthy();
    expect(await screen.findByRole('button', {name: /Timer.*Start en timer/})).toBeTruthy();
    // The aside shows the room's own speaker with its HA state.
    expect(screen.getByRole('article', {name: 'Køkkenalrum: Spiller'})).toBeTruthy();
  });

  it('switches room on tap and shows that room’s speaker', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('radio', {name: 'Stue'}));
    expect(screen.getByRole('heading', {level: 1, name: 'Stue'})).toBeTruthy();
    expect(screen.getByRole('article', {name: 'Stue: På pause'})).toBeTruthy();
  });

  it('Lys: a tap shows the wish at once, HA confirms it, and nothing is ever inert', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', {name: /Lys/}));
    const lamp = await screen.findByRole('switch', {name: /Køkkenø: Slukket/});
    await user.click(lamp);
    expect(screen.getByRole<HTMLInputElement>('switch', {name: /Køkkenø: Tændt/}).checked).toBe(true);
    expect(fake.calls.at(-1)).toMatchObject({domain: 'light', service: 'turn_on', entityId: 'light.kokken_o'});
    await waitFor(() => {
      expect(fake.hass.states['light.kokken_o']?.state).toBe('on');
    });
    await waitFor(() => {
      expect(commands.store.getState().wishes['light.kokken_o:power']).toBeUndefined();
    });
    // The answer card's hidden parts are inert by the wall page's design (AnswerCard.tsx); nothing else is.
    expect([...document.querySelectorAll('[inert]')]).toEqual([]);
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('Musik: pause shows at once; the next tap is never blocked', async () => {
    const user = userEvent.setup();
    mount();
    const aside = screen.getByRole('complementary', {name: 'Rummets musik'});
    await user.click(within(aside).getByRole('button', {name: 'Pause'}));
    expect(within(aside).getByRole('button', {name: 'Afspil'})).toBeTruthy();
    await user.click(within(aside).getByRole('button', {name: 'Afspil'}));
    expect(fake.calls.filter(call => call.domain === 'media_player').map(call => call.service)).toEqual([
      'media_pause', 'media_play']);
    await user.click(within(aside).getByRole('button', {name: 'Næste'}));
    await waitFor(() => {
      expect(within(aside).getByText('Re: Stacks')).toBeTruthy();
    });
  });

  it('Musik: an unconfirmed tap ends as an honest unknown, never resent', async () => {
    const user = userEvent.setup();
    mount();
    fake.mode = 'refuse';
    const aside = screen.getByRole('complementary', {name: 'Rummets musik'});
    await user.click(within(aside).getByRole('button', {name: 'Pause'}));
    expect(await within(aside).findByText(/Home Assistant afviste handlingen/)).toBeTruthy();
    expect(fake.calls.filter(call => call.domain === 'media_player')).toHaveLength(1);
  });

  it('Vejr: the weather entity and its pushed forecasts through the existing weather screen', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', {name: /Let skyet/}));
    expect(await screen.findByText('De næste dage')).toBeTruthy();
    expect(screen.getByRole('heading', {level: 1, name: 'Vejr'})).toBeTruthy();
    // One subscription per forecast type (Hjem's tile and Vejr share it); no service call is ever made for them.
    const subscribed = fake.ws.filter(message => message.type === 'weather/subscribe_forecast');
    expect(subscribed.map(message => message.forecast_type).sort()).toEqual(['daily', 'hourly']);
    expect(fake.calls.filter(call => call.service === 'get_forecasts')).toEqual([]);
    // A state update of the entity does not fetch again.
    act(() => {
      fake.patch('weather.forecast_hjem', null, {temperature: 8.1});
    });
    expect(fake.ws.filter(message => message.type === 'weather/subscribe_forecast')).toHaveLength(2);
  });

  it('Timer: starts on the bridge and shows the bridge’s timer', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', {name: /Timer/}));
    await user.click(await screen.findByRole('button', {name: '3 min'}));
    expect(fake.calls.find(call => call.service === 'timer_command_v2')?.data).toMatchObject({
      endpoint: 'kokken', action: 'start', seconds: 180, epoch: 'e'.repeat(32)});
    expect(await screen.findByRole('group', {name: /Timer/})).toBeTruthy();
  });

  it('Back returns to Hjem', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', {name: /Lys/}));
    await user.click(screen.getByRole('button', {name: 'Tilbage'}));
    await waitFor(() => {
      expect(screen.queryByRole('button', {name: 'Tilbage'})).toBeNull();
    });
    expect(home()).toBeTruthy();
  });

  it('keeps only Hjem, the current and the previous screen mounted; others are built on a visit', async () => {
    const user = userEvent.setup();
    mount();
    const mounted = () =>
      [...document.querySelectorAll<HTMLElement>('.pv-panel-screen')].map(node => node.dataset.screen);
    expect(mounted()).toEqual(['home']);
    await user.click(screen.getByRole('button', {name: /^Lys/}));
    expect(mounted()).toEqual(['home', 'lights']);
    await user.click(screen.getByRole('button', {name: 'Tilbage'}));
    await user.click(screen.getByRole('button', {name: /^Musik/}));
    // Lys is no longer current or previous: let go at once; Hjem is the previous screen.
    expect(mounted()).toEqual(['home', 'music']);
    await user.click(screen.getByRole('button', {name: 'Tilbage'}));
    expect(mounted()).toEqual(['home', 'music']);
    // The previous screen is let go after a while without a visit.
    act(() => {
      useNav.getState().forget('music');
    });
    expect(mounted()).toEqual(['home']);
    expect(PREVIOUS_KEEP_MS).toBeGreaterThanOrEqual(30_000);
    expect(document.querySelector('[inert]')).toBeNull();
  });

  it('a finger on a tile builds its screen before the release; a tile left alone lets it go', () => {
    vi.useFakeTimers();
    try {
      mount();
      const tile = screen.getByRole('button', {name: /^Lys/});
      act(() => {
        tile.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
      });
      const lights = document.querySelector('.pv-panel-screen[data-screen="lights"]');
      expect(lights?.getAttribute('data-place')).toBe('after');
      expect(lights?.getAttribute('aria-hidden')).toBe('true');
      act(() => {
        vi.advanceTimersByTime(WARM_KEEP_MS + 10);
      });
      expect(document.querySelector('.pv-panel-screen[data-screen="lights"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns to Hjem in the URL\'s room after the configured idle time', () => {
    vi.useFakeTimers();
    try {
      mount({idle_home_seconds: 30});
      act(() => {
        useNav.getState().setRouteRoom('kokken');
        useNav.getState().setRoom('stue');
        useNav.getState().push('lights');
      });
      act(() => {
        vi.advanceTimersByTime(29_000);
      });
      expect(useNav.getState().stack).toHaveLength(2);
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(useNav.getState().stack).toHaveLength(1);
      expect(screen.getByRole('heading', {level: 1, name: 'Køkkenalrum'})).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes the room from the panel URL, else the integration\'s default area, else the main room', () => {
    expect(routeArea({prefix: '/podview', path: '/stue'})).toBe('stue');
    expect(routeArea({prefix: '/podview', path: ''})).toBeNull();
    expect(routeArea({prefix: '/podview', path: '/../x y'})).toBeNull();
    mount({default_area: 'stue'});
    expect(screen.getByRole('heading', {level: 1, name: 'Stue'})).toBeTruthy();
    act(() => {
      useNav.getState().setRouteRoom('kokken');
    });
    expect(screen.getByRole('heading', {level: 1, name: 'Køkkenalrum'})).toBeTruthy();
    act(() => {
      useNav.getState().setRouteRoom('gone');
    });
    expect(screen.getByRole('heading', {level: 1, name: 'Stue'})).toBeTruthy();
  });

  it('uses the weather entity the integration\'s options name', () => {
    mount({weather_entity: 'weather.not_in_ha'});
    // Unknown to HA: the first weather entity HA has.
    expect(screen.getByRole('button', {name: /Let skyet/})).toBeTruthy();
  });

  it('without a link: cards are marked last known, and a tap says it was not sent', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', {name: /^Lys/}));
    act(() => {
      fake.setConnected(false);
    });
    expect(screen.getAllByText(STALE_TEXT).length).toBeGreaterThan(0);
    expect(document.querySelector('pv-widget-host')?.getAttribute('data-link')).toBe('offline');
    await user.click(screen.getByRole('switch', {name: /Køkkenø/}));
    expect(await screen.findByText('Ikke sendt – ingen forbindelse')).toBeTruthy();
    expect(screen.queryByText(/Udfald ukendt/)).toBeNull();
    expect(fake.calls.filter(call => call.domain === 'light')).toHaveLength(0);
    act(() => {
      fake.setConnected(true);
    });
    expect(screen.queryByText(STALE_TEXT)).toBeNull();
  });

  it('Timer: pushed by the bridge, never polled; a tap on one timer never shows on another', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', {name: /^Timer/}));
    await user.click(await screen.findByRole('button', {name: '3 min'}));
    await user.click(await screen.findByRole('button', {name: '5 min'}));
    await waitFor(() => {
      expect(screen.getAllByRole('group', {name: /Timer/}).length).toBeGreaterThanOrEqual(2);
    });
    expect(fake.calls.filter(call => call.service === 'timer_status')).toEqual([]);
    const subscriptions = fake.ws.filter(message => message.type === 'podvoice/timer_subscribe');
    expect(subscriptions).toHaveLength(1);
    await waitFor(() => {
      expect(Object.keys(commands.store.getState().wishes)).toEqual([]);
    });
  });
});
