import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it} from 'vitest';
import {Providers} from '../../app/Providers';
import {commands} from '../../lib/ha/commands';
import {createFakeHass, FAKE_PANEL} from '../../lib/ha/ha-fixture';
import type {FakeHass} from '../../lib/ha/ha-fixture';
import {lastKnownPlayers, playerModel} from '../../lib/ha/media';
import {resetSpeakers, speakerPicker, START_KEY, useSpeakers} from '../../lib/ha/podconnect';
import {transport} from '../../lib/ha/transport';
import {resetNav, useNav} from '../nav';
import {Shell} from '../Shell';

let fake: FakeHass;

function mount() {
  fake = createFakeHass({confirmMs: 50, onChange: hass => {
    act(() => {
      transport.setHass(hass);
    });
  }});
  transport.setPanel(FAKE_PANEL);
  transport.setHass(fake.hass);
  transport.resync();
  return render(
    <Providers>
      <Shell />
    </Providers>,
  );
}

const musicView = () => document.querySelector<HTMLElement>('#music-view') as HTMLElement;
const called = (service: string) => fake.calls.filter(call => call.service === service);

async function openMusic(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', {name: /^Musik/}));
  return within(musicView());
}

describe('Musik on the HA panel', () => {
  beforeEach(() => {
    resetNav();
    resetSpeakers();
    commands.store.setState({wishes: {}});
    lastKnownPlayers.setState({models: {}});
  });

  it('shows the room’s queue under the full player and plays a row once; the speaker confirms it', async () => {
    const user = userEvent.setup();
    mount();
    const view = await openMusic(user);
    expect(await view.findByRole('button', {name: /Afspil 2 · Skinny Love · Bon Iver/})).toBeTruthy();
    expect(view.getByText('5 numre · Køkkenalrum')).toBeTruthy();
    expect(view.getByRole('button', {name: /Spiller nu: Holocene · Bon Iver · Sæt på pause/})).toBeTruthy();
    await user.click(view.getByRole('button', {name: /Afspil 2 · Skinny Love/}));
    expect(called('music_queue_play').map(call => call.data)).toEqual([{entity_id: 'media_player.kokkenalrum',
      option_id: `${'a'.repeat(22)}02`, uri: `spotify:track:${'2'.padStart(22, '0')}`}]);
    await waitFor(() => {
      expect(view.getByRole('button', {name: /Spiller nu: Skinny Love/})).toBeTruthy();
    });
    // A new track is a new read of what comes next.
    await waitFor(() => {
      expect(view.getByRole('button', {name: /Afspil \d · Holocene/})).toBeTruthy();
    });
    expect(called('music_queue_play')).toHaveLength(1);
  });

  it('Afspil på: a speaker tap moves the music there at once; HA’s rooms confirm it; nothing is inert', async () => {
    const user = userEvent.setup();
    mount();
    const view = await openMusic(user);
    await user.click(view.getByRole('button', {name: /Køkkenalrum · Aktuelt output · Vælg højttaler/}));
    const sheet = await screen.findByRole('dialog', {name: 'Afspil på'});
    expect(within(sheet).getByRole('button', {name: 'Køkkenalrum · Aktuelt output'})).toBeTruthy();
    await user.click(within(sheet).getByRole('button', {name: 'Stue'}));
    expect(within(sheet).getByRole('button', {name: 'Stue · Valgt'}).getAttribute('aria-pressed')).toBe('true');
    expect(called('music_move').map(call => call.data)).toEqual([{entity_id: 'media_player.kokkenalrum',
      target_entity_id: 'media_player.stue'}]);
    await waitFor(() => {
      expect(fake.hass.states['media_player.stue']?.attributes.media_title).toBe('Holocene');
    });
    await waitFor(() => {
      expect(commands.store.getState().wishes['music:move']).toBeUndefined();
    });
    expect(document.querySelector('[inert]')).toBeNull();
    expect(document.querySelector('dialog[open]')).toBeNull();
    await user.click(within(sheet).getByRole('button', {name: 'Luk'}));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', {name: 'Afspil på'})).toBeNull();
    });
  });

  it('while nothing plays a speaker tap is the next start’s destination, and Find musik starts there', async () => {
    const user = userEvent.setup();
    mount();
    act(() => {
      fake.patch('media_player.kokkenalrum', 'idle', {media_title: undefined, media_artist: undefined});
      fake.patch('media_player.stue', 'idle', {});
    });
    const view = await openMusic(user);
    await user.click(view.getByRole('button', {name: /Køkkenalrum · Vælg højttaler/}));
    const sheet = await screen.findByRole('dialog', {name: 'Afspil på'});
    await user.click(within(sheet).getByRole('button', {name: 'Stue'}));
    expect(called('music_move')).toHaveLength(0);
    expect(useSpeakers.getState().nextDestination).toBe('media_player.stue');
    await user.click(within(sheet).getByRole('button', {name: 'Luk'}));
    expect(await view.findByRole('button', {name: /Køkkenalrum · Næste afspilning: Stue/})).toBeTruthy();
    await user.click(view.getByRole('button', {name: 'Vælg musik'}));
    const find = within(document.querySelector<HTMLElement>('#find-view') as HTMLElement);
    expect(find.getByText('Næste afspilning: Stue')).toBeTruthy();
    const [flume] = await find.findAllByRole('button', {name: 'Afspil Flume · Bon Iver'});
    if (flume) await user.click(flume);
    expect(called('play_media').map(call => [call.entityId, call.data.media_content_id])).toEqual([
      ['media_player.stue', `spotify:track:${'3'.padStart(22, '0')}`]]);
    await waitFor(() => {
      expect(fake.hass.states['media_player.stue']?.attributes.media_title).toBe('Flume');
    });
  });

  it('Find musik reads each shelf once and keeps it (Spotify’s limits)', async () => {
    const user = userEvent.setup();
    mount();
    act(() => {
      useNav.getState().push('find');
    });
    const find = within(document.querySelector<HTMLElement>('#find-view') as HTMLElement);
    expect(await find.findByRole('group', {name: 'For dig'})).toBeTruthy();
    expect(find.getByRole('group', {name: 'Senest'})).toBeTruthy();
    await waitFor(() => {
      expect(find.getAllByRole('button', {name: /Afspil Holocene/})).toHaveLength(2);
    });
    await user.click(screen.getByRole('button', {name: 'Tilbage'}));
    act(() => {
      useNav.getState().push('find');
    });
    expect(called('top_tracks')).toHaveLength(1);
    expect(called('recently_played')).toHaveLength(1);
    expect(find.getByText(/AI-valgte forslag/)).toBeTruthy();
  });

  it('another Spotify login in the room is shown, never controlled', async () => {
    const user = userEvent.setup();
    mount();
    act(() => {
      fake.patch('media_player.kokkenalrum', null, {podconnect_account: 'other'});
    });
    // (Musik is mounted from the start and read the room's queue before the other login arrived.)
    fake.calls.length = 0;
    const view = await openMusic(user);
    expect(view.getByRole('article', {name: 'Køkkenalrum: En anden Spotify-konto spiller her'})).toBeTruthy();
    const player = view.getByRole('article', {name: /Køkkenalrum: En anden/});
    expect((within(player).getByRole('button', {name: 'Pause'}) as HTMLButtonElement).disabled).toBe(true);
    expect((view.getByRole('button', {name: /^Køkkenalrum$/}) as HTMLButtonElement).disabled).toBe(true);
    expect(view.getAllByText('En anden Spotify-konto spiller her').length).toBeGreaterThan(0);
    expect(called('music_queue')).toHaveLength(0);
  });

  it('a choice during the warm-up waits for the room’s own state, then moves the music once', async () => {
    const user = userEvent.setup();
    mount();
    const kitchen = fake.hass.states['media_player.kokkenalrum'];
    if (kitchen) lastKnownPlayers.setState({models: {'media_player.kokkenalrum': playerModel(kitchen)}});
    act(() => {
      fake.patch('media_player.kokkenalrum', 'unavailable', {});
    });
    const view = await openMusic(user);
    await user.click(view.getByRole('button', {name: 'Køkkenalrum · Vælg højttaler'}));
    const sheet = await screen.findByRole('dialog', {name: 'Afspil på'});
    await user.click(within(sheet).getByRole('button', {name: 'Stue'}));
    expect(called('music_move')).toHaveLength(0);
    expect(within(sheet).getByText('Afventer bekræftelse af afspilningen.')).toBeTruthy();
    act(() => {
      fake.patch('media_player.kokkenalrum', 'playing', {});
    });
    await waitFor(() => {
      expect(called('music_move')).toHaveLength(1);
    });
    act(() => {
      fake.patch('media_player.kokkenalrum', 'playing', {volume_level: 0.31});
    });
    expect(called('music_move')).toHaveLength(1);
  });

  it('Radio: a station starts on the room’s speaker, the speaker confirms it, and Stop stops it', async () => {
    const user = userEvent.setup();
    mount();
    act(() => {
      useNav.getState().push('radio');
    });
    const radio = within(document.querySelector<HTMLElement>('#radio-view') as HTMLElement);
    await user.click(await radio.findByRole('button', {name: 'P3 · Afspil på Køkkenalrum'}));
    expect(called('radio_command').map(call => call.data)).toEqual([{action: 'start', station_id: 'p3',
      target_id: 'kitchen'}]);
    await waitFor(() => {
      expect(fake.hass.states['media_player.kokkenalrum']?.attributes.podconnect_source).toBe('radio');
    });
    expect(await radio.findByRole('article', {name: 'Radio: P3 · Direkte'})).toBeTruthy();
    await user.click(radio.getByRole('button', {name: /Stop/}));
    await waitFor(() => {
      expect(fake.hass.states['media_player.kokkenalrum']?.state).toBe('idle');
    });
    expect(called('radio_command').map(call => call.data.action)).toEqual(['start', 'stop']);
  });

  it('Radio that cannot be reached is said so', async () => {
    mount();
    fake.handle('podvoice.radio_state', () => ({response: {ok: true, available: false, reason: 'unreachable'}}));
    act(() => {
      useNav.getState().push('radio');
    });
    expect(await screen.findByText('PodConnect Speakers svarer ikke.')).toBeTruthy();
  });
});

describe('the speaker picker’s lifecycle', () => {
  beforeEach(() => {
    resetSpeakers();
    commands.store.setState({wishes: {}});
  });

  it('a tap during a start is queued and made once when the start settled; dropped after 30 s', () => {
    const moves: string[][] = [];
    const picker = speakerPicker(commands, {
      move: (from: string, to: string) => moves.push([from, to]),
    } as never);
    const playing = {entity_id: 'media_player.a', state: 'playing', attributes: {}, last_changed: '', last_updated: ''};
    const context = {from: 'media_player.a', entity: playing, lastKnownActive: false, starting: true, now: 1000};
    expect(picker.choose('media_player.b', context)).toBe('queued');
    expect(picker.runQueued(context)).toBeNull();
    expect(picker.runQueued({...context, starting: false, now: 2000})).toBe('move');
    expect(picker.runQueued({...context, starting: false, now: 3000})).toBeNull();
    expect(moves).toEqual([['media_player.a', 'media_player.b']]);
    picker.choose('media_player.b', context);
    expect(picker.runQueued({...context, starting: false, now: 40_000})).toBeNull();
    expect(moves).toHaveLength(1);
    expect(START_KEY).toBe('music:start');
  });
});
