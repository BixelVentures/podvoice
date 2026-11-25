import {act, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Providers} from '../../app/Providers';
import {commands} from '../../lib/ha/commands';
import {createFakeHass, FAKE_PANEL} from '../../lib/ha/ha-fixture';
import type {FakeHass} from '../../lib/ha/ha-fixture';
import {bridgeTimers, nextTimerTick} from '../../lib/ha/timers';
import {transport} from '../../lib/ha/transport';
import {resetNav} from '../nav';
import {Shell} from '../Shell';

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
