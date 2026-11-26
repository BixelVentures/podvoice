import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Providers} from '../app/Providers';
import {commands} from '../lib/ha/commands';
import {photoAlbum} from '../lib/ha/fixtures/photos';
import {createFakeHass, FAKE_PANEL} from '../lib/ha/ha-fixture';
import {PHOTOS_REFRESH_MS} from '../lib/ha/photos';
import {transport} from '../lib/ha/transport';
import {currentScreen, resetNav, useNav} from './nav';
import {enterRest, IDLE_MS, restClock, useRest} from './Rest';
import {Shell} from './Shell';

function mount(finished: Record<string, unknown>[] = [], timers: Record<string, unknown>[] = []) {
  const fake = createFakeHass({confirmMs: 20});
  lastFake = fake;
  fake.handle('podvoice.timer_status', () => ({
    response: {ok: true, epoch: 'e'.repeat(32), endpoint: 'kokken', timers, finished, recent: []},
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
const settle = async () => {
  for (let step = 0; step < 10; step++) await flush();
};
const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const photo = () => document.getElementById('photo-view');
let lastFake: ReturnType<typeof createFakeHass> | null = null;

describe('Ro on the panel', () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']});
    vi.setSystemTime(new Date('2026-11-23T11:04:00Z'));
    resetNav();
    useRest.setState({active: false});
    commands.store.setState({wishes: {}});
    photoAlbum.reset();
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
    const description = view?.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(description)?.textContent).toBe('Åbn dagens overblik');
    expect(screen.getByAltText('Bjerglandskab ved en sø').getAttribute('src')).toBe('ambient.webp');
    expect(document.getElementById('photo-clock')?.textContent).toBe('12.07');
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
    // The bridge's snapshot arrives over the websocket a moment later.
    advance(10);
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
    expect(document.getElementById('photo-clock')?.textContent).toBe('12.04');
  });

  it('Ro’s music button: the room’s track with one play/pause key; a tap on the card wakes to Musik', async () => {
    mount();
    await flush();
    act(() => {
      enterRest();
    });
    const open = screen.getByRole('button', {name: /^Åbn Musik · /});
    const player = open.closest<HTMLElement>('[data-rest-player]');
    if (!player) throw new Error('Ro has no music button');
    const card = within(player);
    expect(player.getAttribute('data-player-state')).toBe('playing');
    fireEvent.click(card.getByRole('button', {name: 'Pause'}));
    // The wish shows at once; HA's state confirms it; Ro stays.
    expect(card.getByRole('button', {name: 'Afspil'})).toBeTruthy();
    expect(lastFake?.calls.map(call => `${call.domain}.${call.service}`)).toContain('media_player.media_pause');
    expect(photo()).not.toBeNull();
    fireEvent.click(open);
    await flush();
    expect(useRest.getState().active).toBe(false);
    expect(currentScreen(useNav.getState())).toBe('music');
  });

  it('Ro’s music button is hidden at night, as on the wall page', async () => {
    vi.setSystemTime(new Date('2026-11-23T21:30:00Z'));
    mount();
    await flush();
    act(() => {
      enterRest();
    });
    expect(screen.queryByRole('button', {name: /^Åbn Musik/})).toBeNull();
  });

  it('at night (21–07) Ro is the night screen: no photo, no cards; a tap wakes Foto-Ro, not Hjem', async () => {
    vi.setSystemTime(new Date('2026-11-23T21:30:00Z'));
    mount();
    await flush();
    act(() => {
      enterRest();
    });
    const night = document.querySelector('[data-rest=night]');
    expect(night).not.toBeNull();
    expect(screen.queryByAltText('Bjerglandskab ved en sø')).toBeNull();
    expect(document.getElementById('photo-clock')?.textContent).toBe('22.30');
    expect(document.querySelector('[data-rest-player]')).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: 'Vis Foto-Ro'}));
    expect(useRest.getState().active).toBe(true);
    expect(document.querySelector('[data-rest=day]')).not.toBeNull();
    expect(document.querySelector('[data-rest-player]')).not.toBeNull();
    // Three quiet minutes later it is night again.
    advance(IDLE_MS);
    expect(document.querySelector('[data-rest=night]')).not.toBeNull();
  });

  it('Foto-Ro: the 168-px clock »12.04«, the date and the weather at the top right', async () => {
    mount();
    await flush();
    act(() => {
      enterRest();
    });
    await flush();
    expect(document.getElementById('photo-clock')?.className).toContain('text-[168px]');
    const weather = document.querySelector('[data-rest-weather]');
    expect(weather?.textContent).toBe('7°Let skyet');
  });

  it('a running timer is the activity card on the left, with the arrow (no key), and opens Timer', async () => {
    mount([], [{id: 'pasta', name: 'Pasta', seconds_left: 222, state: 'active', duration_seconds: 300}]);
    advance(10);
    await flush();
    await flush();
    act(() => {
      enterRest();
    });
    await flush();
    const card = document.querySelector<HTMLElement>('[data-rest-activity=timer]');
    if (!card) throw new Error('no activity card');
    expect(card.textContent).toContain('tæller ned');
    // Only music and radio have a key; the activity card is one press that opens its page.
    expect(within(card).getAllByRole('button')).toHaveLength(1);
    fireEvent.click(within(card).getByRole('button'));
    expect(useRest.getState().active).toBe(false);
    expect(currentScreen(useNav.getState())).toBe('timers');
  });

  it('a finished timer on Ro says »Tiden er gået« once (G7 #16)', async () => {
    mount([{id: 'done', name: 'Pasta'}]);
    advance(10);
    await flush();
    await flush();
    act(() => {
      enterRest();
    });
    await flush();
    const card = document.querySelector<HTMLElement>('[data-rest-activity=timer]');
    if (!card) throw new Error('no activity card');
    // The primary line says it; the context is the timer's name only (it doubled before).
    expect(card.textContent.match(/tiden er gået/gi)).toHaveLength(1);
  });

  it('»Vælg musik« on Ro opens Find musik (G7: every »Vælg musik« does)', async () => {
    mount();
    await flush();
    act(() => {
      lastFake?.patch('media_player.kokkenalrum', 'idle', {media_title: undefined, media_artist: undefined,
        media_content_id: undefined});
      if (lastFake) transport.setHass(lastFake.hass);
      enterRest();
    });
    await flush();
    fireEvent.click(screen.getByRole('button', {name: 'Åbn Find musik · Vælg musik'}));
    await flush();
    expect(currentScreen(useNav.getState())).toBe('find');
  });

  it('dims at night (21–07 Copenhagen): only the clock', () => {
    expect(restClock(new Date('2026-11-23T20:30:00Z'))).toMatchObject({time: '21.30', night: true});
    expect(restClock(new Date('2026-11-23T05:59:00Z'))).toMatchObject({time: '06.59', night: true});
    expect(restClock(new Date('2026-11-23T06:00:00Z'))).toMatchObject({time: '07.00', night: false});
  });
  it('the shared album: the newest photo first, read when Ro opens and every 15 minutes; a new photo comes next',
    async () => {
      // The 15-minute read is an interval.
      vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
      vi.setSystemTime(new Date('2026-11-23T11:04:00Z'));
      mount();
      await flush();
      act(() => {
        enterRest();
      });
      await flush();
      const shown = () => document.querySelector('[data-photo]')?.getAttribute('data-photo');
      await settle();
      expect(shown()).toBe('A-4');
      expect(screen.getAllByAltText('Billede fra HA podview').length).toBeGreaterThan(0);
      const reads = () => lastFake?.calls.filter(call => call.service === 'photos').length ?? 0;
      const opened = reads();
      expect(opened).toBeGreaterThan(0);
      photoAlbum.add('A-new');
      advance(PHOTOS_REFRESH_MS);
      await settle();
      expect(reads()).toBe(opened + 1);
      // The photo on screen stays (the carousel has run on for 15 minutes); the new one is next.
      expect(shown()).not.toBe('A-new');
      advance(20_000);
      expect(shown()).toBe('A-new');
      // Offline: a read that fails keeps the album, with no error on Ro.
      if (lastFake) lastFake.mode = 'refuse';
      advance(PHOTOS_REFRESH_MS);
      await settle();
      expect(shown()).toBeTruthy();
      expect(document.querySelector('[data-rest=day]')?.textContent).not.toMatch(/fejl|kunne ikke/i);
    });

  it('without an album link Ro keeps the panel\'s own photo', async () => {
    photoAlbum.configured = false;
    mount();
    await flush();
    act(() => {
      enterRest();
    });
    await flush();
    await settle();
    expect(lastFake?.calls.some(call => call.service === 'photos')).toBe(true);
    expect(screen.getByAltText('Bjerglandskab ved en sø')).toBeTruthy();
  });
});
