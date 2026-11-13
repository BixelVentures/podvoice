'use strict';
// Native feel (13 Nov): every detail page opened from the overview is complete within 60 ms of
// appearing (text, rows and images from prefetched, last-known data) and nothing loads in after.
// Robot and Tesla have their own first-frame journeys; music and radio belong to the music owner.
const {chromium} = require('playwright');
const testEnv = require('./podview_actual_env.cjs');
const {spawn} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');

const port = Number(process.env.PAGES_FIRST_FRAME_TEST_PORT || 18992);
const base = `http://127.0.0.1:${port}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pages = [['#timer-card', 'timers-view'], ['#home-weather', 'weather-view'],
  ['#now-view > [data-kind="light"]', 'device-view'], ['#home-recipes', 'recipe-view']];

let server;
let browser;
(async () => {
  try {
    const data = await fs.mkdtemp(path.join(os.tmpdir(), 'podview-pages-first-frame-'));
    server = spawn(testEnv.python, [path.join(__dirname, 'home_events_e2e_server.py')], {
      cwd: testEnv.runtimeRoot,
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
    await page.locator('#home-recipes:not([hidden])').waitFor({timeout: 15000});
    await sleep(4000);
    const results = [];
    for (const [card, view] of pages) {
      await page.evaluate(id => {
        window.__frames = [];
        const sample = () => {
          const node = document.getElementById(id);
          if (node && !node.hidden && node.offsetParent !== null) {
            const pending = [...node.querySelectorAll('img')].filter(i => i.offsetParent && !i.complete).length;
            window.__frames.push({at: performance.now(), text: node.innerText.length,
              rows: node.querySelectorAll('*').length, pending});
          }
          window.__raf = requestAnimationFrame(sample);
        };
        sample();
      }, view);
      await page.locator(card).first().tap();
      await sleep(1500);
      const frames = await page.evaluate(() => {
        cancelAnimationFrame(window.__raf);
        return window.__frames;
      });
      assert(frames.length, `${view} opened`);
      const final = frames.at(-1), settled = frames.find(f => f.text === final.text && f.rows === final.rows &&
        f.pending === 0);
      const settleMs = settled ? Math.round(settled.at - frames[0].at) : null;
      const later = settled ? frames.filter(f => f.at > settled.at) : [];
      results.push([view, settleMs]);
      assert(settled && settleMs <= 60, `${view} is complete within 60 ms of appearing: ${settleMs} ms, ` +
        JSON.stringify(frames.slice(0, 6).map(f => [Math.round(f.at - frames[0].at), f.text, f.rows, f.pending])));
      assert(later.every(f => f.text === final.text && f.rows === final.rows && f.pending === 0),
        `${view}: nothing loads in after it is complete`);
      await page.locator('#header-title-action').tap();
      await sleep(800);
    }
    assert.deepEqual(errors, []);
    console.log('PASS pages first frame: ' + results.map(([view, ms]) => `${view} ${ms} ms`).join(', '));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
  }
})();
