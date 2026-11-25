import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Providers} from '../../app/Providers';
import {commands} from '../../lib/ha/commands';
import {createFakeHass, FAKE_PANEL} from '../../lib/ha/ha-fixture';
import type {FakeHass} from '../../lib/ha/ha-fixture';
import {bridgeTimers, nextTimerTick} from '../../lib/ha/timers';
import {transport} from '../../lib/ha/transport';
import {resetNav, useNav} from '../nav';
import {Shell} from '../Shell';
import {RECENT_MS} from './Timers';

const EPOCH = 'e'.repeat(32);
const status = (secondsLeft: number) => ({
  ok: true as const,
  epoch: EPOCH,
  endpoint: 'kokken',
  timers: [{id: 'pasta', name: 'Pasta', seconds_left: secondsLeft, state: 'active' as const, duration_seconds: 180}],
  finished: [],
  recent: [],
});

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
  fake.handle('podvoice.timer_status', () => ({response: status(180)}));
  transport.setPanel(FAKE_PANEL);
  transport.setHass(fake.hass);
  transport.resync();
  return render(
    <Providers>
      <Shell />
    </Providers>,
  );
}

describe('the timer counts down between pushes', () => {
  beforeEach(() => {
    resetNav();
    commands.store.setState({wishes: {}});
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts from the read, with the time passed in (no clock hidden in a default)', () => {
    const read = {status: status(180), readAt: 1_000_000};
    expect(bridgeTimers(read, 1_000_000)[0]?.remaining).toBe(180);
    expect(bridgeTimers(read, 1_002_400)[0]?.remaining).toBe(178);
    expect(nextTimerTick(read, 1_002_400)).toBe(1_003_000);
    expect(nextTimerTick({status: {...status(180), timers: []}, readAt: 0}, 5)).toBeNull();
  });

  it('the Home tile’s digits advance every second under the React Compiler', async () => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByRole('button', {name: /^Timer, 3:00 · Pasta/})).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByRole('button', {name: /^Timer, 2:59 · Pasta/})).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByRole('button', {name: /^Timer, 2:57 · Pasta/})).toBeTruthy();
  });
});

// The Timer screen on the kit (A-Timer, Timer-pause, Timer-faerdig; the old wall's draft card), on the fake bridge.
function mountPlain() {
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
  render(
    <Providers>
      <Shell />
    </Providers>,
  );
  act(() => {
    useNav.getState().push('timers');
  });
  return within(document.querySelector<HTMLElement>('#timers-view') ?? document.body);
}
const timerCalls = () => fake.calls.filter(call => call.service === 'timer_command_v2').map(call => call.data);

describe('Timer on the kit', () => {
  beforeEach(() => {
    resetNav();
    commands.store.setState({wishes: {}});
  });

  it('the draft: −/+ a minute, a preset fills it, »Start timer« starts it; running shows ±1 min, Annuller and '
    + '»Færdig kl.«', async () => {
    const user = userEvent.setup();
    const view = mountPlain();
    const time = await view.findByRole('status', {name: 'Valgt tid'});
    expect(time.textContent).toBe('5:00');
    await user.click(view.getByRole('button', {name: '1 minut mere'}));
    expect(time.textContent).toBe('6:00');
    await user.click(view.getByRole('button', {name: '1 minut mindre'}));
    await user.click(view.getByRole('button', {name: '1 minut mindre'}));
    expect(time.textContent).toBe('4:00');
    // A preset reads as chosen while the draft is its time (G7 #15); 5:00 is the 5 min chip's.
    const pressed = () => view.queryAllByRole('button', {pressed: true}).map(chip => chip.textContent);
    expect(pressed()).toEqual([]);
    await user.click(view.getByRole('button', {name: '10 min'}));
    expect(time.textContent).toBe('10:00');
    expect(pressed()).toEqual(['10 min']);
    expect(timerCalls()).toEqual([]);
    await user.click(view.getByRole('button', {name: 'Start timer'}));
    expect(timerCalls()).toMatchObject([{action: 'start', seconds: 600, name: ''}]);
    const face = await view.findByRole('article', {name: /^Timer · 10:00/});
    expect(within(face).getByText('Tæller ned')).toBeTruthy();
    expect(within(face).getByText(/^Færdig kl\. \d\d\.\d\d$/)).toBeTruthy();
    expect(within(face).getByText('af 10:00')).toBeTruthy();
    // A-Timer's running board: +1 min, −1 min, then Annuller (G7 #15, lead ruling).
    expect(within(within(face).getByRole('group', {name: 'Betjen timer'})).getAllByRole('button')
      .map(key => key.getAttribute('aria-label'))).toEqual(['1 minut mere', '1 minut mindre', 'Annuller timer']);
    // The draft steps aside while a timer runs; »Tidligere timere« stays, waiting.
    expect(view.queryByRole('form', {name: 'Ny timer'})).toBeNull();
    expect(view.getByRole<HTMLButtonElement>('button', {name: '10:00, Seneste. Justér før start'}).disabled)
      .toBe(true);
    await user.click(within(face).getByRole('button', {name: '1 minut mere'}));
    expect(timerCalls().at(-1)).toMatchObject({action: 'adjust', delta_seconds: 60});
    await user.click(within(face).getByRole('button', {name: 'Annuller timer'}));
    expect(timerCalls().at(-1)).toMatchObject({action: 'cancel'});
    // Cancelled: the draft is back, and »Tidligere timere« fills it (Justér før start).
    await user.click(await view.findByRole('button', {name: '10:00, Seneste. Justér før start'}));
    expect(view.getByRole('status', {name: 'Valgt tid'}).textContent).toBe('10:00');
  });

  it('paused by voice: »På pause«, the ring stands still; done: Stop alarm and »Start igen · 10 min« (T3)',
    async () => {
      const user = userEvent.setup();
      const view = mountPlain();
      await user.click(await view.findByRole('button', {name: '10 min'}));
      await user.click(view.getByRole('button', {name: 'Start timer'}));
      await view.findByRole('article', {name: /^Timer · /});
      act(() => {
        fake.pauseTimers(true);
      });
      const paused = await view.findByRole('article', {name: /På pause|Ringen står stille/});
      expect(within(paused).getByText('Timer på pause')).toBeTruthy();
      expect(paused.getAttribute('data-tone')).toBe('pause');
      act(() => {
        fake.finishTimers();
      });
      await waitFor(() => {
        expect(view.getByRole('article', {name: /Tiden er gået/}).getAttribute('data-tone')).toBe('faerdig');
      });
      // The full-screen alarm covers it; »Luk visning« shows the page's own done state.
      await user.click(await screen.findByRole('button', {name: 'Luk visning'}));
      const restart = await view.findByRole('button', {name: 'Start igen · 10 min'});
      expect(view.getByRole('button', {name: 'Stop alarm timer'})).toBeTruthy();
      await user.click(restart);
      await waitFor(() => {
        expect(timerCalls().slice(-2)).toMatchObject([{action: 'acknowledge_finished'},
          {action: 'start', seconds: 600}]);
      });
    });

  it('Hjem’s Timer: »Senest brugt« for six hours after the last timer, then an empty line', async () => {
    const user = userEvent.setup();
    const view = mountPlain();
    await user.click(await view.findByRole('button', {name: '3 min'}));
    await user.click(view.getByRole('button', {name: 'Start timer'}));
    const face = await view.findByRole('article', {name: /^Timer · /});
    await user.click(within(face).getByRole('button', {name: 'Annuller timer'}));
    await waitFor(() => {
      expect(document.querySelector('#home-timers')?.textContent).toContain('Senest brugt 3:00');
    });
    expect(RECENT_MS).toBe(6 * 3600_000);
    // Seven hours later the line is empty (and keeps its height).
    fake.handle('podvoice.timer_status', () => ({response: {ok: true, epoch: EPOCH, endpoint: 'kokken', timers: [],
      finished: [], recent: [{id: 'old', name: '', seconds: 180, accepted_at: Date.now() / 1000 - 7 * 3600}]}}));
    act(() => {
      transport.resync();
    });
    await waitFor(() => {
      expect(document.querySelector('#home-timers')?.textContent).not.toContain('Senest brugt');
    });
  });
});
