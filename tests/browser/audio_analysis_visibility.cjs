// Actual shipped controller and markup, isolated from household/provider services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const source = fs.readFileSync(path.join(__dirname, '../../podvoice/gatekeeper/static/index.html'), 'utf8');
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
const markup = source.match(/<button id="trace_arm"[\s\S]*?<div id="trace_analysis"[^>]*><\/div>/)[0];
const controller = source.match(/\/\/ ---- One-shot physical audio evidence ----([\s\S]*?)<\/script>/)[1];
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PODVOICE_TEST_CHROMIUM });
  try {
    for (const width of [320, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      let report = { status: 'idle' }, posts = 0;
      let trace = { ok:true, active:null, latest:{id:'trace-1',room:'r0',started_at:1,metadata:{podvoice_version:'1.13.77'},stages:{}} };
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('http://panel.test/**', route => {
        const request = route.request();
        if (request.url().endsWith('/api/audio-trace')) return route.fulfill({json:trace});
        if (request.url().endsWith('/api/audio-analysis')) {
          if (request.method() === 'POST') {
            posts++;
            assert.deepEqual(request.postDataJSON(), {trace_id:'trace-1'});
            report = {status:'running',trace_id:'trace-1'};
          }
          return route.fulfill({json:report});
        }
        if (request.url() === 'http://panel.test/') return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style>${markup}<script>${controller}</script>`});
        throw new Error('Unexpected request: ' + request.url());
      });
      await page.goto('http://panel.test/');
      await page.waitForFunction(() => !document.getElementById('trace_analyse').disabled);
      await page.locator('#trace_analyse').click();
      await page.waitForFunction(() => document.getElementById('trace_analysis').textContent.includes('Analyserer'));
      assert.equal(await page.locator('#trace_analyse').isDisabled(), true);
      await page.reload();
      await page.waitForFunction(() => document.getElementById('trace_analysis').textContent.includes('Analyserer'));
      assert.equal(posts, 1, 'Reload must never restart a paid analysis');
      report = {status:'completed',trace_id:'trace-1',audio_start_ms:0,audio_end_ms:640,note:'Ikke akustisk bevis',segments:[{name:'first_provider_item',transcript:'<img src=x onerror=alert(1)>'},{name:'device_context',transcript:'Hvilken dag er det?'}]};
      await page.reload();
      await page.waitForFunction(() => document.getElementById('trace_analysis').textContent.includes('0–640'));
      assert.equal(await page.locator('#trace_analysis img').count(), 0);
      assert.ok((await page.locator('#trace_analysis').textContent()).includes('Ikke akustisk bevis'));
      assert.equal(posts, 1);
      report = {status:'failed',error:'Analysen fejlede'};
      await page.reload();
      await page.waitForFunction(() => document.getElementById('trace_analysis').textContent.includes('fejlede'));
      trace = {ok:true, active:{room:'r0'}, max_seconds:60};
      await page.reload();
      await page.waitForFunction(() => document.getElementById('trace_status').textContent.includes('Optager nu'));
      assert.equal(await page.locator('#trace_analyse').isDisabled(), true);
      assert.equal(posts, 1);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: analysis start/running/reload/completed/failed/recording in 320px and desktop; one POST; escaped text');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
