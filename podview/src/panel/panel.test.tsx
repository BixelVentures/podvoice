import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it} from 'vitest';
import {Providers} from '../app/Providers';
import {commands} from '../lib/ha/commands';
import {createFakeHass, FAKE_PANEL} from '../lib/ha/ha-fixture';
import type {FakeHass} from '../lib/ha/ha-fixture';
import {transport} from '../lib/ha/transport';
import {resetNav} from './nav';
import {Shell} from './Shell';

let fake: FakeHass;

function mount() {
  // Only this test's fake feeds the transport (an earlier test's fake may still publish late effects).
  let own: FakeHass | null = null;
  own = createFakeHass({confirmMs: 50, onChange: hass => {
    if (!own || fake !== own) return;
    act(() => {
      transport.setHass(hass);
    });
  }});
  fake = own;
  transport.setPanel(FAKE_PANEL);
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
    expect(screen.getByRole('switch', {name: /Køkkenø: Tændt/}).getAttribute('aria-checked')).toBe('true');
    expect(fake.calls.at(-1)).toMatchObject({domain: 'light', service: 'turn_on', entityId: 'light.kokken_o'});
    await waitFor(() => {
      expect(fake.hass.states['light.kokken_o']?.state).toBe('on');
    });
    await waitFor(() => {
      expect(commands.store.getState().wishes['light.kokken_o:power']).toBeUndefined();
    });
    // The answer card's hidden parts are inert by the wall page's design (AnswerCard.tsx); nothing else is.
    expect([...document.querySelectorAll('[inert]')].filter(node => !node.closest('pv-answer'))).toEqual([]);
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

  it('Vejr: the weather entity and its forecasts through the existing weather screen', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', {name: /Let skyet/}));
    expect(await screen.findByText('De næste dage')).toBeTruthy();
    expect(screen.getByRole('heading', {level: 1, name: 'Vejr'})).toBeTruthy();
    expect(fake.calls.filter(call => call.service === 'get_forecasts').map(call => call.data.type).sort()).toEqual([
      'daily', 'hourly']);
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
});
