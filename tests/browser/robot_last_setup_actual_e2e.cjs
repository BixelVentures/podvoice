'use strict';
// The robot page always shows the last chosen rooms and settings at once (Green 13 Nov 11:45:
// "Dine tidligere valg kunne ikke genskabes" after an add-on restart and an expired offer).
// Choose rooms and suction → PodVoice restarts (new boot, every server offer gone) → open the robot
// page → the same choices are shown, without that text, and Start starts exactly them.
const {chromium} = require('playwright');
const testEnv = require('./podview_actual_env.cjs');
const {spawn} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');

const port = Number(process.env.ROBOT_LAST_SETUP_TEST_PORT || 18987);
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
async function startServer(data) {
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
    if (n > 150) throw new Error('server start timeout');
    await sleep(100);
  }
  await lab({robotState: 'docked', robotStateEvent: true});
}
async function stopServer() {
  const done = new Promise(resolve => server.once('exit', resolve));
  server.kill('SIGTERM');
  await done;
}

(async () => {
  try {
    const data = await fs.mkdtemp(path.join(os.tmpdir(), 'podview-robot-last-setup-'));
    await startServer(data);
    browser = await chromium.launch(testEnv.browserOptions());
    const page = await browser.newPage({hasTouch: true, viewport: {width: 1180, height: 820}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/view/?room=kitchen', {waitUntil: 'domcontentloaded'});
    await testEnv.openOverview(page);
    const card = page.locator('.resource-preview[data-kind="vacuum"]:visible').first();
    const panel = page.locator('pv-robot-control-panel');
    const kitchen = panel.getByRole('button', {name: 'Køkkenalrum', exact: true});
    const dining = panel.getByRole('button', {name: 'Spisestue', exact: true});
    const max = panel.locator('[data-setting-concept=suction]').getByRole('radio', {name: 'Maks.', exact: true});
    const openRobot = async () => {
      await card.waitFor({timeout: 15000});
      await card.tap();
      await dining.waitFor({state: 'visible', timeout: 15000});
    };
    await openRobot();
    await page.waitForFunction(() => !!document.querySelector('pv-widget-host')?.liveControls?.task,
      null, {timeout: 15000});
    // The user's choice: only Spisestue, Maks. suction.
    if (await dining.getAttribute('aria-pressed') !== 'true') await dining.tap();
    if (await kitchen.getAttribute('aria-pressed') === 'true') await kitchen.tap();
    await max.evaluate(input => input.closest('label')?.click() ?? input.click());
    await sleep(800);
    assert.equal(await dining.getAttribute('aria-pressed'), 'true');
    assert.equal(await kitchen.getAttribute('aria-pressed'), 'false');
    await page.locator('#header-title-action').tap();
    await card.waitFor({timeout: 15000});

    // PodVoice restarts: a new boot, no server-side offer or draft source survives.
    const boot = await page.locator('pv-widget-host').evaluate(h => h.liveSnapshot?.bootId);
    await stopServer();
    await startServer(data);
    await page.waitForFunction(old => {
      const h = document.querySelector('pv-widget-host');
      return h?.liveTransport?.connected && h.liveSnapshot?.bootId && h.liveSnapshot.bootId !== old;
    }, boot, {timeout: 60000});
    await sleep(2500);

    await openRobot();
    await page.waitForFunction(() => !!document.querySelector('pv-widget-host')?.liveControls?.task,
      null, {timeout: 15000});
    await sleep(1000);
    const text = await panel.innerText();
    assert.doesNotMatch(text, /kunne ikke genskabes/, 'the last setup is restored, not refused');
    assert.equal(await dining.getAttribute('aria-pressed'), 'true', 'the chosen room is shown again');
    assert.equal(await kitchen.getAttribute('aria-pressed'), 'false', 'an unchosen room stays unchosen');
    assert.equal(await max.isChecked(), true, 'the chosen suction is shown again');

    // Start starts exactly the restored choices, once.
    const writes = (await lab()).robot.writes.length;
    await panel.locator('button').filter({hasText: /^Start/}).first().tap();
    const sent = async () => (await lab()).robot.writes.slice(writes);
    for (let n = 0; n < 150 && !(await sent()).some(([url]) => url.endsWith('send_command')); n++) await sleep(100);
    await sleep(800);
    const after = await sent();
    assert.equal(after.filter(([url]) => url.endsWith('send_command')).length, 1, 'Start is sent once');
    assert(after.some(([url, body]) => url.endsWith('set_fan_speed') && body.fan_speed === 'max'),
      `Maks. is applied: ${JSON.stringify(after)}`);
    assert.deepEqual(errors, []);
    console.log('PASS robot last setup: restored after restart and started once');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
  }
})();
