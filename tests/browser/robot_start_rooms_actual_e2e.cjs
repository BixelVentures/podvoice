'use strict';
// Green 16 Nov (2.1.11): the dock reported a full dirty-water tank, no room was preselected and the robot
// page showed a black, locked »Start rengøring«. Now:
// 1. Without a known setup the main button is a live »Vælg rum«; it starts nothing and leads to the rooms.
// 2. After one accepted Start, a fresh screen (no stored choices) preselects that start's rooms, also while
//    the dock reports a full dirty-water tank, and Start is ready. HA decides whether the robot runs.
const {chromium} = require('playwright');
const testEnv = require('./podview_actual_env.cjs');
const {spawn} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');

const port = Number(process.env.ROBOT_START_ROOMS_TEST_PORT || 18988);
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

async function openRobotPage(page) {
  await page.goto(base + '/view/?room=kitchen', {waitUntil: 'domcontentloaded'});
  await testEnv.openOverview(page);
  const card = page.locator('.resource-preview[data-kind="vacuum"]:visible').first();
  await card.waitFor({timeout: 15000});
  await card.tap();
  const panel = page.locator('pv-robot-control-panel');
  await panel.getByRole('button', {name: 'Spisestue', exact: true}).waitFor({state: 'visible', timeout: 15000});
  await page.waitForFunction(() => !!document.querySelector('pv-widget-host')?.liveControls?.task,
    null, {timeout: 15000});
  await sleep(1500);
  return panel;
}

(async () => {
  try {
    const data = await fs.mkdtemp(path.join(os.tmpdir(), 'podview-robot-start-rooms-'));
    server = spawn(testEnv.python, [path.join(__dirname, 'music_e2e_server.py')], {
      cwd: testEnv.runtimeRoot,
      env: testEnv.pythonEnv({MUSIC_TEST_PORT: String(port), MUSIC_TEST_DATA: data, ROBOT_TEST: '1',
        ROBOT_OBSERVATION_TEST: '1'}),
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
    browser = await chromium.launch(testEnv.browserOptions());
    const errors = [];
    const fresh = async () => {
      const context = await browser.newContext({hasTouch: true, viewport: {width: 1180, height: 820}});
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      return page;
    };
    const sends = async from => (await lab()).robot.writes.slice(from)
      .filter(([url]) => url.endsWith('send_command'));

    // 1. No stored choice and no accepted start: »Vælg rum« is live and starts nothing.
    let page = await fresh();
    let panel = await openRobotPage(page);
    const choose = panel.locator('button.start');
    assert.equal(await choose.count(), 1);
    assert.match(await choose.innerText(), /^Vælg rum$/);
    assert.equal(await choose.isDisabled(), false, 'the main button is not locked');
    let writes = (await lab()).robot.writes.length;
    await choose.tap();
    await sleep(800);
    assert.deepEqual(await sends(writes), [], '»Vælg rum« sends nothing');
    const focused = await page.evaluate(() => {
      const host = document.querySelector('pv-widget-host');
      const active = host?.shadowRoot?.activeElement || document.activeElement;
      return active?.closest?.('fieldset')?.className || '';
    });
    assert.match(focused, /choices/, 'the room picker gets focus');

    // One ordinary accepted Start in Spisestue, then the robot is back in its dock.
    const dining = panel.getByRole('button', {name: 'Spisestue', exact: true});
    await dining.tap();
    await sleep(300);
    assert.match(await choose.innerText(), /^Start i Spisestue$/);
    writes = (await lab()).robot.writes.length;
    await choose.tap();
    for (let n = 0; n < 150 && !(await sends(writes)).length; n++) await sleep(100);
    assert.equal((await sends(writes)).length, 1, 'Start is sent once');
    await page.context().close();
    await sleep(1000);
    await lab({robotState: 'docked', robotStateEvent: true,
      robotTelemetry: {dock_error: 'waste_water_tank_full'}});
    await sleep(1500);

    // 2. A fresh screen without stored choices shows the last accepted start, ready to start.
    page = await fresh();
    panel = await openRobotPage(page);
    const history = await page.evaluate(() => document.querySelector('pv-widget-host')?.state?.devices
      ?.find(d => d.kind === 'vacuum')?.history?.status);
    assert.equal(history, 'observed', 'the accepted start is in the robot history');
    assert.match(await panel.innerText(), /Snavset vandbeholder er fuld/, 'the dock report is shown');
    const start = panel.locator('button.start');
    assert.equal(await panel.getByRole('button', {name: 'Spisestue', exact: true}).getAttribute('aria-pressed'),
      'true', 'the last accepted rooms are preselected');
    assert.match(await start.innerText(), /^Start i Spisestue$/);
    assert.equal(await start.isDisabled(), false, 'Start is ready');
    assert.deepEqual(errors, []);
    console.log('PASS robot start rooms: live »Vælg rum«, last accepted start preselected on a fresh screen');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
  }
})();
