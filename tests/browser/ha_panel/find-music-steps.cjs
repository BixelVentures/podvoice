'use strict';
// Find musik B in the HA panel journey (wired in by tests/browser/ha_panel_actual_e2e.cjs with Find musik already
// open). Drives every new interaction against the fake hass (podview/src/lib/ha/fixtures/music.ts):
// - »AI-valgt«: the add-on's shelf shows its badge and reason; a playlist tap starts it as a context, once.
// - Stemning/Humør: a theme chip opens a shelf of real playlists, read once; the chip shows the choice at once.
// - Search: a submitted query is one podvoice.music_search; a result tap starts the track on the room's speaker.
// - A tap's item shows in the player at once with its loading mark (pending), then the speaker's own state
//   (confirmed, the same cover); a start PodConnect refuses brings the previous state back with »Kunne ikke starte
//   på …« in the player and where it was tapped (failed).
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
  const aside = panel.getByRole('complementary', {name: 'Rummets musik'});
  // Pending → confirmed: the speaker holds its answer; the player shows Flume at once, then the speaker's state.
  await page.evaluate(() => { window.fakeHass.mode = 'silent'; });
  await results.getByRole('button', {name: 'Afspil Flume · Bon Iver'}).tap();
  const pending = aside.getByRole('article', {name: 'Flume: Starter afspilning'});
  await pending.waitFor({timeout: 100});
  assert.equal(await pending.getAttribute('aria-busy'), 'true');
  const art = await pending.locator('img').first().getAttribute('src');
  await page.waitForFunction(() => window.fakeHass.calls.some(c => c.service === 'play_media'
    && c.data.media_content_type === 'music'));
  await page.evaluate(() => {
    const call = window.fakeHass.calls.filter(c => c.service === 'play_media').at(-1);
    window.fakeHass.mode = 'confirm';
    window.fakeHass.patch(call.entityId, 'playing', {media_title: 'Flume', media_artist: 'Bon Iver',
      media_content_id: call.data.media_content_id, podconnect_source: 'spotify'});
  });
  const confirmed = aside.getByRole('article', {name: /: Spiller$/});
  await confirmed.waitFor({timeout: 1000});
  assert.equal(await confirmed.locator('img').first().getAttribute('src'), art,
    'the hand-over keeps the tapped cover (no second picture)');
  await page.waitForFunction(() =>
    Object.values(window.fakeHass.hass.states).some(state => state.attributes.media_title === 'Flume'));
  // Pending → failed: PodConnect refuses the start (Green: »r7: start failed«); Flume plays on, and both the player
  // and the results say so; nothing spins.
  await page.evaluate(() => { window.fakeSpeakers.failStart.add('media_player.kokkenalrum'); });
  await find.getByRole('group', {name: 'Hurtige valg'}).getByRole('button').first().tap();
  await aside.getByText('Kunne ikke starte på Køkkenalrum').waitFor({timeout: 2000});
  await find.getByText('Kunne ikke starte på Køkkenalrum').waitFor({timeout: 1000});
  assert.match(await aside.getByRole('article').first().getAttribute('aria-label'), /: Spiller$/,
    'the previous state comes back after a failed start');
  assert.equal(await frame.evaluate(() => document.querySelectorAll('[aria-busy="true"]').length), 0,
    'nothing spins after a failed start');
  await page.evaluate(() => { window.fakeSpeakers.failStart.clear(); });
  const searches = (await calls('music_search')).filter(c => c.data.query !== undefined);
  assert.deepEqual(searches.map(c => c.data), [{query: 'flume', kind: 'track'}]);

  await sleep(200);
  assert.deepEqual(await frame.evaluate(() => [...document.querySelectorAll('[inert]:not([data-screen]:not([data-place=center])):not([data-rest][data-place=waiting]),dialog[open]')]
    .map(node => `${node.tagName}#${node.id}`)), [],
  'nothing inert after Find musik');
}

module.exports = {findMusicSteps};
