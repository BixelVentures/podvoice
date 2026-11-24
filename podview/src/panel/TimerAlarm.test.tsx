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
import {alarmKicker, alarmRinging} from './TimerAlarm';

const EPOCH = 'e'.repeat(32);
let fake: FakeHass;
let finished: Record<string, unknown>[];
let acknowledged: Record<string, unknown>[];
let refuse = false;

function mount() {
  // Only this test's fake feeds the transport (an earlier test's fake may still publish late effects).
  let own: FakeHass | null = null;
  own = createFakeHass({confirmMs: 20, onChange: hass => {
    if (!own || fake !== own) return;
    act(() => {
      transport.setHass(hass);
    });
  }});
  fake = own;
  fake.handle('podvoice.timer_status', () => ({
    response: {ok: true, epoch: EPOCH, endpoint: 'kokken', timers: [], finished, recent: []},
  }));
  fake.handle('podvoice.timer_command_v2', data => {
    if (data.action !== 'acknowledge_finished') return undefined;
    acknowledged.push(data);
    if (refuse) return {response: {ok: false, error: 'timer_not_found', outcome: 'rejected'}};
    finished = finished.filter(row => row.id !== data.timer_id);
    return {response: {ok: true}};
  });
  transport.setPanel(FAKE_PANEL);
  transport.setHass(fake.hass);
  transport.resync();
  return render(
    <Providers>
      <Shell />
    </Providers>,
  );
}

describe('Timer alarm on the panel', () => {
  beforeEach(() => {
    resetNav();
    commands.store.setState({wishes: {}});
    finished = [
      {id: 'done-1', name: 'Pasta', alert_state: 'ringing', physical_stopped: false, physical_drained: false},
    ];
    acknowledged = [];
    refuse = false;
  });

  it('covers the panel when the bridge reports a finished timer, without the add-on', async () => {
    mount();
    const alarm = await screen.findByRole('alertdialog', {name: 'Timeren er færdig'});
    expect(alarm.id).toBe('timer-alert');
    expect(alarm.hasAttribute('open')).toBe(true);
    expect(alarm.querySelector('#timer-alert-kicker')?.textContent).toBe('Timer');
    expect(alarm.querySelector('.notice-copy strong')?.textContent).toBe('0:00');
    // Focus goes to Stop; the page under the alarm is never made inert.
    const stop = screen.getByRole('button', {name: 'Stop alarm'});
    await waitFor(() => {
      expect(document.activeElement).toBe(stop);
    });
    // The answer card's hidden parts are inert by the wall page's design (AnswerCard.tsx); nothing else is.
    expect([...document.querySelectorAll('[inert]')].filter(node => !node.closest('pv-answer'))).toEqual([]);
    // The alarm comes from the integration's timer bridge; no add-on service is involved in it.
    // Pushed over podvoice/timer_subscribe (read once with podvoice/timer_read), never polled as a service.
    expect(fake.ws.some(message => message.type === 'podvoice/timer_subscribe')).toBe(true);
  });

  it('one Stop sends one acknowledge_finished and the next read removes the alarm', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', {name: 'Stop alarm'}));
    expect(acknowledged).toHaveLength(1);
    expect(acknowledged[0]).toMatchObject({endpoint: 'kokken', epoch: EPOCH, action: 'acknowledge_finished',
      timer_id: 'done-1'});
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(acknowledged).toHaveLength(1);
  });

  it('a refused Stop is shown honestly and never resent', async () => {
    const user = userEvent.setup();
    refuse = true;
    mount();
    await user.click(await screen.findByRole('button', {name: 'Stop alarm'}));
    const alarm = screen.getByRole('alertdialog');
    expect(await within(alarm).findByText(/Home Assistant afviste handlingen/)).toBeTruthy();
    expect(acknowledged).toHaveLength(1);
  });

  it('»Luk visning« hides the view without claiming to stop the alarm', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', {name: 'Luk visning'}));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(acknowledged).toHaveLength(0);
  });

  it('a physically stopped alarm offers »Færdig« without the stop glyph', async () => {
    finished = [{id: 'done-2', name: '', physical_stopped: true}];
    mount();
    const done = await screen.findByRole('button', {name: 'Færdig'});
    expect(done.querySelector<HTMLElement>('[data-kit="icon"]')?.hidden).toBe(true);
  });

  it('shows nothing while no timer has finished', async () => {
    finished = [];
    mount();
    await waitFor(() => {
      // Pushed over podvoice/timer_subscribe (read once with podvoice/timer_read), never polled as a service.
    expect(fake.ws.some(message => message.type === 'podvoice/timer_subscribe')).toBe(true);
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('labels follow the bridge row', () => {
    const base = {id: 'a', status: 'done', remaining: 0, deadline: null, duration: null, ownerBootId: EPOCH};
    expect(alarmRinging(base)).toBe(true);
    expect(alarmRinging({...base, physicalDrained: true})).toBe(false);
    expect(alarmKicker(base)).toBe('Timer');
    expect(alarmKicker({...base, duration: 600})).toBe('Timer · 10 min');
  });
});
