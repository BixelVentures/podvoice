import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it} from 'vitest';
import {Providers} from '../../app/Providers';
import {commands} from '../../lib/ha/commands';
import {FAKE_PLAYLISTS, fakeFindMusic, fakeSpeakerRooms} from '../../lib/ha/fixtures/music';
import {discoveryPeriodLabel} from '../../lib/format/discovery';
import {queryClient} from '../../lib/query/client';
import {createFakeHass, entity, FAKE_PANEL} from '../../lib/ha/ha-fixture';
import type {FakeHass} from '../../lib/ha/ha-fixture';
import {lastKnownPlayers, playerModel} from '../../lib/ha/media';
import {ownMusic, ownMusicOf, resetSpeakers, speakerPicker, START_KEY, useSpeakers} from '../../lib/ha/podconnect';
import {transport} from '../../lib/ha/transport';
import {resetNav, useNav} from '../nav';
import {Shell} from '../Shell';
import {AFSPIL_DONE_MS} from './music-speakers';
import {heldPosition} from './Music';

let fake: FakeHass;

function mount() {
  // Only this test's fake feeds the transport: an earlier test's fake still has delayed effects in flight, and its
  // late `hass` must not replace this one (the calls would land on the old fake).
  let own: FakeHass | null = null;
  own = createFakeHass({confirmMs: 50, onChange: hass => {
    // While it is built (own still null) the fake publishes its own entities; mount() hands over the final hass.
    if (!own || fake !== own) return;
    act(() => {
      transport.setHass(hass);
    });
  }});
  fake = own;
  transport.setPanel(FAKE_PANEL);
  transport.setHass(fake.hass);
  transport.resync();
  return render(
    <Providers>
      <Shell />
    </Providers>,
  );
}

const mounted = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`${selector} is not mounted`);
  return element;
};
const musicView = () => mounted('#music-view');
const called = (service: string) => fake.calls.filter(call => call.service === service);

// »Afspil på« is the room sheet's second part (the room key on the player, docs/PODVIEW-PARITY.md decision 1).
async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', {name: /^Rum: .* · Vælg rum$/}));
  const sheet = await screen.findByRole('dialog', {name: 'Vælg rum'});
  return {sheet, speakers: within(within(sheet).getByRole('group', {name: 'Højttalere'}))};
}

async function openMusic(user: ReturnType<typeof userEvent.setup>) {
  // The player's cover opens Musik; with nothing playing, so does Hjem's »Vælg musik«.
  await user.click(screen.queryByRole('button', {name: /^Vis kø/}) ?? screen.getByRole('button', {name: /^Musik/}));
  return within(musicView());
}

describe('Musik on the HA panel', () => {
  beforeEach(() => {
    resetNav();
    resetSpeakers();
    commands.store.setState({wishes: {}});
    lastKnownPlayers.setState({models: {}});
    fakeSpeakerRooms.speakers = [];
  });

  it('puts speakers HA has no area for in the room PodConnect’s room rules give them', async () => {
    const user = userEvent.setup();
    fakeSpeakerRooms.speakers = [
      {entity_id: 'media_player.svends_homepod_2', area_id: 'svend', area_name: 'Svends værelse'},
      {entity_id: 'media_player.kokkenalrum_homepod', area_id: 'kokken', area_name: 'Køkkenalrum'},
    ];
    mount();
    act(() => {
      fake.addEntities(
        [
          entity('media_player.svends_homepod_2', 'paused', {friendly_name: 'Svend’s HomePod', volume_level: 0.1,
            supported_features: 1 | 4 | 16384}, Date.now()),
          entity('media_player.kokkenalrum_homepod', 'idle', {friendly_name: 'Køkkenalrum HomePod',
            supported_features: 1 | 4 | 16384}, Date.now()),
        ],
        {
          'media_player.svends_homepod_2': {entity_id: 'media_player.svends_homepod_2', platform: 'podconnect'},
          'media_player.kokkenalrum_homepod': {entity_id: 'media_player.kokkenalrum_homepod', platform: 'podconnect'},
        },
      );
    });
    // A room PodConnect gives the speaker appears even though HA's area has no lights or players.
    await user.click(screen.getByRole('button', {name: /^Rum: .* · Vælg rum$/}));
    await user.click(await screen.findByRole('radio', {name: 'Svends værelse'}));
    expect(screen.getByRole('heading', {level: 1, name: 'Svends værelse'})).toBeTruthy();
    expect(screen.getByRole('article', {name: 'Svend’s HomePod: På pause'})).toBeTruthy();
    expect(called('speaker_rooms').length).toBeGreaterThan(0);
    // Neither speaker is left »Uden område«.
    act(() => {
      useNav.getState().push('music');
    });
    expect(within(musicView()).queryByRole('region', {name: 'Uden område'})).toBeNull();
  });

  it('shows the room’s queue beside the player and plays a row once; the list moves only after the speaker confirms',
    async () => {
    const user = userEvent.setup();
    mount();
    const view = await openMusic(user);
    expect(await view.findByRole('button', {name: /Afspil 3 · Skinny Love · Bon Iver/})).toBeTruthy();
    expect(view.getByText('5 numre · Køkkenalrum')).toBeTruthy();
    // Row 1 is the current song: bold dark ink and the three bars (no coral), not a separate card.
    const current = view.getByRole('button', {name: /Spiller nu: Holocene · Bon Iver · Sæt på pause/});
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(current.querySelector('[data-bars]')).toBeTruthy();
    expect(musicView().innerHTML).not.toMatch(/timer-accent|#B4532A|#FF7A5C/i);
    // No drag sorting: no handle, nothing draggable.
    expect(musicView().querySelector('[draggable="true"], [data-handle]')).toBeNull();
    // The speaker does not confirm yet: the tapped row says »Starter…«, and nothing moves under the finger.
    fake.mode = 'silent';
    await user.click(view.getByRole('button', {name: /Afspil 3 · Skinny Love/}));
    expect(view.getByRole('button', {name: /^Starter: 3 · Skinny Love/}).textContent).toContain('Starter…');
    expect(view.getByRole('button', {name: /^Afspil 2 · Re: Stacks/})).toBeTruthy();
    // Row 1 keeps its mark until the speaker confirms (G7 #4: no »1« blinking in while the tapped row starts).
    expect(view.getByRole('button', {name: /Spiller nu: Holocene/}).querySelector('[data-bars]')).toBeTruthy();
    fake.mode = 'confirm';
    act(() => {
      fake.patch('media_player.kokkenalrum', 'playing', {media_title: 'Skinny Love',
        media_content_id: `spotify:track:${'2'.padStart(22, '0')}`});
    });
    // Confirmed: the chosen song is row 1 and the rows above it have left the queue.
    await waitFor(() => {
      expect(view.getByRole('button', {name: /Spiller nu: Skinny Love/})).toBeTruthy();
    });
    await waitFor(() => {
      expect(view.queryByRole('button', {name: /Re: Stacks/})).toBeNull();
    });
    // The rows that stay keep their numbers while the rows above leave, then take their new place's number.
    expect(await view.findByRole('button', {name: /^Afspil 2 · Flume/})).toBeTruthy();
    expect(called('music_queue_play')).toHaveLength(1);
  });

  it('a queue row plays once and the speaker confirms it', async () => {
    const user = userEvent.setup();
    mount();
    const view = await openMusic(user);
    await user.click(await view.findByRole('button', {name: /Afspil 3 · Skinny Love/}));
    expect(called('music_queue_play').map(call => call.data)).toEqual([{entity_id: 'media_player.kokkenalrum',
      option_id: `${'a'.repeat(22)}02`, uri: `spotify:track:${'2'.padStart(22, '0')}`}]);
    await waitFor(() => {
      expect(view.getByRole('button', {name: /Spiller nu: Skinny Love/})).toBeTruthy();
    });
    // A new track is a new read of what comes next (PodConnect's: the rows after the chosen one).
    await waitFor(() => {
      expect(view.getByRole('button', {name: /^Afspil 2 · Flume/})).toBeTruthy();
    });
    expect(called('music_queue_play')).toHaveLength(1);
  });

  it('H6: the player opens with its queue already read, never placeholders; a new track is read before it opens',
    async () => {
      const user = userEvent.setup();
      mount();
      // On Hjem the page reads the room's queue by itself (no screen asks for it yet).
      await waitFor(() => {
        expect(called('music_queue')).toHaveLength(1);
      });
      // A new track is pushed while the player is closed: its queue is read before the player opens.
      act(() => {
        fake.patch('media_player.kokkenalrum', 'playing', {media_title: 'Skinny Love',
          media_content_id: `spotify:track:${'2'.padStart(22, '0')}`});
      });
      await waitFor(() => {
        expect(called('music_queue')).toHaveLength(2);
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      const view = await openMusic(user);
      // The first frame of the player: rows, no placeholder, not loading.
      expect(musicView().querySelector('#queue [data-placeholder="true"]')).toBeNull();
      expect(musicView().querySelector('#queue')?.getAttribute('data-status')).toBe('ready');
      expect(view.getAllByRole('button', {name: /^Afspil \d/}).length).toBeGreaterThan(0);
      expect(called('music_queue')).toHaveLength(2);
    });

  it('Afspil på: a speaker tap moves the music there at once; HA’s rooms confirm it; nothing is inert after',
    async () => {
    const user = userEvent.setup();
    mount();
    await openMusic(user);
    const {sheet, speakers} = await openSheet(user);
    // The two parts have their own headings (G7 #9): the screen's rooms, and the speakers the music plays on.
    expect(within(sheet).getByRole('heading', {name: 'Rum på denne skærm'})).toBeTruthy();
    expect(within(sheet).getByRole('heading', {name: 'Afspil på'})).toBeTruthy();
    expect(speakers.getByRole('button', {name: 'Køkkenalrum · Spiller nu'})).toBeTruthy();
    expect(within(sheet).queryByText('Aktuelt output')).toBeNull();
    // The rooms say what plays in each (the panel's old »Højttalere i hjemmet«).
    expect(within(sheet).getByRole('radio', {name: 'Køkkenalrum'}).textContent).toContain('Spiller · Holocene');
    await user.click(speakers.getByRole('button', {name: 'Stue'}));
    // The row answers on itself: »Flytter…« with its dots until Stue plays it, then ✓, then the sheet closes.
    const moving = speakers.getByRole('button', {name: 'Stue · Flytter…'});
    expect(moving.getAttribute('aria-pressed')).toBe('true');
    expect(moving.querySelector('[data-row-pending]')).toBeTruthy();
    expect(called('music_move').map(call => call.data)).toEqual([{entity_id: 'media_player.kokkenalrum',
      target_entity_id: 'media_player.stue'}]);
    await waitFor(() => {
      expect(fake.hass.states['media_player.stue']?.attributes.media_title).toBe('Holocene');
    });
    await waitFor(() => {
      expect(commands.store.getState().wishes['music:move']).toBeUndefined();
    });
    expect((await speakers.findByRole('button', {name: 'Stue · Flyttet'})).querySelector('[data-row-done]'))
      .toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('dialog', {name: 'Vælg rum'})).toBeNull();
    }, {timeout: AFSPIL_DONE_MS + 1500});
    // Nothing is inert but the stack's screens that are not shown (G7 #19).
    expect([...document.querySelectorAll('[inert]:not([data-screen]:not([data-place=center]))')]).toEqual([]);
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('while nothing plays a speaker tap is the next start’s destination, and Find musik starts there', async () => {
    const user = userEvent.setup();
    mount();
    act(() => {
      fake.patch('media_player.kokkenalrum', 'idle', {media_title: undefined, media_artist: undefined});
      fake.patch('media_player.stue', 'idle', {});
    });
    const {sheet, speakers} = await openSheet(user);
    await user.click(speakers.getByRole('button', {name: 'Stue'}));
    expect(called('music_move')).toHaveLength(0);
    expect(useSpeakers.getState().nextDestination).toBe('media_player.stue');
    expect(speakers.getByRole('button', {name: 'Stue · Valgt'})).toBeTruthy();
    await user.click(within(sheet).getByRole('button', {name: 'Luk'}));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', {name: 'Vælg rum'})).toBeNull();
    });
    await user.click(within(screen.getByRole('complementary', {name: 'Rummets musik'}))
      .getByRole('button', {name: 'Find musik'}));
    const find = within(mounted('#find-view'));
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
    const find = within(mounted('#find-view'));
    expect(await find.findByRole('group', {name: 'For dig'})).toBeTruthy();
    expect(find.getByRole('group', {name: 'Fortsæt med at lytte'})).toBeTruthy();
    // Each library shelf shows its own tracks (the quick picks at the top reuse them; no extra read).
    await waitFor(() => {
      expect(within(find.getByRole('group', {name: 'For dig'})).getAllByRole('button', {name: /Afspil Holocene/}))
        .toHaveLength(1);
      expect(within(find.getByRole('group', {name: 'Fortsæt med at lytte'}))
        .getAllByRole('button', {name: /Afspil Holocene/})).toHaveLength(1);
    });
    await user.click(screen.getByRole('button', {name: 'Tilbage'}));
    act(() => {
      useNav.getState().push('find');
    });
    const shelves = called('music_shelf').map(call => call.data.shelf);
    expect(shelves.filter(shelf => shelf === 'top_tracks')).toHaveLength(1);
    expect(shelves.filter(shelf => shelf === 'recently_played')).toHaveLength(1);
    expect(fake.calls.some(call => call.domain === 'podconnect')).toBe(false);
    // »AI-valgt« is read once too (find-music.test.tsx covers its shelves).
    expect(called('music_picks')).toHaveLength(1);
  });

  it('another Spotify login in the room is shown, never controlled', () => {
    mount();
    act(() => {
      fake.patch('media_player.kokkenalrum', null, {podconnect_account: 'other'});
    });
    // (Musik is mounted from the start and read the room's queue before the other login arrived.)
    fake.calls.length = 0;
    act(() => {
      useNav.getState().push('music');
    });
    const view = within(musicView());
    const player = screen.getByRole('article', {name: 'Køkkenalrum: En anden Spotify-konto spiller her'});
    // Shown, never controlled: no transport; the room key stays active (G7 #10: the room can always be changed).
    expect(within(player).queryByRole('button', {name: /^(Pause|Afspil)$/})).toBeNull();
    expect(within(player).getByRole<HTMLButtonElement>('button', {name: /^Rum: Køkkenalrum/}).disabled).toBe(false);
    expect(within(player).getByText('Bruges af en anden')).toBeTruthy();
    expect(view.getAllByText('En anden Spotify-konto spiller her').length).toBeGreaterThan(0);
    expect(called('music_queue')).toHaveLength(0);
  });

  it('the speaker key mutes: the level goes to 0 and comes back to the level it had (no VOLUME_MUTE)', async () => {
    const user = userEvent.setup();
    mount();
    const aside = within(screen.getByRole('complementary', {name: 'Rummets musik'}));
    await user.click(aside.getByRole('button', {name: 'Slå lyd fra'}));
    expect(called('volume_set').map(call => call.data.volume_level)).toEqual([0]);
    await waitFor(() => {
      expect(aside.getByRole('button', {name: 'Slå lyd til'}).getAttribute('aria-pressed')).toBe('true');
    });
    await user.click(aside.getByRole('button', {name: 'Slå lyd til'}));
    expect(called('volume_set').map(call => call.data.volume_level)).toEqual([0, 0.3]);
    await waitFor(() => {
      expect(aside.getByRole('button', {name: 'Slå lyd fra'}).getAttribute('aria-pressed')).toBe('false');
    });
  });

  it('the speaker key is media_player.volume_mute where HA can mute the speaker', async () => {
    const user = userEvent.setup();
    mount();
    act(() => {
      fake.patch('media_player.kokkenalrum', null, {supported_features: 1 | 4 | 8 | 16 | 32 | 16384,
        is_volume_muted: false});
    });
    const aside = within(screen.getByRole('complementary', {name: 'Rummets musik'}));
    await user.click(aside.getByRole('button', {name: 'Slå lyd fra'}));
    expect(called('volume_mute').map(call => call.data)).toEqual([{is_volume_muted: true}]);
    expect(called('volume_set')).toHaveLength(0);
    await waitFor(() => {
      expect(fake.hass.states['media_player.kokkenalrum']?.attributes.is_volume_muted).toBe(true);
    });
    expect(aside.getByRole('button', {name: 'Slå lyd til'})).toBeTruthy();
  });

  it('your music in another room: a status line naming it, its controls, »Flyt til <rum>« and the room key',
    async () => {
    const user = userEvent.setup();
    mount();
    act(() => {
      fake.patch('media_player.stue', 'playing', {media_title: 'Holocene', media_artist: 'Bon Iver',
        media_content_id: 'spotify:track:0', podconnect_source: 'spotify'});
      fake.patch('media_player.kokkenalrum', 'idle', {media_title: undefined, media_artist: undefined,
        media_content_id: undefined});
    });
    const player = within(await screen.findByRole('article', {name: 'Stue: Spiller'}));
    // The top names where it plays (comment f6d4cd2d) and stays an active room key (G7 #10).
    expect(player.getByRole<HTMLButtonElement>('button', {name: 'Spiller i Stue · Vælg rum'}).disabled).toBe(false);
    await user.click(player.getByRole('button', {name: 'Pause'}));
    expect(called('media_pause').map(call => call.entityId)).toEqual(['media_player.stue']);
    await user.click(player.getByRole('button', {name: 'Flyt til Køkkenalrum'}));
    expect(called('music_move').map(call => call.data)).toEqual([{entity_id: 'media_player.stue',
      target_entity_id: 'media_player.kokkenalrum'}]);
  });

  it('another login here while your music plays elsewhere: »Flyt … hertil« is one explicit tap', async () => {
    const user = userEvent.setup();
    mount();
    act(() => {
      fake.patch('media_player.stue', 'playing', {media_title: 'Flume', media_artist: 'Bon Iver',
        media_content_id: 'spotify:track:3', podconnect_source: 'spotify'});
      fake.patch('media_player.kokkenalrum', 'playing', {media_title: 'AirPlay', media_artist: 'Emmas iPhone',
        podconnect_account: 'other'});
    });
    const player = within(screen.getByRole('article', {name: 'Køkkenalrum: En anden Spotify-konto spiller her'}));
    expect(player.getByText('Din musik · spiller i Stue')).toBeTruthy();
    await user.click(player.getByRole('button', {name: 'Flyt Flume hertil'}));
    expect(called('music_move').map(call => call.data)).toEqual([{entity_id: 'media_player.stue',
      target_entity_id: 'media_player.kokkenalrum'}]);
  });

  it('A5: the timeline seeks once on release; HA’s position confirms it', async () => {
    const user = userEvent.setup();
    mount();
    act(() => {
      fake.patch('media_player.kokkenalrum', 'paused', {supported_features: 1 | 2 | 4 | 16 | 32 | 16384,
        media_duration: 200, media_position: 50, media_position_updated_at: new Date().toISOString()});
    });
    const aside = within(screen.getByRole('complementary', {name: 'Rummets musik'}));
    const timeline = await aside.findByRole('slider', {name: 'Tidslinje'});
    act(() => {
      timeline.focus();
    });
    await user.keyboard('{ArrowRight}');
    // An absolute position (a key press may report the same value as its change and its end; both say 51).
    expect([...new Set(called('media_seek').map(call => `${String(call.entityId)} ${String(call.data.seek_position)}`))])
      .toEqual(['media_player.kokkenalrum 51']);
  });

  // Player-Tom (A-Player »idle«): the empty player reads its own rows, with Find musik's queries (one cache).
  const showIdle = () => {
    act(() => {
      fake.patch('media_player.kokkenalrum', 'idle', {media_title: undefined, media_artist: undefined});
      fake.patch('media_player.stue', 'idle', {});
    });
    return within(screen.getByRole('complementary', {name: 'Rummets musik'}));
  };

  it('Player-Tom: the period’s first AI pick and »Hør igen« on their own, before Find musik is opened', async () => {
    queryClient.clear();
    fakeFindMusic.addon = 'up';
    const user = userEvent.setup();
    mount();
    const aside = showIdle();
    const period = discoveryPeriodLabel(Date.now());
    const pick = await aside.findByRole('group', {name: period});
    // One suggestion row: the first AI pick for now, a playlist (»Spotify-playliste«).
    const [suggestion, ...more] = within(pick).getAllByRole('button');
    expect(more).toHaveLength(0);
    expect(suggestion?.getAttribute('aria-label')).toBe('Afspil Rainy Jazz');
    expect(within(pick).getByText('Spotify-playliste')).toBeTruthy();
    const again = await aside.findByRole('group', {name: 'Hør igen'});
    expect(within(again).getAllByRole('button')).toHaveLength(2);
    expect(aside.getByRole('button', {name: 'Find musik'})).toBeTruthy();
    // One read each; opening Find musik reads nothing again (the same keys).
    expect(called('music_shelf')).toHaveLength(1);
    expect(called('music_picks')).toHaveLength(1);
    act(() => {
      useNav.getState().push('find');
    });
    await within(mounted('#find-view')).findByRole('group', {name: 'Fortsæt med at lytte'});
    expect(called('music_shelf').filter(call => call.data.shelf === 'recently_played')).toHaveLength(1);
    expect(called('music_picks')).toHaveLength(1);
    // A tap starts it on the room’s speaker; a newer tap replaces it (last tap wins).
    if (suggestion) await user.click(suggestion);
    const [first] = within(again).getAllByRole('button');
    if (first) await user.click(first);
    await waitFor(() => {
      const plays = called('play_media').map(call => `${String(call.entityId)} ${String(call.data.media_content_id)}`);
      expect(plays).toHaveLength(2);
      expect(plays[0]).toBe(`media_player.kokkenalrum ${FAKE_PLAYLISTS[0]?.uri ?? ''}`);
      expect(plays[1]).toMatch(/^media_player\.kokkenalrum spotify:track:/);
    });
  });

  it('Player-Tom without AI picks (HA Green): no suggestion row, »Hør igen« and Find musik stand', async () => {
    queryClient.clear();
    fakeFindMusic.addon = 'ai_unavailable';
    try {
      mount();
      const aside = showIdle();
      await aside.findByRole('group', {name: 'Hør igen'});
      await waitFor(() => {
        expect(called('music_picks')).toHaveLength(1);
      });
      expect(aside.queryByRole('group', {name: discoveryPeriodLabel(Date.now())})).toBeNull();
      expect(aside.getByRole('button', {name: 'Find musik'})).toBeTruthy();
    } finally {
      fakeFindMusic.addon = 'up';
    }
  });

  it('a playing player reads no »Hør igen«', async () => {
    queryClient.clear();
    mount();
    await screen.findByRole('complementary', {name: 'Rummets musik'});
    expect(called('music_shelf')).toHaveLength(0);
    // The AI picks are Hjem's Musik widget's own read (»forslag«, the same key): read once, never twice.
    expect(called('music_picks').length).toBeLessThanOrEqual(1);
  });

  it('a choice during the warm-up waits for the room’s own state, then moves the music once', async () => {
    const user = userEvent.setup();
    mount();
    const kitchen = fake.hass.states['media_player.kokkenalrum'];
    if (kitchen) lastKnownPlayers.setState({models: {'media_player.kokkenalrum': playerModel(kitchen)}});
    act(() => {
      fake.patch('media_player.kokkenalrum', 'unavailable', {});
    });
    const {sheet, speakers} = await openSheet(user);
    await user.click(speakers.getByRole('button', {name: 'Stue'}));
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
    const radio = within(mounted('#radio-view'));
    const station = await radio.findByRole('button', {name: 'P3 · Afspil på Køkkenalrum'});
    // The screen takes taps once its slide has given it pointer events (a waiting screen takes none).
    await waitFor(() => {
      expect(getComputedStyle(station.closest<HTMLElement>('[data-screen]') ?? station).pointerEvents)
        .not.toBe('none');
      const button = radio.getByRole<HTMLButtonElement>('button', {name: 'P3 · Afspil på Køkkenalrum'});
      expect(button.disabled).toBe(false);
    });
    // One activation (a virtual click, as assistive technology sends it): a pointer sequence could be cancelled by a
    // read landing between pointerdown and pointerup on a loaded test machine.
    act(() => {
      radio.getByRole('button', {name: 'P3 · Afspil på Køkkenalrum'}).click();
    });
    await waitFor(() => {
      expect(called('radio_command').map(call => call.data)).toEqual([{action: 'start', station_id: 'p3',
        target_id: 'kitchen'}]);
    });
    await waitFor(() => {
      expect(fake.hass.states['media_player.kokkenalrum']?.attributes.podconnect_source).toBe('radio');
    });
    // The hero shows P3 live (the needle on the scale); Stop is the player's (the radio plays through it).
    await waitFor(() => {
      expect(mounted('#radio-view').querySelector('[data-radio-phase]')?.getAttribute('data-radio-phase'))
        .toBe('spiller');
    });
    expect(radio.getByRole('img', {name: 'Stationsskala, valgt P3'})).toBeTruthy();
    await user.click(within(screen.getByRole('complementary', {name: 'Rummets musik'}))
      .getByRole('button', {name: 'Stop'}));
    await waitFor(() => {
      expect(fake.hass.states['media_player.kokkenalrum']?.state).toBe('idle');
    });
    expect(called('radio_command').map(call => call.data.action)).toEqual(['start', 'stop']);
  });

  it('Radio that cannot be reached is said so', async () => {
    mount();
    // Hjem's Radio widget holds the subscription from the start (its first push has landed); the integration pushes
    // the change.
    expect(await screen.findByRole('button', {name: 'Radio, Vælg station'})).toBeTruthy();
    fake.subscribers.set('podvoice/radio_subscribe', () => ({ok: true, available: false, reason: 'unreachable'}));
    act(() => {
      fake.pushAll('podvoice/radio_subscribe');
    });
    expect(await screen.findByRole('button', {name: 'Radio, Ikke tilgængelig'})).toBeTruthy();
    act(() => {
      useNav.getState().push('radio');
    });
    await waitFor(() => {
      expect(within(mounted('#radio-view')).getByText('PodConnect Speakers svarer ikke.')).toBeTruthy();
    });
    // Unavailable: a grey scale with no needle, and every station tile disabled.
    const view = mounted('#radio-view');
    expect(view.querySelector('[data-radio-phase]')?.getAttribute('data-radio-phase')).toBe('ikketilg');
    expect(view.querySelector('[data-needle]')).toBeNull();
    expect(within(view).getAllByRole<HTMLButtonElement>('button', {name: /^P/}).every(tile => tile.disabled))
      .toBe(true);
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
    const playing = {entity_id: 'media_player.a', state: 'playing', attributes: {media_title: 'Holocene'},
      last_changed: '', last_updated: ''};
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

describe('G7: music entries and routes', () => {
  beforeEach(() => {
    resetNav();
    resetSpeakers();
    commands.store.setState({wishes: {}});
    lastKnownPlayers.setState({models: {}});
    fakeSpeakerRooms.speakers = [];
  });

  const state = (value: string, attributes: Record<string, unknown> = {}) =>
    ({entity_id: 'media_player.x', state: value, attributes, last_changed: '', last_updated: ''});

  it('own music needs a track, and playing wins over an older pause', () => {
    expect(ownMusic(state('paused'))).toBe(false);
    expect(ownMusic(state('paused', {media_title: 'Holocene'}))).toBe(true);
    expect(ownMusic(state('playing', {media_content_id: 'spotify:track:x'}))).toBe(true);
    expect(ownMusic(state('playing', {media_title: 'P3', podconnect_source: 'radio'}))).toBe(false);
    const paused = state('paused', {media_title: 'Old'});
    const playing = {...state('playing', {media_title: 'New'}), entity_id: 'media_player.y'};
    expect(ownMusicOf([paused, playing])?.entity_id).toBe('media_player.y');
    expect(ownMusicOf([state('paused'), null])).toBeNull();
  });

  it('a speaker paused elsewhere with no track is not »away«; »Vælg musik« on Hjem opens Find musik', async () => {
    const user = userEvent.setup();
    mount();
    act(() => {
      fake.patch('media_player.kokkenalrum', 'idle', {media_title: undefined, media_artist: undefined,
        media_content_id: undefined});
      fake.patch('media_player.stue', 'paused', {media_title: undefined, media_artist: undefined,
        media_content_id: undefined});
    });
    const aside = within(screen.getByRole('complementary', {name: 'Rummets musik'}));
    await waitFor(() => {
      expect(aside.getByRole('button', {name: 'Find musik'})).toBeTruthy();
    });
    expect(document.querySelector('[data-player-state="away"]')).toBeNull();
    await user.click(screen.getByRole('button', {name: /^Musik, Vælg musik/}));
    expect(useNav.getState().stack.at(-1)?.screen).toBe('find');
  });

  it('while own music is paused the Musik widget is today’s AI pick, and it opens Find musik', async () => {
    const user = userEvent.setup();
    mount();
    act(() => {
      fake.patch('media_player.kokkenalrum', 'paused', {});
    });
    const widget = await screen.findByRole('button', {name: /^Musik, Regnvejr og torsdag aften/});
    expect(widget.getAttribute('data-opens')).toBe('find');
    await user.click(widget);
    expect(useNav.getState().stack.at(-1)?.screen).toBe('find');
  });

  it('Afspiller has a »Find musik« key beside the Kø heading, also when nothing plays', async () => {
    const user = userEvent.setup();
    mount();
    const view = await openMusic(user);
    await user.click(view.getByRole('button', {name: 'Find musik'}));
    expect(useNav.getState().stack.map(route => route.screen)).toEqual(['home', 'music', 'find']);
    act(() => {
      useNav.getState().back();
      fake.patch('media_player.kokkenalrum', 'idle', {media_title: undefined, media_artist: undefined,
        media_content_id: undefined});
    });
    expect(within(musicView()).getByText('Intet spiller lige nu')).toBeTruthy();
    expect(within(musicView()).getByRole('button', {name: 'Find musik'})).toBeTruthy();
  });

  it('Find musik marks the tile that plays once the speaker confirms the start', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', {name: /^Musik, /}));
    const [flume] = await screen.findAllByRole('button', {name: 'Afspil Flume · Bon Iver'});
    if (!flume) throw new Error('no Flume tile');
    const find = within(mounted('#find-view'));
    expect(flume.getAttribute('data-playing')).toBeNull();
    await user.click(flume);
    await waitFor(() => {
      expect(fake.hass.states['media_player.kokkenalrum']?.attributes.media_title).toBe('Flume');
    });
    await waitFor(() => {
      expect(find.getAllByRole('button', {name: 'Afspil Flume · Bon Iver'})
        .map(tile => tile.getAttribute('data-playing'))).toContain('true');
    });
    expect(find.getAllByText('Spiller').length).toBeGreaterThan(0);
  });
});

describe('the timeline never steps back by itself', () => {
  it('holds a late HA position under 3 s behind, shows a real jump back and a new track', () => {
    expect(heldPosition(null, 'a', 40)).toBe(40);
    expect(heldPosition({key: 'a', at: 42}, 'a', 40.5)).toBe(42);
    expect(heldPosition({key: 'a', at: 42}, 'a', 43)).toBe(43);
    expect(heldPosition({key: 'a', at: 42}, 'a', 10)).toBe(10);
    expect(heldPosition({key: 'a', at: 42}, 'b', 1)).toBe(1);
  });
});
