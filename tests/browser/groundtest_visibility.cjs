// Run with Node + Playwright available through NODE_PATH. No live HA/API calls.
// Uses the shipped CSS, groundtest markup and controller, not a recreated widget.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const source = fs.readFileSync(path.join(__dirname, '../../podvoice/gatekeeper/static/index.html'), 'utf8');
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
const markup = source.match(/<button id="g_start"[\s\S]*?<p id="g_hint"[^>]*><\/p>/)[0];
const controller = source.match(/\/\/ ---- Guided physical baseline ----([\s\S]*?)<\/script>/)[1];
const payload = (run, passed = false) => ({
  run, summary: { passed, counts: { correct: passed ? 10 : 0 }, total: 10, sentences: 30 },
  cases: [{ number: 1, kind: 'lookup', before: 'Vent på wake', say: 'Hvad er klokken?',
    expect: 'Tid', followup: 'Og dagen?', followup_expect: 'Ugedag', close_mode: 'semantic',
    close_say: 'Farvel', close_expect: 'Lukning' }],
  final_wake_instruction: 'Okay Nabu, hvad er klokken?'
});
const active = { started_at: 1, run_id: 'run', case_id: 'case', current_index: 0, results: [] };
const cases = [
  ['idle', payload({}), [true, false, false], 'Ikke startet'],
  ['active', payload(active), [false, true, false], 'Samtale 1 af 1'],
  ['final', payload({ ...active, awaiting_final_wake: true, final_wake_id: 'final' }), [false, false, true], 'sidste rearm-bevis'],
  ['passed', payload({ ...active, completed_at: 2 }, true), [true, false, false], 'GRUNDTEST GODKENDT'],
  ['failed', payload({ ...active, completed_at: 2 }), [true, false, false], 'GRUNDTEST IKKE GODKENDT']
];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PODVOICE_TEST_CHROMIUM });
  try {
    for (const width of [320, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      let data, requests;
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://panel.test/**', route => {
        const req = route.request();
        if (req.url().endsWith('/api/groundtest')) {
          requests.push(req.method());
          return route.fulfill({ json: data });
        }
        if (req.url() === 'http://panel.test/') {
          return route.fulfill({ contentType: 'text/html', body:
            `<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style>${markup}<script>${controller}</script>` });
        }
        throw new Error(`Unexpected request: ${req.method()} ${req.url()}`);
      });
      for (const [name, state, visible, text] of cases) {
        data = state; requests = [];
        await page.goto('http://panel.test/');
        for (const reload of [false, true]) {
          if (reload) await page.reload();
          await page.waitForFunction(expected => document.getElementById('g_test').textContent.includes(expected), text);
          for (const [index, id] of ['g_start', 'g_actions', 'g_final_actions'].entries()) {
            assert.equal(await page.locator(`#${id}`).isVisible(), visible[index], `${width}/${name}/reload=${reload}: ${id}`);
          }
          if (!visible[1]) assert.equal(await page.locator('#g_actions button:visible').count(), 0);
          if (!visible[2]) assert.equal(await page.locator('#g_final_actions button:visible').count(), 0);
        }
        assert.deepEqual(requests, ['GET', 'GET'], 'Reload must only read, never restart or rate the run');
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: 5 groundtest states × 2 viewports × fresh/reload; no writes or JS errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
