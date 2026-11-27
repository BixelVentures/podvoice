'use strict';
// Find musik B in the HA panel journey (wired in by tests/browser/ha_panel_actual_e2e.cjs with Find musik already
// open). Drives every new interaction against the fake hass (podview/src/lib/ha/fixtures/music.ts):
// - »AI-valgt«: the add-on's shelf shows its badge and reason; a playlist tap starts it as a context, once.
// - Stemning/Humør: a theme chip opens a shelf of real playlists, read once; the chip shows the choice at once.
// - Search: a submitted query is one podvoice.music_search; a result tap starts the track on the room's speaker.
// Nothing is inert (but the stack's hidden screens and Ro waiting unseen) or modal afterwards, and no tap waits for an earlier one.

async function findMusicSteps(page, {sleep, assert}) {
  const panel = page.frameLocator('iframe');
  const frame = page.frames().find(item => item !== page.mainFrame());
  const find = panel.locator('#find-view');
  const calls = service => page.evaluate(name => window.fakeHass.calls.filter(c => c.service === name)
    .map(c => ({entityId: c.entityId, data: c.data})), service);

  // »AI-valgt«: badge, reason and real playlists; a tap plays the playlist as a context.
  const moment = find.getByRole('group', {name: 'Regnvejr og torsdag aften'});
  await moment.getByRole('button').first().waitFor();
  const shelf = find.getByRole('region', {name: 'Regnvejr og torsdag aften'});
  assert.equal((await shelf.locator('[data-badge="ai"]').textContent()).trim(), 'AI-valgt');
  await shelf.getByText('Fordi det regner og det er torsdag aften.').waitFor();
  assert.equal((await calls('music_picks')).length, 1, 'AI picks are read once');
  const before = (await calls('play_media')).length;
  await moment.getByRole('button').first().tap();
  await page.waitForFunction(n => window.fakeHass.calls.filter(c => c.service === 'play_media').length === n + 1,
    before);
  const started = (await calls('play_media')).at(-1);
  assert.equal(started.data.media_content_type, 'playlist');
  assert.match(started.data.media_content_id, /^spotify:playlist:/);

  // Stemning: the chip shows the choice within 100 ms; its playlists are read once.
  const chip = find.getByRole('radiogroup', {name: 'Stemning'}).getByRole('radio', {name: 'Rolig aften', exact: true});
  // The moods stand at the bottom of the long page (Hylder): the finger reaches them after the scroll settles, so the
  // 100 ms measures the chip's answer, not the scroll.
  await chip.scrollIntoViewIfNeeded();
  await sleep(300);
  await chip.tap();
  await frame.waitForFunction(() => [...document.querySelectorAll('[role=radio]')].some(node =>
    node.textContent === 'Rolig aften' && node.getAttribute('aria-checked') === 'true'), null, {timeout: 100});
  await find.getByRole('group', {name: 'Rolig aften', exact: true}).getByRole('button').first().waitFor();
  await find.getByRole('radiogroup', {name: 'Humør'}).getByRole('radio', {name: 'Lounge', exact: true}).tap();
  await find.getByRole('group', {name: 'Lounge', exact: true}).getByRole('button').first().waitFor();
  await chip.tap();
  await find.getByRole('group', {name: 'Rolig aften', exact: true}).waitFor();
  assert.deepEqual((await calls('music_search')).map(c => c.data.theme), ['evening_jazz', 'lounge'],
    'each theme is read once (the cache answers the second visit)');

  // Search: one Spotify search per submitted query; a result starts the track on the room's speaker.
  const field = find.getByRole('searchbox', {name: 'Søg efter en sang'});
  await field.tap();
  await field.fill('flume');
  await find.getByRole('button', {name: 'Søg'}).tap();
  const results = find.getByRole('group', {name: 'Søgeresultater'});
  await results.getByRole('button', {name: 'Afspil Flume · Bon Iver'}).tap();
  await page.waitForFunction(() => window.fakeHass.calls.some(c => c.service === 'play_media'
    && c.data.media_content_type === 'music'));
  await page.waitForFunction(() =>
    Object.values(window.fakeHass.hass.states).some(state => state.attributes.media_title === 'Flume'));
  const searches = (await calls('music_search')).filter(c => c.data.query !== undefined);
  assert.deepEqual(searches.map(c => c.data), [{query: 'flume', kind: 'track'}]);

  await sleep(200);
  assert.deepEqual(await frame.evaluate(() => [...document.querySelectorAll('[inert]:not([data-screen]:not([data-place=center])):not([data-rest][data-place=waiting]),dialog[open]')]
    .map(node => `${node.tagName}#${node.id}`)), [],
  'nothing inert after Find musik');
}

module.exports = {findMusicSteps};
