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

const port = Number(process.env.MUSIC_PUSH_TEST_PORT || 18977);
const base = `http://127.0.0.1:${port}`;
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
    server = spawn(testEnv.python, [path.join(__dirname, 'music_e2e_server.py')], {
      cwd: testEnv.runtimeRoot,
      env: testEnv.pythonEnv({MUSIC_TEST_PORT: String(port), MUSIC_TEST_DATA: data, MUSIC_EXTENDED: '1'}),
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
    await lab({externalPlaybackState: 'paused'});
    browser = await chromium.launch(testEnv.browserOptions());
    const page = await browser.newPage({hasTouch: true, viewport: {width: 1280, height: 800}});
    await page.goto(base + '/view/?room=kitchen', {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => document.querySelector('#track-name')?.textContent?.trim() === 'Isoleret sang 1',
      undefined, {timeout: 15000});
    await testEnv.openOverview(page);

    // A cold PodView has never started playback. The inert Spotify owner starts a new song.
    assert.deepEqual((await ownerState()).writes, []);
    await lab({externalSong: 7, externalPlaybackState: 'playing'});
    await shownWithin(page, () => {
      const title = document.querySelector('#track-name')?.textContent?.trim();
      const output = document.querySelector('#output');
      const button = document.querySelector('#play-pause');
      return title === 'Isoleret sang 7' && output?.textContent.includes('Køkkenalrum HomePod')
        && output?.getAttribute('aria-label')?.includes('Aktuelt output')
        && button && !button.disabled && /pause/i.test(button.getAttribute('aria-label') || '');
    }, undefined, 8000, 'external-start-on-kitchen');
    assert.deepEqual((await ownerState()).writes, [], 'external playback must not send a local effect');

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
