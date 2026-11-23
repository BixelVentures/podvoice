import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Providers} from '../app/Providers';
import {commands} from '../lib/ha/commands';
import {createFakeHass, FAKE_PANEL} from '../lib/ha/ha-fixture';
import {transport} from '../lib/ha/transport';
import {currentScreen, resetNav, useNav} from './nav';
import {enterRest, IDLE_MS, restClock, useRest} from './Rest';
import {Shell} from './Shell';

function mount(finished: Record<string, unknown>[] = []) {
  const fake = createFakeHass({confirmMs: 20});
  fake.handle('podvoice.timer_status', () => ({
    response: {ok: true, epoch: 'e'.repeat(32), endpoint: 'kokken', timers: [], finished, recent: []},
  }));
  transport.setPanel(FAKE_PANEL);
  transport.setHass(fake.hass);
  transport.resync();
  return render(
    <Providers>
      <Shell />
    </Providers>,
  );
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const photo = () => document.getElementById('photo-view');

describe('Ro on the panel', () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']});
    vi.setSystemTime(new Date('2026-11-23T11:04:00Z'));
    resetNav();
    useRest.setState({active: false});
    commands.store.setState({wishes: {}});
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rests after three minutes without a touch: the photo, the clock and the date', async () => {
    mount();
    await flush();
    advance(IDLE_MS - 1000);
    expect(photo()).toBeNull();
    advance(1000);
    const view = photo();
    expect(view).not.toBeNull();
    expect(view?.getAttribute('aria-description')).toBe('Åbn dagens overblik');
    expect(screen.getByAltText('Bjerglandskab ved en sø').getAttribute('src')).toBe('ambient.webp');
    expect(document.getElementById('photo-clock')?.textContent).toBe('12:07');
    expect(document.getElementById('photo-date')?.textContent).toBe(restClock(new Date()).date);
    expect(restClock(new Date()).date).toMatch(/^mandag .*23\. november$/);
    expect(screen.getByText('Tryk for at åbne hjemmet')).toBeTruthy();
  });

  it('any touch starts the wait again', async () => {
    mount();
    await flush();
    advance(IDLE_MS - 1000);
    fireEvent.pointerDown(document.body);
    advance(2000);
    expect(photo()).toBeNull();
    advance(IDLE_MS);
    expect(photo()).not.toBeNull();
  });

  it('a tap wakes it to Hjem', async () => {
    mount();
    await flush();
    act(() => {
      useNav.getState().push('lights');
    });
    advance(IDLE_MS);
    fireEvent.click(screen.getByRole('button', {name: /Tryk for at åbne hjemmet/}));
    expect(useRest.getState().active).toBe(false);
    expect(currentScreen(useNav.getState())).toBe('home');
    vi.useRealTimers();
    await waitFor(() => {
      expect(photo()).toBeNull();
    });
  });

  it('does not rest while a timer has finished or while Svar is open', async () => {
    mount([{id: 'done', name: ''}]);
    await flush();
    await flush();
    advance(IDLE_MS * 2);
    expect(photo()).toBeNull();
  });

  it('does not rest while an answer is being read', async () => {
    mount();
    await flush();
    act(() => {
      useNav.getState().push('answers');
    });
    advance(IDLE_MS * 2);
    expect(photo()).toBeNull();
  });

  it('an unreachable photo leaves the wall page’s fallback colour, the clock stays', async () => {
    mount();
    await flush();
    act(() => {
      enterRest();
    });
    fireEvent.error(screen.getByAltText('Bjerglandskab ved en sø'));
    expect(screen.queryByAltText('Bjerglandskab ved en sø')).toBeNull();
    expect(document.getElementById('photo-clock')?.textContent).toBe('12:04');
  });

  it('dims at night (21–07 Copenhagen): only the clock', () => {
    expect(restClock(new Date('2026-11-23T20:30:00Z'))).toMatchObject({time: '21:30', night: true});
    expect(restClock(new Date('2026-11-23T05:59:00Z'))).toMatchObject({time: '06:59', night: true});
    expect(restClock(new Date('2026-11-23T06:00:00Z'))).toMatchObject({time: '07:00', night: false});
  });
});
