'use strict';
// Native feel (13 Nov): the Tesla page opens complete in its first frame (text, controls and
// images) and nothing loads in afterwards. The page is prepared in the background at startup.
const {chromium} = require('playwright');
const env = require('./podview_actual_env.cjs');
const {spawn} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');

const port = Number(process.env.VEHICLE_FIRST_FRAME_TEST_PORT || 18986);
const base = `http://127.0.0.1:${port}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let server;
let browser;
(async () => {
  try {
    const data = await fs.mkdtemp(path.join(os.tmpdir(), 'podview-vehicle-first-frame-'));
    server = spawn(env.python, [path.join(__dirname, 'vehicle_e2e_server.py')], {
      cwd: env.runtimeRoot,
      env: env.pythonEnv({VEHICLE_TEST_PORT: String(port), VEHICLE_TEST_DATA: data, VEHICLE_LIFECYCLE_TEST: '1'}),
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
    browser = await chromium.launch(env.browserOptions());
    const page = await browser.newPage({hasTouch: true, viewport: {width: 1180, height: 820}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/view/?room=kitchen', {waitUntil: 'domcontentloaded'});
    await env.openOverview(page);
    const card = page.locator('#home-vehicle');
    await card.waitFor({timeout: 15000});
    await page.waitForFunction(() => document.querySelector('pv-widget-host')?.state?.vehicle?.batteryPercent === 72,
      undefined, {timeout: 15000});
    await sleep(2000);
    await page.evaluate(() => {
      window.__frames = [];
      document.addEventListener('click', event => { window.__tapped ??= event.timeStamp; }, {capture: true});
      const sample = () => {
        const view = document.querySelector('#vehicle-view');
        if (view && !view.hidden && view.offsetParent !== null) {
          const pending = [...view.querySelectorAll('img')].filter(i => i.offsetParent && !i.complete)
            .map(i => i.getAttribute('src'));
          window.__frames.push({at: performance.now(), text: view.innerText.length,
            height: Math.round(view.scrollHeight), pending});
        }
        window.__raf = requestAnimationFrame(sample);
      };
      sample();
    });
    await card.tap();
    await sleep(1500);
    const [frames, tapped] = await page.evaluate(() => {
      cancelAnimationFrame(window.__raf);
      return [window.__frames, window.__tapped];
    });
    assert(frames.length, 'the Tesla page opened');
    const first = frames[0], log = JSON.stringify(frames.slice(0, 4));
    assert(first.at - tapped < 100, `first frame after ${Math.round(first.at - tapped)} ms`);
    assert.deepEqual(first.pending, [], `every image is ready in the first frame: ${log}`);
    assert(frames.every(f => f.text === first.text && f.height === first.height),
      `nothing loads in after the first frame: ${log}`);
    assert.deepEqual(errors, []);
    console.log(`PASS Tesla first frame: complete after ${Math.round(first.at - tapped)} ms, ${frames.length} frames`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
  }
})();
