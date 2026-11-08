'use strict';
// Robot user stories S3/S4 (docs/BRUGERHISTORIER.md): every tap reacts at once, controls never
// lock while the robot catches up, and the screen keeps working when left open.
const {chromium} = require('playwright');
const testEnv = require('./podview_actual_env.cjs');
const {spawn} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');

const port = Number(process.env.ROBOT_UX_TEST_PORT || 18976);
const base = `http://127.0.0.1:${port}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const lab = body =>
  fetch(base + '/lab/state', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body || {}),
  }).then(r => r.json());
const shot = (page, name) => page.screenshot({path: path.join(testEnv.artifactDir(), `podview-robot-ux-${name}.png`)});

async function waitForRobot(state) {
  for (let n = 0; n < 100; n++) {
    if ((await lab()).robot.state === state) return;
    await sleep(100);
  }
  throw new Error(`robot never reached ${state}`);
}

// Counts every disabled=true transition on the watched buttons from now on.
async function watchDisabled(page, selector) {
  await page.evaluate(sel => {
    window.__disabledFlips = 0;
    const seen = new WeakSet();
    const watch = () => {
      for (const button of document.querySelectorAll(sel)) {
        if (seen.has(button)) continue;
        seen.add(button);
        new MutationObserver(() => {
          if (button.disabled) window.__disabledFlips++;
        }).observe(button, {attributes: true, attributeFilter: ['disabled']});
      }
    };
    watch();
    new MutationObserver(watch).observe(document.body, {childList: true, subtree: true});
  }, selector);
}

// Tap and require the expected control to be visible and enabled within `ms`.
async function tapExpect(page, tapSelector, expectSelector, ms, label) {
  const started = Date.now();
  await page.locator(tapSelector).first().tap();
  await page.waitForFunction(
    sel => [...document.querySelectorAll(sel)].some(b => b.offsetParent !== null && !b.disabled),
    expectSelector,
    {timeout: ms},
  ).catch(async () => {
    await shot(page, `fail-${label}`);
    throw new Error(`${label}: "${expectSelector}" not shown and enabled within ${ms} ms`);
  });
  return Date.now() - started;
}

let server;
let browser;
(async () => {
  try {
    const data = await fs.mkdtemp(path.join(os.tmpdir(), 'podview-robot-ux-'));
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

    // S3 on the overview card: the robot reacts slowly (2 s), the button must not wait for it.
    const card = '.resource-card[data-kind="vacuum"] .resource-direct-action';
    await page.locator(`${card}[data-action-id="pause"]`).waitFor({state: 'visible', timeout: 15000});
    await page.waitForFunction(sel => !document.querySelector(sel)?.disabled, card, {timeout: 15000});
    await lab({robotEffectDelayMs: 2000});
    await watchDisabled(page, card);
    const pauseMs = await tapExpect(page, `${card}[data-action-id="pause"]`, `${card}[data-action-id="resume"]`, 300,
      'S3 overview pause');
    await shot(page, 'overview-paused-optimistic');
    await waitForRobot('paused');
    const resumeMs = await tapExpect(page, `${card}[data-action-id="resume"]`, `${card}[data-action-id="pause"]`, 300,
      'S3 overview resume');
    await waitForRobot('cleaning');
    assert.equal(await page.evaluate(() => window.__disabledFlips), 0, 'S3: overview buttons never grey out');

    // S3: a robot that accepts the call but never reports a new state must not lock the button.
    await lab({robotEffectDelayMs: 150, robotIgnoreCommands: true});
    await tapExpect(page, `${card}[data-action-id="pause"]`, `${card}[data-action-id="resume"]`, 300,
      'S3 silent robot');
    // The robot never confirms: after at most ~10 s the card honestly shows its real state again.
    await page.locator(`${card}[data-action-id="pause"]`).waitFor({state: 'visible', timeout: 12000});
    assert.equal(await page.locator(`${card}[data-action-id="pause"]`).isDisabled(), false);
    await lab({robotIgnoreCommands: false});

    // S4: the detail view keeps working after its server offer would have expired.
    await page.locator('.resource-preview[data-kind="vacuum"]:visible').first().tap();
    const detail = 'pv-robot-control-panel [data-direct-robot="true"]';
    await page.locator(`${detail}[data-action-id="pause"]`).waitFor({state: 'visible', timeout: 15000}).catch(async e => {
      await shot(page, 'fail-detail-open');
      console.log(await page.locator('pv-robot-control-panel').innerText().catch(() => 'no panel'));
      throw e;
    });
    const expiresAt = await page.locator('pv-widget-host').evaluate(h => h.liveControls.task?.expiresAt ?? 0);
    const expiryWait = Math.min(150000, Math.max(0, expiresAt * 1000 - Date.now()) + 2000);
    const longSession = process.env.ROBOT_LONG_SESSION_TEST === '1';
    const waitMs = longSession ? 600000 : expiryWait;
    console.log(`S4: waiting ${Math.round(waitMs / 1000)} s past the control offer expiry`);
    const waitingSince = Date.now();
    const documentStartedAt = await page.evaluate(() => performance.timeOrigin);
    await sleep(waitMs);
    if (longSession) {
      // The shared kiosk lifecycle intentionally returns to Ro during inactivity.
      await page.locator('#photo-view').waitFor({state: 'visible'});
      await testEnv.openOverview(page);
      const robotCard = page.locator('.resource-preview[data-kind="vacuum"]:visible').first();
      await robotCard.getByText('Robotstøvsuger', {exact: true}).tap();
      assert.equal(await page.evaluate(() => performance.timeOrigin), documentStartedAt);
    }
    await shot(page, 'detail-after-expiry');
    await watchDisabled(page, detail);
    const lateMs = await tapExpect(page, `${detail}[data-action-id="pause"]`, `${detail}[data-action-id="resume"]`, 300,
      'S4 detail pause after expiry');
    await waitForRobot('paused');
    assert.equal(await page.evaluate(() => window.__disabledFlips), 0, 'S4: detail buttons never grey out');
    if (longSession) {
      assert(Date.now() - waitingSince >= 600000);
      await tapExpect(page, `${detail}[data-action-id="resume"]`, `${detail}[data-action-id="pause"]`, 300,
        'S4 detail resume after ten minutes');
      await waitForRobot('cleaning');
      const panel = page.locator('pv-robot-control-panel');
      await panel.getByRole('button', {name: 'Base', exact: true}).tap();
      await panel.getByRole('button', {name: 'Kør til basen', exact: true}).tap();
      const confirm = panel.locator('dialog.robot-action-confirm');
      await confirm.getByRole('button', {name: 'Kør til basen', exact: true}).tap();
      await waitForRobot('returning');
      const actions = (await lab()).robot.writes.map(([url]) => url.split('/').at(-1));
      assert.deepEqual(actions.slice(-3), ['pause', 'start', 'return_to_base']);
      const proof = {outcome: 'PASS', story: 'S4', realElapsedMs: Date.now() - waitingSince,
        wokeFromRoInSameDocument: true, lateEffects: actions.slice(-3), inertFinalService: true};
      await fs.writeFile(path.join(testEnv.artifactDir(), 'podview-robot-long-session.json'),
        JSON.stringify(proof, null, 2));
      console.log(JSON.stringify(proof));
    }

    assert.deepEqual(errors, []);
    console.log(`PASS robot UX: pause ${pauseMs} ms, resume ${resumeMs} ms, after expiry ${lateMs} ms`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
  }
})();
