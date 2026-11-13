'use strict';
// Robot detail opens without a disabled flash (testnoter 13 Nov, fejl 1; AGENTS: knapper låses aldrig).
// Every robot button seen while the page opens and fetches status must stay enabled, also on reopen.
const {chromium} = require('playwright');
const testEnv = require('./podview_actual_env.cjs');
const {spawn} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');

const port = Number(process.env.ROBOT_OPEN_TEST_PORT || 18977);
const base = `http://127.0.0.1:${port}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const lab = body =>
  fetch(base + '/lab/state', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body || {}),
  }).then(r => r.json());
const shot = (page, name) =>
  page.screenshot({path: path.join(testEnv.artifactDir(), `podview-robot-open-${name}.png`)});

// Samples every frame: a visible robot command button that is disabled while the robot is live.
async function watchGrey(page) {
  await page.evaluate(() => {
    window.__grey = [];
    const sample = () => {
      for (const button of document.querySelectorAll('pv-robot-control-panel :is(button,input)')) {
        const id = button.dataset.actionId || button.name || button.id || button.textContent.trim();
        // Pause/resume follow the robot's own state; only commands the robot accepts now count.
        if (['pause', 'resume'].includes(id) || button.offsetParent === null) continue;
        if (button.disabled && !window.__grey.includes(id)) window.__grey.push(id);
      }
      // Last-known content is shown as it is, never marked busy while a fresh offer is fetched.
      for (const busy of document.querySelectorAll('#device-view [aria-busy="true"]')) {
        if (busy.offsetParent === null || busy.dataset.controlOptionId) continue;
        const key = 'busy:' + (busy.id || busy.className || busy.tagName);
        if (!window.__grey.includes(key)) window.__grey.push(key);
      }
      window.__greyRaf = requestAnimationFrame(sample);
    };
    sample();
  });
}

let server;
let browser;
(async () => {
  try {
    const data = await fs.mkdtemp(path.join(os.tmpdir(), 'podview-robot-open-'));
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
    browser = await chromium.launch(testEnv.browserOptions());
    const page = await browser.newPage({hasTouch: true, viewport: {width: 1280, height: 800}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/view/?room=kitchen', {waitUntil: 'domcontentloaded'});
    await testEnv.openOverview(page);
    const card = '.resource-card[data-kind="vacuum"] .resource-direct-action';
    await page.locator(`${card}[data-action-id="pause"]`).waitFor({state: 'visible', timeout: 15000});
    // The screen prepares the robot page in the background shortly after it shows the overview.
    await sleep(3000);

    // Green's Home Assistant answers a control setup in about a second, not instantly.
    await page.route('**/control/setup*', async route => {
      await sleep(1500);
      await route.continue();
    });
    const detail = 'pv-robot-control-panel button[data-action-id]';
    for (const round of ['first open', 'reopen', 'reopen later']) {
      if (round === 'reopen later') {
        // Opened again after the server's control offer has run out (a normal later visit).
        const expiresAt = await page.locator('pv-widget-host').evaluate(h => h.liveControls.task?.expiresAt ?? 0);
        await sleep(Math.min(150000, Math.max(0, expiresAt * 1000 - Date.now()) + 1000));
      }
      await watchGrey(page);
      const writes = (await lab()).robot.writes.length;
      await page.locator('.resource-preview[data-kind="vacuum"]:visible').first().tap();
      await page.locator(`${detail}[data-action-id="stop"]`).waitFor({state: 'visible', timeout: 15000});
      const readGrey = () => page.evaluate(() => {
        cancelAnimationFrame(window.__greyRaf);
        return window.__grey;
      });
      let grey = null;
      if (round === 'reopen later') {
        await sleep(300);
        assert.equal(await page.evaluate(() => !!document.querySelector('pv-widget-host').liveControls.task), false,
          'the fresh offer is still being fetched');
        grey = await readGrey();
        // A setting tapped while the fresh offer is fetched waits for it and is sent exactly once.
        const choice = page.locator('pv-robot-control-panel fieldset.robot-level-setting input:not(:checked)').first();
        await choice.evaluate(input => input.closest('label')?.click() ?? input.click());
        await page.waitForFunction(() => !!document.querySelector('pv-widget-host')?.liveControls?.task,
          null, {timeout: 15000});
        for (let n = 0; n < 50 && (await lab()).robot.writes.length === writes; n++) await sleep(100);
        await sleep(1500);
        assert.equal((await lab()).robot.writes.length, writes + 1, 'the tap made while fetching was sent once');
      }
      // Status and the control offer arrive after the page is shown; give them time to land.
      await page.waitForFunction(() => !!document.querySelector('pv-widget-host')?.liveControls?.task,
        null, {timeout: 15000});
      await sleep(2500);
      grey ??= await readGrey();
      if (grey.length) await shot(page, `grey-${round.replace(' ', '-')}`);
      assert.deepEqual(grey, [], `${round}: robot buttons were greyed out while status was fetched`);
      await page.locator('#header-title-action').tap();
      await page.locator(`${card}[data-action-id="pause"]`).waitFor({state: 'visible', timeout: 15000});
    }
    assert.deepEqual(errors, []);
    console.log('PASS robot open: no disabled flash on first open or reopen');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
  }
})();
