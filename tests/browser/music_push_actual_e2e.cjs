'use strict';
// Partial A6/A8 coverage: inert HA playback changes reach the actual browser and broker.
// This does not measure Spotify polling/provider delay or physical playback.
const {chromium} = require('playwright');
const testEnv = require('./podview_actual_env.cjs');
const {spawn} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const {createHash, randomUUID} = require('node:crypto');

const port = Number(process.env.MUSIC_PUSH_TEST_PORT || 18977);
const base = `http://127.0.0.1:${port}`;
const coverUrl = 'https://i.scdn.co/image/InertExternalStartCover';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ownerState = () => fetch(base + '/lab/state').then(r => r.json());
const lab = body =>
  fetch(base + '/lab/state', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body || {}),
  }).then(r => r.json());

async function shownWithin(page, check, arg, ms, label) {
  const started = Date.now();
  await page.waitForFunction(check, arg, {timeout: ms}).catch(async () => {
    console.log('pushFailureEvidence', JSON.stringify({owner: await ownerState(), browser: await page.locator('pv-widget-host').evaluate(h => ({
      title: document.querySelector('#track-name')?.textContent, transportConnected: h.liveTransport?.connected,
      playback: h.liveMedia?.playback, readState: h.liveMedia?.readState, pending: h.liveMedia?.pending,
      intentPending: h.liveControls?.musicIntentPending, records: h.liveTransport?.diagnostics?.().records,
    }))}));
    await page.screenshot({path: path.join(testEnv.artifactDir(), `podview-music-push-fail-${label}.png`)});
    throw new Error(`${label}: not shown within ${ms} ms`);
  });
  return Date.now() - started;
}

let server;
let browser;
(async () => {
  try {
    const data = await fs.mkdtemp(path.join(os.tmpdir(), 'podview-music-push-'));
    const nonce = randomUUID();
    server = spawn(testEnv.python, [path.join(__dirname, 'music_e2e_server.py')], {
      cwd: testEnv.runtimeRoot,
      env: testEnv.pythonEnv({MUSIC_TEST_PORT: String(port), MUSIC_TEST_DATA: data, MUSIC_EXTENDED: '1',
        MUSIC_PUSH_COVER_TEST: '1', PODVIEW_TEST_NONCE: nonce}),
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    for (let n = 0; ; n++) {
      if (server.exitCode !== null) throw new Error('server exited');
      try {
        if ((await fetch(base + '/view/')).ok) break;
      } catch {}
      if (n > 100) throw new Error('server start timeout');
      await sleep(100);
    }
    assert.equal((await (await fetch(base + '/lab/identity')).json()).nonce, nonce, 'own isolated runtime');
    await lab({externalPlaybackState: 'paused'});
    browser = await chromium.launch({...testEnv.browserOptions(), args: ['--mute-audio']});
    const page = await browser.newPage({hasTouch: true, viewport: {width: 1280, height: 800}});
    let coverRequests = 0;
    const actionPosts = [];
    await page.route(/^https?:\/\//, async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === base) return route.continue();
      if (request.url() !== coverUrl || request.resourceType() !== 'image') return route.abort();
      coverRequests++;
      return route.fulfill({contentType: 'image/svg+xml', headers: {'Access-Control-Allow-Origin': '*'},
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">'
          + '<rect width="64" height="64" fill="teal"/></svg>'});
    });
    page.on('request', request => {
      if (request.method() === 'POST' && /\/view\/api\/(?:music\/[^/]+\/|control\/)?actions$/.test(
        new URL(request.url()).pathname)) actionPosts.push(request.postDataJSON()?.action);
    });
    const bundleResponse = page.waitForResponse(response => response.url() === base + '/view/podview.bundle.js');
    await page.goto(base + '/view/?room=kitchen', {waitUntil: 'domcontentloaded'});
    const bundleSHA = createHash('sha256').update(await (await bundleResponse).body()).digest('hex');
    if (process.env.MUSIC_EXPECTED_BUNDLE) assert.equal(bundleSHA, process.env.MUSIC_EXPECTED_BUNDLE);
    await page.waitForFunction(() => document.querySelector('#track-name')?.textContent?.trim() === 'Isoleret sang 1',
      undefined, {timeout: 15000});
    await testEnv.openOverview(page);

    // A cold PodView has never started playback. The inert Spotify owner starts a new song.
    assert.deepEqual((await ownerState()).writes, []);
    const started = await lab({externalSong: 7, externalPlaybackState: 'playing'});
    await shownWithin(page, () => {
      const title = document.querySelector('#track-name')?.textContent?.trim();
      const output = document.querySelector('#output');
      const button = document.querySelector('#play-pause');
      return title === 'Isoleret sang 7' && output?.textContent.includes('Køkkenalrum HomePod')
        && output?.getAttribute('aria-label')?.includes('Aktuelt output')
        && button && !button.disabled && /pause/i.test(button.getAttribute('aria-label') || '');
    }, undefined, 8000, 'external-start-on-kitchen');
    const cover = page.locator('#cover');
    await shownWithin(page, url => {
      const image = document.getElementById('cover');
      return image?.currentSrc === url && image.complete && image.naturalWidth === 64
        && image.checkVisibility({visibilityProperty: true, opacityProperty: true});
    }, coverUrl, 5000, 'external-start-cover-decoded');
    const decodedCover = await cover.evaluate(async image => {
      await image.decode();
      window.a8Cover = {image, mutations: []};
      const observer = new MutationObserver(changes => {
        window.a8Cover.mutations.push(...changes.map(change => change.attributeName));
      });
      observer.observe(image, {attributes: true, attributeFilter: ['src', 'class', 'style', 'hidden']});
      return {source: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight};
    });
    assert.deepEqual(decodedCover, {source: coverUrl, width: 64, height: 64});
    assert(coverRequests > 0, 'the visible cover must come from the intercepted owner image URL');
    assert.deepEqual((await ownerState()).writes, [], 'external playback must not send a local effect');
    assert.deepEqual(actionPosts, [], 'external playback must not issue a browser action');

    const refreshed = await lab({externalSong: 7});
    assert(refreshed.sequence > started.sequence);
    await shownWithin(page, ({sequence, url}) => {
      const playback = document.querySelector('pv-widget-host')?.liveMedia?.playback;
      return playback?.poll_sequence === sequence && playback.item?.artwork?.url === url
        && playback.roomBinding?.nativeRoomId === 'native-room';
    }, {sequence: refreshed.sequence, url: coverUrl}, 8000, 'same-cover-owner-refresh');
    assert.deepEqual(await cover.evaluate(image => ({sameNode: window.a8Cover.image === image,
      source: image.currentSrc, width: image.naturalWidth, mutations: window.a8Cover.mutations,
      visible: image.checkVisibility({visibilityProperty: true, opacityProperty: true})})),
    {sameNode: true, source: coverUrl, width: 64, mutations: [], visible: true});
    assert.deepEqual((await ownerState()).writes, []);
    assert.deepEqual(actionPosts, []);

    const toggle = page.locator('#play-pause');
    for (const [effect, playbackState] of [['pause', 'paused'], ['resume', 'playing']]) {
      await toggle.tap();
      await shownWithin(page, expected => {
        const player = document.querySelector('pv-widget-host')?.liveMedia?.playback;
        const button = document.querySelector('#play-pause');
        const label = button?.getAttribute('aria-label') || '';
        return player?.state === expected && player.roomBinding?.nativeRoomId === 'native-room'
          && button && !button.disabled && (expected === 'paused' ? /Fortsæt/.test(label) : /pause/i.test(label));
      }, playbackState, 8000, `touch-${effect}-external-session`);
      const observed = await ownerState();
      assert.equal(observed.state, playbackState);
      assert.equal(observed.song, 7);
      assert.equal(observed.room, 'native-room');
      assert.deepEqual(observed.writes.map(row => row.action), effect === 'pause' ? ['pause'] : ['pause', 'resume']);
    }
    assert.deepEqual(actionPosts, ['pause', 'resume']);
    const coverProof = {outcome: 'PASS', story: 'A8', bundleSHA, decodedCover,
      ownerSequences: [started.sequence, refreshed.sequence], retainedCoverThroughRefresh: true,
      localStarts: 0, actions: actionPosts.slice(), inertFinalService: true};
    await fs.writeFile(path.join(testEnv.artifactDir(), 'podview-music-push-cover-proof.json'),
      JSON.stringify(coverProof, null, 2));
    console.log(JSON.stringify(coverProof));

    if (process.env.MUSIC_PUSH_OVERLAP_TEST === '1') {
      let markHeld, releaseRead, markDelivered, armed = true;
      const held = new Promise(resolve => {markHeld = resolve;});
      const gate = new Promise(resolve => {releaseRead = resolve;});
      const delivered = new Promise(resolve => {markDelivered = resolve;});
      await page.route('**/view/api/music?**', async route => {
        if (!armed || new URL(route.request().url()).searchParams.get('kind') !== 'playback') return route.continue();
        armed = false;
        const response = await route.fetch();
        markHeld();
        await gate;
        await route.fulfill({response});
        markDelivered();
      });
      try {
        await Promise.race([held, sleep(10000).then(() => {throw Error('normal playback read not held');})]);
        const revision = await page.locator('pv-widget-host').evaluate(h => h.liveSnapshot.musicRevision);
        assert((await ownerState()).playbackEventSubscribers > 0, 'inert HA event subscription must exist');
        await lab({externalSong: 8});
        await page.waitForFunction(before => document.querySelector('pv-widget-host').liveSnapshot.musicRevision > before,
          revision, {timeout: 5000});
        await shownWithin(page, () => document.querySelector('#track-name')?.textContent === 'Isoleret sang 8',
          undefined, 1500, 'event-before-old-read-completes');
      } finally {releaseRead();}
      await delivered;
      await shownWithin(page, () => document.querySelector('#track-name')?.textContent === 'Isoleret sang 8',
        undefined, 1500, 'event-during-existing-read');
      console.log('PASS music event during older playback read: fresh title while older read is held; late response cannot roll back');
    }

    // Let the normal read settle so a lucky poll cannot pass for a push.
    await sleep(2500);

    const times = [];
    for (const song of [2, 3, 4]) {
      await lab({externalSong: song});
      times.push(await shownWithin(page,
        title => document.querySelector('#track-name')?.textContent?.trim() === title,
        `Isoleret sang ${song}`, 1500, `track-${song}`));
      await sleep(1200);
    }
    await lab({externalPlaybackState: 'paused'});
    times.push(await shownWithin(page,
      () => /Fortsæt/.test(document.getElementById('play-pause')?.getAttribute('aria-label') || ''),
      undefined, 1500, 'external-pause'));
    console.log(`PASS music push: injected HA changes shown in ${times.join(', ')} ms`);
    console.log('PASS external owner start on Kitchen: no local start, one touch Pause and one touch Resume');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
  }
})();
