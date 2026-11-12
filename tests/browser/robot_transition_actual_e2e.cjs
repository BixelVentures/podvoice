'use strict';
// Robot story S3 (docs/BRUGERHISTORIER.md) in the detail view: after Pause or Fortsæt the
// primary slot keeps its place with a stable label and a pending mark until HA confirms.
// The real Roborock passes through other HA states on the way (idle, unknown, returning);
// those must not remove the primary, shift the other buttons or empty the row.
const {chromium} = require('playwright');
const testEnv = require('./podview_actual_env.cjs');
const {spawn} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');

const port = Number(process.env.ROBOT_TRANSITION_TEST_PORT || 18977);
const base = `http://127.0.0.1:${port}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const lab = body =>
  fetch(base + '/lab/state', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body || {}),
  }).then(r => r.json());
const shot = (page, name) =>
  page.screenshot({path: path.join(testEnv.artifactDir(), `podview-robot-transition-${name}.png`)});
const row = 'pv-robot-control-panel .pv-actions.transport';
const detail = 'pv-robot-control-panel [data-direct-robot="true"]';
// PodView's own names for the HA vacuum states it receives.
const viewStatus = {idle: 'stopped', returning: 'docking', error: 'fault'};

// Records every distinct state of the action row: labels in order, disabled and busy flags.
async function recordRow(page) {
  await page.evaluate(selector => {
    window.__rows = [];
    const read = () => {
      const node = document.querySelector(selector);
      if (!node) return {missing: true, labels: []};
      const buttons = [...node.children].map(child =>
        child.tagName === 'BUTTON' ? child : child.querySelector('button'));
      return {
        labels: buttons.map(button => button?.textContent.trim() || ''),
        disabled: buttons.map(button => !!button?.disabled),
        busy: buttons.map(button => button?.getAttribute('aria-busy') === 'true'),
      };
    };
    let last = '';
    const record = () => {
      const value = read(), key = JSON.stringify(value);
      if (key === last) return;
      last = key;
      window.__rows.push({at: performance.now(), status: document.querySelector('pv-widget-host')
        ?.state?.devices?.find(d => d.kind === 'vacuum')?.status, ...value});
    };
    record();
    new MutationObserver(record).observe(document.body,
      {childList: true, subtree: true, attributes: true, characterData: true});
  }, row);
}

const currentRow = page => page.evaluate(() => window.__rows.at(-1));

// HA reports `state`; PodView reads it like any later observation and applies it.
async function haReports(page, state) {
  await lab({robotState: state, robotStateEvent: true});
  const wanted = viewStatus[state] || state;
  for (let n = 0; n < 60; n++) {
    const status = await page.locator('pv-widget-host').evaluate(h => {
      void h.loadLiveHome?.();
      return h.state.devices.find(d => d.kind === 'vacuum')?.status;
    });
    if (status === wanted) {
      await sleep(150);
      return;
    }
    await sleep(50);
  }
  throw new Error(`PodView never observed HA state ${state}`);
}

async function waitForWrite(service) {
  for (let n = 0; n < 50; n++) {
    if ((await lab()).robot.writes.some(([url]) => url.endsWith('/' + service))) return;
    await sleep(50);
  }
  throw new Error(`no ${service} reached HA`);
}

async function press(page, from, to, label) {
  const started = Date.now();
  await page.locator(`${detail}[data-action-id="${from}"]`).first().tap();
  await page.waitForFunction(([selector, wanted]) => {
    const first = document.querySelector(selector)?.firstElementChild;
    return first?.dataset.actionId === wanted && !first.disabled;
  }, [row, to], {timeout: 300}).catch(async () => {
    await shot(page, `fail-${label}`);
    throw new Error(`${label}: the primary slot did not show ${to} within 300 ms`);
  });
  return Date.now() - started;
}

let server;
let browser;
(async () => {
  try {
    const data = await fs.mkdtemp(path.join(os.tmpdir(), 'podview-robot-transition-'));
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
    await page.locator('.resource-preview[data-kind="vacuum"]:visible').first().tap();
    await page.locator(`${detail}[data-action-id="pause"]`).waitFor({state: 'visible', timeout: 15000});
    await sleep(300);

    // The robot accepts every call; HA's reported state is driven step by step below.
    await lab({robotEffectDelayMs: 100, robotIgnoreCommands: true});
    await recordRow(page);
    const start = await currentRow(page);
    assert.equal(start.labels[0], 'Pause', 'the running robot offers Pause first');
    assert.ok(start.labels.length >= 2, `the row has Pause and the other actions: ${start.labels}`);
    const rest = start.labels.slice(1);
    await shot(page, 'cleaning');

    const pauseMs = await press(page, 'pause', 'resume', 'pause');
    await waitForWrite('pause');
    const pending = [];
    const busy = async (wanted, why) => pending.push([(await currentRow(page)).busy[0], wanted, why]);
    await busy(true, 'Fortsæt shows pending until HA confirms the pause');
    for (const state of ['cleaning', 'idle', 'unknown', 'returning']) await haReports(page, state);
    await shot(page, 'pause-transition');
    await busy(true, 'still pending while HA has not confirmed');
    await haReports(page, 'paused');
    const paused = (await currentRow(page)).labels;
    await busy(false, 'confirmed pause ends the pending mark');
    await shot(page, 'paused');

    const resumeMs = await press(page, 'resume', 'pause', 'resume');
    await waitForWrite('start');
    for (const state of ['paused', 'idle', 'returning', 'unknown']) await haReports(page, state);
    await shot(page, 'resume-transition');
    await busy(true, 'Pause shows pending until HA confirms cleaning');
    await haReports(page, 'cleaning');
    const resumed = (await currentRow(page)).labels;
    await busy(false, 'confirmed cleaning ends the pending mark');

    const rows = await page.evaluate(() => window.__rows);
    await fs.writeFile(path.join(testEnv.artifactDir(), 'podview-robot-transition-rows.json'),
      JSON.stringify(rows, null, 1));
    for (const seen of rows) {
      const where = JSON.stringify(seen);
      assert.notEqual(seen.missing, true, `the action row never disappears: ${where}`);
      assert.ok(['Pause', 'Fortsæt'].includes(seen.labels[0]), `the primary stays in slot 1: ${where}`);
      assert.deepEqual(seen.labels.slice(1), rest, `the other buttons keep their order and count: ${where}`);
      assert.ok(seen.disabled.every(value => !value), `no button is greyed: ${where}`);
    }
    assert.deepEqual(paused, ['Fortsæt', ...rest], 'confirmed pause shows the same row');
    assert.deepEqual(resumed, ['Pause', ...rest], 'confirmed cleaning shows the same row');
    for (const [seen, wanted, why] of pending) assert.equal(seen, wanted, why);
    assert.deepEqual(errors, []);
    console.log(`PASS robot transition: pause ${pauseMs} ms, resume ${resumeMs} ms, ${rows.length} row states`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
  }
})();
