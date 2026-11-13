'use strict';
// Tesla with a polling Home Assistant (testnoter 13 Nov, fejl 11 and 12).
// Fejl 12: the climate was turned off in the Tesla app, HA still says on. Opening the Tesla
// page asks HA for a fresh read, and the screen shows the car's own state.
// Fejl 11: a climate command to a sleeping car shows one short status line, and the car's own
// answer after it woke confirms "Klimaet er tændt." instead of "Udfald ukendt".
const {chromium} = require('playwright');
const env = require('./podview_actual_env.cjs');
const {spawn} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');

const port = Number(process.env.VEHICLE_FRESH_TEST_PORT || 18982);
const base = `http://127.0.0.1:${port}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const lab = body =>
  fetch(base + '/lab/state', {
    method: body ? 'POST' : 'GET',
    headers: {'Content-Type': 'application/json'},
    ...(body ? {body: JSON.stringify(body)} : {}),
  }).then(r => r.json());
const climateOf = page => page.locator('pv-widget-host').evaluate(h => h.state?.vehicle?.climate?.status ?? null);
const climateIs = status => document.querySelector('pv-widget-host')?.state?.vehicle?.climate?.status === status;

let server;
let browser;
(async () => {
  try {
    const data = await fs.mkdtemp(path.join(os.tmpdir(), 'podview-vehicle-fresh-'));
    server = spawn(env.python, [path.join(__dirname, 'vehicle_e2e_server.py')], {
      cwd: env.runtimeRoot,
      env: env.pythonEnv({VEHICLE_TEST_PORT: String(port), VEHICLE_TEST_DATA: data, VEHICLE_POLL_LAG_TEST: '1'}),
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
    // The Tesla app turned the climate off; HA has not polled since and still says on.
    await lab({ha: {climate: 'heat_cool', connection: 'online'}, car: {climate: 'off', connection: 'online'}});
    browser = await chromium.launch(env.browserOptions());
    const page = await browser.newPage({hasTouch: true, viewport: {width: 1280, height: 800}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(7000);
    await page.goto(base + '/view/?room=kitchen', {waitUntil: 'domcontentloaded'});
    await env.openOverview(page);
    const card = page.locator('#home-vehicle');
    await card.waitFor({timeout: 15000});
    await page.waitForFunction(climateIs, 'heat_cool', {timeout: 15000});
    assert.deepEqual((await lab()).freshReads, [], 'the overview alone never asks the car');

    // Fejl 12: opening the Tesla page shows the car's own state.
    const opened = Date.now();
    await card.tap();
    await page.waitForFunction(climateIs, 'off', {timeout: 15000}).catch(async e => {
      throw new Error(`fejl 12: Tesla page still shows HA's old climate (${await climateOf(page)}): ${e.message}`);
    });
    const openMs = Date.now() - opened;
    const reads = (await lab()).freshReads;
    assert.equal(reads.length, 1, 'one fresh read when the page opens');
    assert.equal(reads[0].entityId, 'climate.car');

    // Fejl 11: the car sleeps; a climate command wakes it.
    await lab({ha: {connection: 'asleep'}, car: {connection: 'asleep'}});
    // The next HA read reports the sleep (PodVoice caches a home read for 5 s).
    for (let n = 0; ; n++) {
      await page.locator('pv-widget-host').evaluate(h => h.loadLiveHome());
      await sleep(500);
      const sleeping = await page.locator('pv-widget-host').evaluate(h => h.vehicleView?.model?.connectionState);
      if (sleeping === 'asleep') break;
      if (n > 30) throw new Error(`the car never showed as asleep: ${sleeping}`);
    }
    await lab({hold: true});
    const root = page.locator('#vehicle-view');
    await root.getByRole('switch', {name: 'Klima', exact: true}).tap();
    const dialog = page.locator('dialog.vehicle-confirmation');
    await dialog.getByRole('button', {name: 'Tænd klima', exact: true}).tap();
    for (let n = 0; !(await lab()).intentHeld; n++) {
      if (n > 100) throw new Error('climate command not held');
      await sleep(25);
    }
    const note = root.locator('[data-kit-variant=feedback]:visible');
    await note.filter({hasText: 'Vækker bilen…'}).waitFor({timeout: 3000});
    const lines = await note.evaluate(node => {
      const style = getComputedStyle(node);
      return Math.round(node.getBoundingClientRect().height / parseFloat(style.lineHeight));
    });
    await page.screenshot({path: path.join(env.artifactDir(), 'podview-vehicle-waking.png')});
    assert.equal(lines, 1, `fejl 11: the waking status uses ${lines} lines`);
    const toggle = root.getByRole('switch', {name: 'Klima', exact: true});
    assert.doesNotMatch(await toggle.innerText(), /Vækker|Sendt/, 'the switch shows progress, not the status text');
    assert.equal(await toggle.getAttribute('aria-busy'), 'true');
    const sent = Date.now();
    await lab({release: true});
    const seen = [];
    for (let n = 0; ; n++) {
      const text = (await note.allInnerTexts()).join(' ');
      if (text && !seen.includes(text)) seen.push(text);
      if (/Klimaet er tændt\./.test(text)) break;
      assert.doesNotMatch(text, /Udfald ukendt/, `fejl 11: ${JSON.stringify(seen)}`);
      if (n > 300) throw new Error(`fejl 11: no confirmation from the car: ${JSON.stringify(seen)}`);
      await sleep(100);
    }
    const confirmMs = Date.now() - sent;
    assert.equal(await climateOf(page), 'heat_cool');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({outcome: 'PASS', story: 'Tesla fresh read', openMs, confirmMs, seen}));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
  }
})();
