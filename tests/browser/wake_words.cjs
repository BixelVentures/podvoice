// Shipped settings markup/controller + status renderer; API fixtures, no HA writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const source = fs.readFileSync(path.join(__dirname, '../../podvoice/gatekeeper/static/index.html'), 'utf8');
const markup = source.replace(/<script>[\s\S]*?<\/script>/g, '');
const settings = source.match(/\/\/ ---- Settings page[\s\S]*?<\/script>/)[0].replace('</script>', '');
const renderer = source.split('var savedWakeWord = null;')[1].split('function renderRooms()')[0];
const poll = source.split('async function poll() {')[1].split('function openStream()')[0];
const script = `var rooms = {}, connected = true, lastObservedMs = Date.now(), lastStatus = {};
function toast() {} function renderSub() {} function applyStatus() {}
var savedWakeWord = null; ${renderer}
async function poll() { ${poll}
${settings}`;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PODVOICE_TEST_CHROMIUM });
  try {
    for (const width of [320, 390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      let saved = {engine:'thin', wake_word:'okay_nabu', rooms:[]};
      let reject = false, offline = false, restarts = 0;
      await page.route('http://panel.test/**', async route => {
        const req = route.request(), url = req.url();
        if (url === 'http://panel.test/') return route.fulfill({contentType:'text/html', body:markup + `<script>${script}</script>`});
        if (url.endsWith('/api/status') && offline) return route.abort();
        if (url.endsWith('/api/settings')) {
          if (req.method() === 'POST') {
            if (reject) return route.fulfill({status:400, json:{ok:false, error:'wake_word: invalid'}});
            saved = {...saved, ...req.postDataJSON()};
            return route.fulfill({json:{ok:true, settings:saved}});
          }
          return route.fulfill({json:saved});
        }
        if (url.endsWith('/api/restart')) restarts++;
        return route.fulfill({json:{ok:true, rooms:[]}});
      });
      await page.goto('http://panel.test/');
      await page.evaluate(() => {
        document.querySelectorAll('.pane').forEach(p => { p.hidden = p.id !== 'pane-settings'; p.classList.toggle('active', !p.hidden); });
        rooms = {Stue:{connected:true, wake_word_supported:true, wake_word_confirmed:'okay_nabu'}};
        wakeStatusAvailable = true;
        renderWakeWordStatus();
      });
      const select = page.locator('#s_wake_word');
      assert.equal(await select.locator('option').count(), 4);
      await select.focus();
      assert.equal(await select.evaluate(e => document.activeElement === e), true);
      assert.notEqual(await select.evaluate(e => getComputedStyle(e).outlineStyle), 'none');
      await select.selectOption('hey_chat');
      await page.locator('#s_save').click();
      await page.waitForFunction(() => document.querySelector('#s_wake_word_status').textContent.includes('Gemt valg (alle enheder): Hey Chat'));
      assert.match(await page.locator('#s_wake_word_status').innerText(), /Bekræftet af enheden: Okay Nabu/);
      await page.locator('#s_saverestart').click();
      await page.waitForFunction(() => document.querySelector('#s_status').textContent.includes('Restarting'));
      assert.equal(restarts, 1);
      reject = true;
      await select.selectOption('hey_jarvis');
      await page.locator('#s_save').click();
      await page.waitForFunction(() => document.querySelector('#s_status').textContent.includes('wake_word: invalid'));
      assert.equal(saved.wake_word, 'hey_chat');
      await page.evaluate(() => { rooms.Stue.wake_word_supported = false; renderWakeWordStatus(); });
      assert.match(await page.locator('#s_wake_word_status').innerText(), /Opdatér Voice PE-firmware/);
      await page.evaluate(() => { rooms.Stue = {connected:false}; renderWakeWordStatus(); });
      assert.match(await page.locator('#s_wake_word_status').innerText(), /Kan ikke bekræfte vækkeord/);
      await page.evaluate(() => { rooms.Stue = {connected:true, wake_word_supported:true, wake_word_confirmed:'hey_chat'}; renderWakeWordStatus(); });
      offline = true;
      await page.evaluate(() => poll());
      assert.doesNotMatch(await page.locator('#s_wake_word_status').innerText(), /Bekræftet af enheden/);
      assert.equal(await select.evaluate(e => e.getBoundingClientRect().right <= innerWidth), true);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS settings save/restart/errors/readback/offline/focus at 320/390/1440 px');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
