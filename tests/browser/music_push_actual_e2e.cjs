'use strict';
// User story A6 (docs/BRUGERHISTORIER.md): a change made in another app (Spotify on a phone)
// shows on the screen within 1.5 s, pushed from Home Assistant instead of waiting for a poll.
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
      env: testEnv.pythonEnv({MUSIC_TEST_PORT: String(port), MUSIC_TEST_DATA: data}),
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
    browser = await chromium.launch(testEnv.browserOptions());
    const page = await browser.newPage({hasTouch: true, viewport: {width: 1280, height: 800}});
    await page.goto(base + '/view/?room=kitchen', {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => document.querySelector('#track-name')?.textContent?.trim() === 'Isoleret sang 1',
      undefined, {timeout: 15000});
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
    console.log(`PASS music push: external changes shown in ${times.join(', ')} ms`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
  }
})();
