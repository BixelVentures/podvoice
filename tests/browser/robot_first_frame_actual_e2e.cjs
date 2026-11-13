'use strict';
// Native feel (13 Nov): after startup the robot page shows its rooms and cleaning choices in the
// first frame after navigation (< 100 ms), with no network read on the critical path. Here every
// control setup read after startup takes 1.5 s; the page must not wait for it. A Start tapped
// before the current offer arrives is sent once on it.
const {chromium} = require('playwright');
const testEnv = require('./podview_actual_env.cjs');
const {spawn} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');

const port = Number(process.env.ROBOT_FIRST_FRAME_TEST_PORT || 18983);
const base = `http://127.0.0.1:${port}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const lab = body =>
  fetch(base + '/lab/state', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body || {}),
  }).then(r => r.json());

let server;
let browser;
(async () => {
  try {
    const data = await fs.mkdtemp(path.join(os.tmpdir(), 'podview-robot-first-frame-'));
    server = spawn(testEnv.python, [path.join(__dirname, 'music_e2e_server.py')], {
      cwd: testEnv.runtimeRoot,
      env: testEnv.pythonEnv({MUSIC_TEST_PORT: String(port), MUSIC_TEST_DATA: data, ROBOT_TEST: '1'}),
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
    await lab({robotState: 'docked', robotStateEvent: true});
    browser = await chromium.launch(testEnv.browserOptions());
    const page = await browser.newPage({hasTouch: true, viewport: {width: 1280, height: 800}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const setups = [];
    page.on('request', r => {
      if (new URL(r.url()).pathname === '/view/api/control/setup') setups.push(Date.now());
    });
    await page.goto(base + '/view/?room=kitchen', {waitUntil: 'domcontentloaded'});
    await testEnv.openOverview(page);
    const card = page.locator('.resource-preview[data-kind="vacuum"]:visible').first();
    await card.waitFor({timeout: 15000});
    // Startup: the screen prepares the robot page in the background.
    for (let n = 0; !setups.length; n++) {
      if (n > 150) throw new Error('the robot page was not prepared in the background after startup');
      await sleep(100);
    }
    await sleep(1000);
    // From now on every control setup read is slow, like Home Assistant on Green.
    await page.route('**/control/setup*', async route => {
      await sleep(1500);
      await route.continue();
    });
    const writes = (await lab()).robot.writes.length;
    await page.evaluate(() => {
      window.__shown = null;
      window.__tapped = null;
      window.__pageWithoutRooms = 0;
      // Measured from the tap itself (not from the test driver), as the user feels it.
      document.addEventListener('click', event => { window.__tapped ??= event.timeStamp; }, {capture: true});
      const sample = () => {
        const panel = document.querySelector('pv-robot-control-panel');
        const visible = node => !!node && node.offsetParent !== null;
        const page = document.querySelector('#device-view');
        const room = [...(panel?.querySelectorAll('button') || [])].find(b => b.textContent.trim() === 'Køkkenalrum');
        const choices = [...(panel?.querySelectorAll('h2') || [])]
          .find(h => h.textContent.trim() === 'Rengøringsvalg');
        if (visible(room) && visible(choices)) {
          window.__shown = performance.now();
          return;
        }
        // The robot page is on screen without its rooms: content that loads in.
        if (page && !page.hidden && page.offsetParent !== null) window.__pageWithoutRooms++;
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const before = setups.length;
    await card.tap();
    await page.waitForFunction(() => window.__shown !== null, null, {timeout: 5000}).catch(() => {});
    const [shown, tapped] = await page.evaluate(() => [window.__shown, window.__tapped]);
    const firstFrameMs = shown === null || tapped === null ? null : Math.round(shown - tapped);
    if (shown === null || firstFrameMs >= 100) {
      await page.screenshot({path: path.join(testEnv.artifactDir(), 'podview-robot-first-frame-fail.png')});
    }
    assert(shown !== null && firstFrameMs < 100,
      `rooms and cleaning choices in the first frame after navigation: ${firstFrameMs} ms`);
    assert.equal(await page.evaluate(() => window.__pageWithoutRooms), 0,
      'no frame shows the robot page before its rooms and choices');
    assert(setups.length >= before, 'the page may ask for a current offer, but never waits for it');
    // Choosing a room and tapping Start before the current offer arrives starts the robot once.
    const panel = page.locator('pv-robot-control-panel');
    const room = panel.getByRole('button', {name: 'Køkkenalrum', exact: true});
    if (await room.getAttribute('aria-pressed') !== 'true') await room.tap();
    await panel.locator('button').filter({hasText: /^Start/}).first().tap();
    const started = () => lab().then(state => state.robot.writes.slice(writes)
      .filter(([url]) => url.endsWith('send_command') || url.endsWith('/start')).length);
    for (let n = 0; n < 150 && await started() === 0; n++) await sleep(100);
    await sleep(1500);
    assert.equal(await started(), 1, 'the early Start is sent once');
    assert.deepEqual(errors, []);
    console.log(`PASS robot first frame: rooms and choices after ${firstFrameMs} ms`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
  }
})();
