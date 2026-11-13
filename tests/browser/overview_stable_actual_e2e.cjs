'use strict';
// Native feel (iPad 13 Nov ~11:50: the robot and weather cards blinked once on a background update).
// Overview cards never blink or rebuild: unchanged data and a quick background reconnect change
// nothing at all; a real change swaps only the changed text and controls, never a card.
const {chromium} = require('playwright');
const testEnv = require('./podview_actual_env.cjs');
const {spawn} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');

const port = Number(process.env.OVERVIEW_STABLE_TEST_PORT || 18989);
const base = `http://127.0.0.1:${port}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const lab = body =>
  fetch(base + '/lab/state', {
    method: body ? 'POST' : 'GET',
    headers: {'Content-Type': 'application/json'},
    ...(body ? {body: JSON.stringify(body)} : {}),
  }).then(r => r.json());

let server;
let browser;
(async () => {
  try {
    const data = await fs.mkdtemp(path.join(os.tmpdir(), 'podview-overview-stable-'));
    server = spawn(testEnv.python, [path.join(__dirname, 'home_events_e2e_server.py')], {
      cwd: testEnv.runtimeRoot,
      // The offline-feedback fixture has live weather and a robot on the overview.
      env: testEnv.pythonEnv({HOME_EVENT_TEST_PORT: String(port), HOME_EVENT_TEST_DATA: data, OFFLINE_FEEDBACK_TEST: '1'}),
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
    browser = await chromium.launch(testEnv.browserOptions());
    const page = await browser.newPage({hasTouch: true, viewport: {width: 1180, height: 820}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/view/?room=kitchen', {waitUntil: 'domcontentloaded'});
    await testEnv.openOverview(page);
    await page.locator('#home-weather:not([hidden])').waitFor({timeout: 15000});
    await page.locator('#now-view .resource-card[data-kind="vacuum"], #now-view [data-kind="vacuum"]').first()
      .waitFor({timeout: 15000});
    await sleep(4000);
    // Every element replacement and every presentation-state change on an overview card.
    await page.evaluate(() => {
      window.__changes = [];
      const cards = [...document.querySelectorAll('#now-view > [data-overview-rank]')].filter(n => n.offsetParent);
      for (const card of cards) {
        const name = card.id || card.dataset.kind || card.className.split(' ')[0];
        new MutationObserver(list => {
          for (const m of list) {
            if (m.type === 'childList') {
              const elements = [...m.removedNodes, ...m.addedNodes].filter(n => n.nodeType === 1);
              if (elements.length) window.__changes.push([name, 'element', elements.map(n => n.className || n.tagName)]);
            } else if (m.type === 'attributes' && m.oldValue !== m.target.getAttribute(m.attributeName)) {
              window.__changes.push([name, 'attr', m.attributeName, m.oldValue, m.target.getAttribute(m.attributeName)]);
            }
          }
        }).observe(card, {subtree: true, childList: true, attributes: true, attributeOldValue: true});
      }
      window.__cards = cards.length;
    });
    const changes = () => page.evaluate(() => {
      const list = window.__changes;
      window.__changes = [];
      return list;
    });
    assert((await page.evaluate(() => window.__cards)) >= 3, 'overview cards are observed');

    // 1. Home Assistant events with unchanged data.
    for (let i = 0; i < 3; i++) {
      await lab({irrelevant: true});
      await sleep(800);
    }
    await sleep(1500);
    assert.deepEqual(await changes(), [], 'unchanged data redraws nothing');

    // 2. A quick background reconnect (renewal or SSE restart) with the same data.
    await page.locator('pv-widget-host').evaluate(h => h.liveTransport.restart(false, false));
    await page.waitForFunction(() => document.querySelector('pv-widget-host')?.liveTransport?.connected === true,
      null, {timeout: 10000});
    await sleep(3000);
    const reconnect = await changes();
    assert.deepEqual(reconnect, [], `a quick reconnect changes no card: ${JSON.stringify(reconnect)}`);

    // 3. A real change: only the robot's own text and controls change; no card is replaced.
    const before = (await lab()).state;
    await lab({state: before === 'cleaning' ? 'docked' : 'cleaning'});
    await sleep(3000);
    const changed = await changes();
    assert(changed.some(([name]) => name === 'vacuum'), `the robot card shows the change: ${JSON.stringify(changed)}`);
    assert(!changed.some(([name]) => name !== 'vacuum'), `other cards are untouched: ${JSON.stringify(changed)}`);
    assert(!changed.some(([, kind, attr]) => kind === 'attr' && ['aria-busy', 'data-stale'].includes(attr)),
      `no busy or stale flash: ${JSON.stringify(changed)}`);
    assert.deepEqual(errors, []);
    console.log(`PASS overview stable: 0 changes on unchanged data and reconnect, ${changed.length} on a robot change`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
  }
})();
