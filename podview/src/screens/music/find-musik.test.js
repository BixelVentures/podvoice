// Find musik (concept B): what the page draws from PodVoice's shelves read, and how it draws it.
// Replaces the old four-tab tests (tabs, three cards per tab, »Andre forslag«); see the commit for the list.
import assert from 'node:assert/strict';
import {afterEach, beforeEach, test, vi} from 'vitest';
import {aiBadge, playedLabel, shelvesPage, shelvesSource, tileSelection, tileSubtitle} from './model';
import {ITEMS, liveFixture, shelvesBody} from './shelves-fixture.js';

const snapshot = {bootId: 'boot', roomId: 'room', capabilities: {musicSelection: true}};
const NOW = Date.parse('2026-11-19T13:13:00Z');
let f;

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  f?.cleanup();
  f = null;
  vi.useRealTimers();
});

const shelfTitles = root => [...root.querySelectorAll('.find-shelf h2')].map(node => node.textContent);

test('the page draws six quick picks and every shelf in PodVoice\'s order, with no tabs', async () => {
  f = liveFixture();
  await f.shelves.read();
  const quick = [...f.root.querySelectorAll('.find-quick-tile')];
  assert.equal(quick.length, 6);
  assert.deepEqual(quick.map(tile => tile.querySelector('strong').textContent),
    ['Kind of Blue', 'Rainy Day Jazz 1', 'Søndagsmorgen', 'Radiofortællinger', 'Nina Simone', 'Afternoon Focus 1']);
  assert.deepEqual(shelfTitles(f.root), ['Til en regnvejrs-torsdag', 'Jeres kunstnere', 'Fordi I hører Nina Simone',
    'Fortsæt med at lytte', 'Til eftermiddagen', 'Gemte album', 'Op mod jul', 'Podcasts']);
  // The old page's tabs, refresh and three-card list are gone.
  for (const gone of ['#music-refinements', '[data-collection]', '#music-refresh', '#result-list', '.result']) {
    assert.equal(f.root.querySelector(gone), null, gone);
  }
});

test('AI shelves carry the AI-valgt badge and PodVoice\'s one-line reason; library shelves never do', async () => {
  f = liveFixture();
  await f.shelves.read();
  for (const shelf of f.root.querySelectorAll('.find-shelf')) {
    const ai = shelf.dataset.shelf.startsWith('ai_');
    assert.equal(!!shelf.querySelector('.find-ai-badge'), ai, shelf.dataset.shelf);
    if (ai) assert.equal(shelf.querySelector('.find-ai-badge').textContent, 'AI-valgt');
  }
  const moment = f.root.querySelector('[data-shelf=ai_moment]');
  assert.equal(moment.querySelector('.find-why').textContent, 'Fordi det regner og det er torsdag eftermiddag.');
  assert.equal(f.root.querySelector('[data-shelf=recent] .find-why'), null);
  assert.equal(f.root.querySelector('[data-shelf=artists] .find-why').textContent, 'Det, I spiller mest');
  // Quick AI picks say so, with the short reason; the others say nothing extra.
  const lines = [...f.root.querySelectorAll('.find-quick-tile')].map(tile =>
    tile.querySelector('.find-ai-line')?.textContent ?? null);
  assert.deepEqual(lines, [null, 'AI-valgt · regn', null, null, null, 'AI-valgt · eftermiddag']);
  assert.equal(aiBadge('sne'), 'AI-valgt · sne');
});

test('each shelf type draws its own tile: round artists, typed recents, album artists, podcasts', async () => {
  vi.useFakeTimers({now: NOW, toFake: ['Date']});
  f = liveFixture();
  await f.shelves.read();
  const tiles = id => [...f.root.querySelectorAll(`[data-shelf=${id}] .find-tile`)].map(tile =>
    [tile.dataset.shape, tile.querySelector('strong').textContent, tile.querySelector('span:not(.find-art)')
      ?.textContent ?? '']);
  assert.deepEqual(tiles('artists'), [['round', 'Nina Simone', ''], ['round', 'Bill Evans', '']]);
  assert.deepEqual(tiles('recent'), [['square', 'Kind of Blue', 'Album · i går'],
    ['square', 'Søndagsmorgen', 'Playliste · i søndags'], ['square', 'Radiofortællinger', 'Podcast · i dag'],
    ['square', 'Nina Simone', 'Kunstner']]);
  assert.deepEqual(tiles('albums'), [['square', 'Kind of Blue', 'Miles Davis'], ['square', 'Blue', 'Joni Mitchell']]);
  assert.deepEqual(tiles('podcasts'), [['square', 'Radiofortællinger', 'Podcast'], ['square', 'Det Røde Rum',
    'Podcast']]);
  assert.deepEqual(tiles('ai_moment'), [['square', 'Rainy Day Jazz 1', 'Playliste']]);
  // A shelf is a native horizontal scroller of fixed 136 px covers.
  const row = f.root.querySelector('[data-shelf=recent] .find-shelf-row');
  assert.equal(row.getAttribute('role'), 'list');
  assert.equal(row.querySelectorAll(':scope > .find-slot').length, 4);
});

test('empty or unavailable shelves are simply absent; an empty page says what to do', async () => {
  const body = shelvesBody();
  body.shelves = body.shelves.filter(shelf => !shelf.ai && shelf.id !== 'podcasts');
  body.quick = body.quick.filter(pick => !pick.ai);
  f = liveFixture({body});
  await f.shelves.read();
  assert.deepEqual(shelfTitles(f.root), ['Jeres kunstnere', 'Fortsæt med at lytte', 'Gemte album']);
  assert.equal(f.root.querySelector('.find-ai-badge'), null);
  assert.equal(f.root.querySelector('.find-empty'), null);
  f.serve({...shelvesBody(), items: [], quick: [], shelves: [], candidateSet: undefined});
  await f.shelves.read();
  assert.equal(f.root.querySelectorAll('.find-shelf').length, 0);
  assert.match(f.root.querySelector('.find-empty').textContent, /Lyt til noget i Spotify/);
});

test('an identical render writes nothing; a changed shelf replaces only what changed', async () => {
  f = liveFixture();
  await f.shelves.read();
  const first = f.root.querySelector('[data-shelf=albums] .find-tile');
  const writes = [];
  const observer = new MutationObserver(records => writes.push(...records));
  observer.observe(f.root, {subtree: true, childList: true, attributes: true, characterData: true});
  f.shelves.render();
  await f.shelves.read();
  f.shelves.render();
  await Promise.resolve();
  assert.deepEqual(writes.filter(record => record.attributeName !== 'data-ready'), []);
  const next = shelvesBody();
  next.items[8] = {...next.items[8], name: 'Blue (Remastered)'};
  f.serve(next);
  await f.shelves.read();
  await Promise.resolve();
  observer.disconnect();
  assert.equal(f.root.querySelector('[data-shelf=albums] .find-tile'), first);
  const changed = writes.filter(record => record.type === 'characterData' || record.type === 'childList');
  assert.ok(changed.length > 0 && changed.every(record =>
    record.target.textContent?.includes('Remastered') || record.target.parentNode?.textContent?.includes('Remastered')));
});

test('covers show only when decoded, the first twelve load eagerly and a missing cover keeps its place', async () => {
  f = liveFixture();
  await f.shelves.read();
  const images = [...f.root.querySelectorAll('.find-art > img')];
  assert.ok(images.length > 12);
  assert.deepEqual(images.slice(0, 5).map(image => image.getAttribute('loading')), Array(5).fill('eager'));
  assert.equal(images.at(-1).getAttribute('loading'), 'lazy');
  const image = images[0];
  assert.equal(image.hasAttribute('data-ready'), false);
  image.decode = () => Promise.resolve();
  image.dispatchEvent(new Event('load'));
  await new Promise(resolve => { setTimeout(resolve, 0); });
  assert.equal(image.hasAttribute('data-ready'), true);
  // »Afternoon Focus 1« has no cover: its tile keeps the cover's place, with no broken image.
  const empty = f.tile('Afternoon Focus 1').querySelector('.find-art');
  assert.equal(empty.querySelector('img'), null);
});

test('the read is closed: a wrong room, account, schema, shelf id or artwork host is never shown', () => {
  const body = shelvesBody();
  assert.ok(shelvesPage(body, 'account', snapshot));
  assert.equal(shelvesPage({...body, roomId: 'other'}, 'account', snapshot), null);
  assert.equal(shelvesPage(body, 'other', snapshot), null);
  assert.equal(shelvesPage({...body, schema: 'podview.music_shelves.v2'}, 'account', snapshot), null);
  const unknownShelf = shelvesBody();
  unknownShelf.shelves[0].id = 'ai_weather';
  assert.equal(shelvesPage(unknownShelf, 'account', snapshot), null);
  const aiWithoutReason = shelvesBody();
  aiWithoutReason.shelves[0].why = null;
  assert.equal(shelvesPage(aiWithoutReason, 'account', snapshot), null);
  const foreignArt = shelvesBody();
  foreignArt.items[0].artwork = 'https://evil.example/image/x';
  assert.equal(shelvesPage(foreignArt, 'account', snapshot).items[0].artwork, undefined);
  const track = shelvesBody();
  track.items[0].uri = 'spotify:track:' + 'x'.repeat(22);
  assert.equal(shelvesPage(track, 'account', snapshot), null);
});

test('one tile is one candidate of the page\'s choice set, for one minute', () => {
  const body = shelvesBody();
  const page = shelvesPage(body, 'account', snapshot);
  const source = shelvesSource(body, page, snapshot, Date.now());
  assert.equal(source.sourceKind, 'shelves');
  assert.equal(source.tracks.length, ITEMS.length);
  const chosen = tileSelection(source, ITEMS[8].uri);
  assert.deepEqual(chosen.candidateIds, ['8'.padStart(24, 'a')]);
  assert.deepEqual(chosen.tracks, [{uri: ITEMS[8].uri, name: 'Blue', artist: 'Album',
    artwork: {kind: 'album_cover', provider: 'spotify', url: ITEMS[8].artwork}}]);
  assert.equal(tileSelection({...source, expiresAt: Date.now() - 1}, ITEMS[8].uri), null);
  assert.equal(shelvesSource(body, page, {...snapshot, capabilities: {musicSelection: false}}, Date.now()), null);
  assert.equal(shelvesSource({...body, candidateSet: {...body.candidateSet, sourceKind: 'mood'}}, page, snapshot,
    Date.now()), null);
});

test('played labels follow the Copenhagen calendar', () => {
  const now = Date.parse('2026-11-19T13:13:00Z');
  assert.equal(playedLabel('2026-11-19T00:30:00Z', now), 'i dag');
  assert.equal(playedLabel('2026-11-18T23:30:00Z', now), 'i dag');
  assert.equal(playedLabel('2026-11-18T22:30:00Z', now), 'i går');
  assert.equal(playedLabel('2026-11-18T17:10:00Z', now), 'i går');
  assert.equal(playedLabel('2026-11-13T09:00:00Z', now), 'i fredags');
  assert.match(playedLabel('2026-11-01T09:00:00Z', now), /^1\. nov/);
  assert.equal(playedLabel(undefined, now), '');
  const shelf = {id: 'recent', title: '', ai: false, why: null, shape: 'square', items: []};
  assert.equal(tileSubtitle({uri: '', kind: 'show', name: 'x'}, shelf, now), 'Podcast');
});
