import {act, render, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it} from 'vitest';
import {Providers} from '../../app/Providers';
import {commands} from '../../lib/ha/commands';
import {resetFindChoices} from '../../lib/ha/find-music';
import {FAKE_PLAYLISTS, FAKE_TRACKS, fakeFindMusic, fakeSpeakerRooms} from '../../lib/ha/fixtures/music';
import {createFakeHass, FAKE_PANEL} from '../../lib/ha/ha-fixture';
import type {FakeHass} from '../../lib/ha/ha-fixture';
import {lastKnownPlayers} from '../../lib/ha/media';
import {resetSpeakers} from '../../lib/ha/podconnect';
import {transport} from '../../lib/ha/transport';
import {resetNav, useNav} from '../nav';
import {Shell} from '../Shell';

let fake: FakeHass;

function mount() {
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
  transport.resync();
  render(
    <Providers>
      <Shell />
    </Providers>,
  );
  act(() => {
    useNav.getState().push('find');
  });
  const view = document.querySelector<HTMLElement>('#find-view');
  if (!view) throw new Error('#find-view is not mounted');
  return within(view);
}

const called = (service: string) => fake.calls.filter(call => call.service === service);
// An element's accessible description: the text of what aria-describedby names, in order.
const description = (element: Element) => (element.getAttribute('aria-describedby') ?? '').split(/\s+/)
  .filter(Boolean).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim();

describe('Find musik B on the HA panel', () => {
  beforeEach(() => {
    resetNav();
    resetSpeakers();
    resetFindChoices();
    commands.store.setState({wishes: {}});
    lastKnownPlayers.setState({models: {}});
    fakeSpeakerRooms.speakers = [];
    fakeFindMusic.addon = 'up';
    fakeFindMusic.rateLimited = false;
  });

  it('shows the add-on’s AI picks as real playlists, each labelled AI-valgt with its reason', async () => {
    const find = mount();
    const moment = await find.findByRole('group', {name: 'Regnvejr og torsdag aften'});
    const section = moment.closest('section');
    if (!section) throw new Error('no shelf');
    expect(section.querySelector('[data-badge="ai"]')?.textContent.trim()).toBe('AI-valgt');
    expect(within(section).getByText('Fordi det regner og det er torsdag aften.')).toBeTruthy();
    const cards = within(moment).getAllByRole('button');
    expect(cards.map(card => card.getAttribute('aria-label'))).toEqual(
      FAKE_PLAYLISTS.slice(0, 3).map(row => `Afspil ${row.name} · Playliste`));
    for (const card of cards) {
      expect(within(card).getByText('AI-valgt')).toBeTruthy();
      expect(description(card)).toBe('AI-valgt Fordi det regner og det er torsdag aften.');
    }
    expect(find.getByRole('group', {name: 'Fordi I hører Bon Iver'})).toBeTruthy();
    expect(find.getByRole('group', {name: 'Op mod jul'})).toBeTruthy();
    // Asked once, with the panel's own weather entity (the Vejr screen's), and kept.
    expect(called('music_picks').map(call => call.data)).toEqual([{weather_entity: 'weather.forecast_hjem'}]);
    act(() => {
      useNav.getState().back();
      useNav.getState().push('find');
    });
    expect(called('music_picks')).toHaveLength(1);
    // The library shelves are there too.
    expect(find.getByRole('group', {name: 'For dig'})).toBeTruthy();
  });

  it('without the add-on only AI-valgt is missing, and the page says so; search and moods still work', async () => {
    fakeFindMusic.addon = 'down';
    const user = userEvent.setup();
    const find = mount();
    expect(await find.findByText(/PodVoice-add-on’et svarer ikke lige nu/)).toBeTruthy();
    expect(find.queryByText('AI-valgt')).toBeNull();
    await waitFor(() => {
      expect(find.getAllByRole('button', {name: /Afspil Holocene/}).length).toBeGreaterThan(0);
    });
    await user.click(await find.findByRole('radio', {name: 'Jazz & lounge'}));
    expect(await find.findByRole('group', {name: 'Jazz & lounge'})).toBeTruthy();
    await user.type(find.getByRole('searchbox', {name: 'Søg efter en sang'}), 'flume');
    await user.click(find.getByRole('button', {name: 'Søg'}));
    const results = await find.findByRole('group', {name: 'Søgeresultater'});
    expect(await within(results).findByRole('button', {name: 'Afspil Flume · Bon Iver'})).toBeTruthy();
  });

  it('says honestly when AI picks are not switched on in the add-on', async () => {
    fakeFindMusic.addon = 'ai_unavailable';
    const find = mount();
    expect(await find.findByText(/AI-valgte forslag er ikke slået til/)).toBeTruthy();
  });

  it('Stemning and Humør: the add-on’s own themes; a theme opens real playlists, read once', async () => {
    const user = userEvent.setup();
    const find = mount();
    const stemning = await find.findByRole('radiogroup', {name: 'Stemning'});
    const humor = find.getByRole('radiogroup', {name: 'Humør'});
    expect(within(stemning).getAllByRole('radio').map(chip => chip.textContent)).toEqual([
      'En rolig morgen', 'Rolig aften', 'Musik til madlavningen', 'En italiensk aften', 'Indie i baggrunden',
      'En rolig stund']);
    expect(within(humor).getAllByRole('radio')).toHaveLength(9);
    const evening = within(stemning).getByRole('radio', {name: 'Rolig aften'});
    await user.click(evening);
    expect(evening.getAttribute('aria-checked')).toBe('true');
    const shelf = await find.findByRole('group', {name: 'Rolig aften'});
    await waitFor(() => {
      expect(within(shelf).getAllByRole('button')).toHaveLength(3);
    });
    expect(called('music_search').map(call => call.data)).toEqual([{theme: 'evening_jazz'}]);
    // A theme in the other row replaces it (last tap wins); the first one, chosen again, comes from the cache.
    await user.click(within(humor).getByRole('radio', {name: 'Lounge'}));
    expect(evening.getAttribute('aria-checked')).toBe('false');
    expect(await find.findByRole('group', {name: 'Lounge'})).toBeTruthy();
    expect(find.queryByRole('group', {name: 'Rolig aften'})).toBeNull();
    await user.click(evening);
    expect(await find.findByRole('group', {name: 'Rolig aften'})).toBeTruthy();
    expect(called('music_search').map(call => call.data.theme)).toEqual(['evening_jazz', 'lounge']);
    // Tapping the chosen theme again closes it.
    await user.click(evening);
    expect(find.queryByRole('group', {name: 'Rolig aften'})).toBeNull();
  });

  it('search: one Spotify search per submitted query, results play on the room’s speaker', async () => {
    const user = userEvent.setup();
    const find = mount();
    const field = find.getByRole('searchbox', {name: 'Søg efter en sang'});
    expect(find.getByRole('button', {name: 'Søg'}).hasAttribute('disabled')).toBe(true);
    await user.type(field, '  flume ');
    await user.keyboard('{Enter}');
    const results = await find.findByRole('group', {name: 'Søgeresultater'});
    const flume = await within(results).findByRole('button', {name: 'Afspil Flume · Bon Iver'});
    expect(called('music_search').map(call => call.data)).toEqual([{query: 'flume', kind: 'track'}]);
    await user.click(flume);
    const track = FAKE_TRACKS.find(row => row.title === 'Flume');
    expect(called('play_media').map(call => [call.entityId, call.data])).toEqual([
      ['media_player.kokkenalrum', {media_content_id: track?.uri, media_content_type: 'music'}]]);
    await waitFor(() => {
      expect(fake.hass.states['media_player.kokkenalrum']?.attributes.media_title).toBe('Flume');
    });
    // The same query again is the cached answer; nothing matches → the page says so.
    await user.click(find.getByRole('button', {name: 'Søg'}));
    expect(called('music_search')).toHaveLength(1);
    await user.clear(field);
    await user.type(field, 'zzz{Enter}');
    expect(await find.findByText('Ingen forslag matcher. Prøv en anden retning.')).toBeTruthy();
  });

  it('search answers beyond Spotify’s 10 rows are not read; a rate limit is said, never retried', async () => {
    const user = userEvent.setup();
    const find = mount();
    const row = {kind: 'track', uri: FAKE_TRACKS[0]?.uri, name: 'x', byline: null, artwork: null};
    fake.handle('podvoice.music_search', () => ({response: {ok: true, kind: 'track', query: 'many',
      items: Array.from({length: 11}, () => row)}}));
    await user.type(find.getByRole('searchbox', {name: 'Søg efter en sang'}), 'many{Enter}');
    expect(await find.findByText('Svaret kunne ikke læses. Prøv igen.')).toBeTruthy();
    expect(find.queryByRole('button', {name: /^Afspil x/})).toBeNull();
    fake.handle('podvoice.music_search', () => ({response: {ok: false, error: 'rate_limited', items: []}}));
    await user.click(await find.findByRole('radio', {name: 'Festmusik'}));
    expect(await find.findByText(/Spotify beder os vente lidt/)).toBeTruthy();
    expect(called('music_search')).toHaveLength(2);
  });

  it('a playlist plays as a context on the next destination; the speaker confirms; taps are never locked', async () => {
    const user = userEvent.setup();
    const find = mount();
    act(() => {
      fake.patch('media_player.kokkenalrum', 'idle', {media_title: undefined, media_artist: undefined});
    });
    const moment = await find.findByRole('group', {name: 'Regnvejr og torsdag aften'});
    const [first, second] = within(moment).getAllByRole('button');
    if (!first || !second) throw new Error('no cards');
    await user.click(first);
    // A second tap during the start goes through at once (last tap wins), never resent.
    expect(second.hasAttribute('disabled')).toBe(false);
    await user.click(second);
    expect(called('play_media').map(call => [call.entityId, call.data])).toEqual([
      ['media_player.kokkenalrum', {media_content_id: FAKE_PLAYLISTS[0]?.uri, media_content_type: 'playlist'}],
      ['media_player.kokkenalrum', {media_content_id: FAKE_PLAYLISTS[1]?.uri, media_content_type: 'playlist'}],
    ]);
    await waitFor(() => {
      expect(fake.hass.states['media_player.kokkenalrum']?.state).toBe('playing');
    });
    // The speaker playing ends the wish: confirmed.
    await waitFor(() => {
      expect(commands.store.getState().wishes['music:start']).toBeUndefined();
    });
    expect(called('play_media')).toHaveLength(2);
  });
});
