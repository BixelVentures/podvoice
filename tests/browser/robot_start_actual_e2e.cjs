'use strict';
// Robot start (testnoter 13 Nov, fejl 15): tap Start → "Starter …" at once, in plain words; the form
// stays as it was (nothing greys out) until the robot reports a job; then one switch to the job's
// controls, never a frame that mixes the start form with Pause/Afslut. Start is sent once.
const {chromium} = require('playwright');
const testEnv = require('./podview_actual_env.cjs');
const {spawn} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');

const port = Number(process.env.ROBOT_START_TEST_PORT || 18979);
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
    const data = await fs.mkdtemp(path.join(os.tmpdir(), 'podview-robot-start-'));
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
    await page.goto(base + '/view/?room=kitchen', {waitUntil: 'domcontentloaded'});
    await testEnv.openOverview(page);
    await page.locator('.resource-preview[data-kind="vacuum"]:visible').first().tap();
    const panel = page.locator('pv-robot-control-panel');
    await page.waitForFunction(() => !!document.querySelector('pv-widget-host')?.liveControls?.task,
      null, {timeout: 15000});
    const room = panel.getByRole('button', {name: 'Køkkenalrum', exact: true});
    await room.waitFor({timeout: 15000});
    if (await room.getAttribute('aria-pressed') !== 'true') await room.tap();
    await lab({robotEffectDelayMs: 800});
    // Every frame: visible robot buttons (with disabled marks) and the panel's status line.
    await page.evaluate(() => {
      window.__frames = [];
      let last = '';
      const sample = () => {
        const p = document.querySelector('pv-robot-control-panel');
        const buttons = [...(p?.querySelectorAll('button') || [])].filter(b => b.offsetParent)
          .map(b => (b.innerText || b.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ') +
            (b.disabled ? '[D]' : ''));
        const status = [...(p?.querySelectorAll('.robot-settings-context,[role=status]') || [])]
          .filter(n => n.offsetParent).map(n => n.textContent.trim()).filter(Boolean).join(' | ');
        const key = JSON.stringify([buttons, status]);
        if (key !== last) {
          last = key;
          window.__frames.push({at: performance.now(), buttons, status});
        }
        window.__raf = requestAnimationFrame(sample);
      };
      sample();
    });
    const tapped = await page.evaluate(() => performance.now());
    await panel.locator('button').filter({hasText: /^Start/}).first().tap();
    for (let n = 0; !(await lab()).robot.writes.some(w => w[0].endsWith('send_command')); n++) {
      if (n > 150) throw new Error('Start never reached the robot');
      await sleep(100);
    }
    await sleep(1500);
    // The robot reports its job.
    await lab({robotState: 'cleaning', robotStateEvent: true});
    await panel.getByRole('button', {name: 'Pause', exact: true}).waitFor({timeout: 10000});
    await sleep(800);
    const frames = await page.evaluate(() => {
      cancelAnimationFrame(window.__raf);
      return window.__frames;
    });
    const log = JSON.stringify(frames.map(f => [Math.round(f.at), f.buttons.join(', '), f.status]));
    const starting = frames.find(f => f.at >= tapped && f.status.includes('Starter …'));
    assert(starting && starting.at - tapped < 300, `"Starter …" within 300 ms of the tap: ${log}`);
    assert(!frames.some(f => /Anmodning|modtaget/.test(f.status)), `no technical receipt text: ${log}`);
    const before = frames.filter(f => f.at >= tapped && !f.buttons.includes('Pause'));
    assert(!before.some(f => f.buttons.some(b => /^(Køkkenalrum|Spisestue|Vælg alle rum)\[D\]$/.test(b))),
      `the start form never greys out while starting: ${log}`);
    assert(!frames.some(f => f.buttons.includes('Pause') && f.buttons.some(b => b.startsWith('Start'))),
      `no frame mixes the start form with the job controls: ${log}`);
    const jobFrames = frames.filter(f => f.buttons.includes('Pause'));
    assert(jobFrames.length && jobFrames.every(f => f.buttons.includes('Afslut rengøring')), log);
    assert.equal((await lab()).robot.writes.filter(w => w[0].endsWith('send_command')).length, 1,
      'Start is sent once');
    assert.deepEqual(errors, []);
    console.log(`PASS robot start: "Starter …" after ${Math.round(starting.at - tapped)} ms, ${frames.length} frames`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
  }
})();
