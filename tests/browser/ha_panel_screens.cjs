'use strict';
// PodView's screens as pictures: every screen and its main states in WebKit at the wall iPad's 1180×820, compared
// with the committed baselines in tests/browser/ha_panel/screens/ (the same fake `hass` and built panel as
// ha_panel_actual_e2e.cjs). The clock is fixed, so the topbar, timers and forecasts draw the same every run.
// A screen differs when more than MAX_DIFF of its pixels move by more than TOLERANCE in a channel; the actual
// picture and a diff are written to PODVIEW_TEST_ARTIFACT_DIR. A deliberate change updates the baselines:
//   UPDATE_BASELINES=1 node tests/browser/ha_panel_screens.cjs
// Baselines are drawn by Playwright's own Linux image (as CI runs it, PODVIEW_TEST_WEBKIT_ENDPOINT); a Mac's WebKit
// draws text differently.
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const env = require('./podview_actual_env.cjs');

const root = path.resolve(__dirname, '../..');
const esbuild = require(path.join(root, 'node_modules/esbuild'));
const BASELINES = path.join(__dirname, 'ha_panel/screens');
const UPDATE = process.env.UPDATE_BASELINES === '1';
const ONLY = process.env.SCREENS ? new Set(process.env.SCREENS.split(',')) : null;
const TOLERANCE = 40;
const MAX_DIFF = Number(process.env.MAX_DIFF ?? 0.002);
const NOW = new Date('2026-11-19T16:24:00+01:00');
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json'};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function serve() {
  const fixture = esbuild.buildSync({entryPoints: [path.join(root, 'podview/src/lib/ha/ha-fixture.ts')], bundle: true,
    format: 'esm', write: false, target: 'safari16'}).outputFiles[0].text;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/ha_panel/fixture.js') {
      response.writeHead(200, {'Content-Type': 'text/javascript'});
      response.end(fixture);
      return;
    }
    const versioned = /^\/podvoice_static\/frontend\/[0-9a-f]{12}\/(.+)$/.exec(url.pathname);
    let file = null;
    if (versioned) file = path.join(root, 'custom_components/podvoice/frontend', versioned[1]);
    else if (url.pathname.startsWith('/ha_panel/')) file = path.join(__dirname, 'ha_panel', url.pathname.slice(10));
    try {
      if (!file || !path.resolve(file).startsWith(root)) throw Error('outside');
      const body = await fsp.readFile(file);
      response.writeHead(200, {'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream'});
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

// Pixels compared in the browser itself (canvas), so the journey needs no image library.
async function compare(page, actual, expected) {
  return page.evaluate(async ([a, b, tolerance]) => {
    const load = async data => createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const [one, two] = await Promise.all([load(a), load(b)]);
    if (one.width !== two.width || one.height !== two.height) return {ratio: 1, diff: null};
    const pixels = bitmap => {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const x = pixels(one), y = pixels(two), out = new ImageData(one.width, one.height);
    let changed = 0;
    for (let i = 0; i < x.data.length; i += 4) {
      const delta = Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]),
        Math.abs(x.data[i + 2] - y.data[i + 2]));
      const gray = (y.data[i] + y.data[i + 1] + y.data[i + 2]) / 12 + 160;
      if (delta > tolerance) {
        changed++;
        out.data.set([255, 0, 80, 255], i);
      } else out.data.set([gray, gray, gray, 255], i);
    }
    const canvas = new OffscreenCanvas(one.width, one.height);
    canvas.getContext('2d').putImageData(out, 0, 0);
    const blob = await canvas.convertToBlob({type: 'image/png'});
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return {ratio: changed / (x.data.length / 4), diff: btoa(binary)};
  }, [actual.toString('base64'), expected.toString('base64'), TOLERANCE]);
}

(async () => {
  let server, browser;
  const failures = [];
  try {
    server = await serve();
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await env.webkit();
    const context = await browser.newContext({hasTouch: true, viewport: {width: 1180, height: 820},
      timezoneId: 'Europe/Copenhagen', locale: 'da-DK'});
    await context.clock.setFixedTime(NOW);
    const PIXEL = Buffer.from('R0lGODlhAQABAAAAACw=', 'base64');
    await context.route(url => url.protocol === 'https:', route =>
      route.request().resourceType() === 'image'
        ? route.fulfill({status: 200, contentType: 'image/gif', body: PIXEL}) : route.continue());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const scratch = await context.newPage();
    await scratch.setContent('<!doctype html><title>diff</title>');
    await page.goto(base + '/ha_panel/host.html', {waitUntil: 'load'});
    const frame = await (await page.waitForSelector('iframe')).contentFrame();
    const panel = page.frameLocator('iframe');
    const home = () => panel.getByRole('heading', {level: 1, name: 'Køkkenalrum'}).waitFor();
    await home();
    await frame.waitForFunction(() => document.fonts.status === 'loaded');
    const back = async () => {
      await panel.getByRole('button', {name: 'Tilbage'}).tap();
      await sleep(150);
    };
    // Settled: no running finite animation, then two frames.
    const settle = async () => {
      await sleep(250);
      await frame.waitForFunction(() => !document.getAnimations().some(animation =>
        animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity), null,
      {timeout: 5000}).catch(() => {});
      await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await sleep(150);
    };
    const shoot = async name => {
      if (ONLY && !ONLY.has(name)) return;
      await settle();
      const actual = await page.screenshot({animations: 'disabled', caret: 'hide',
        mask: [panel.locator('[data-diag]')], maskColor: '#888888'});
      const file = path.join(BASELINES, `${name}.png`);
      if (UPDATE || !fs.existsSync(file)) {
        fs.mkdirSync(BASELINES, {recursive: true});
        fs.writeFileSync(file, actual);
        console.log(`  ${name}: baseline written`);
        return;
      }
      const {ratio, diff} = await compare(scratch, actual, fs.readFileSync(file));
      const percent = (ratio * 100).toFixed(3);
      if (ratio <= MAX_DIFF) {
        console.log(`  ${name}: ok (${percent} % differ)`);
        return;
      }
      const out = env.artifactDir();
      fs.writeFileSync(path.join(out, `${name}.actual.png`), actual);
      if (diff) fs.writeFileSync(path.join(out, `${name}.diff.png`), Buffer.from(diff, 'base64'));
      console.log(`  ${name}: DIFFERS (${percent} % of the pixels; ${out})`);
      failures.push(name);
    };

    // Hjem.
    await panel.getByRole('button', {name: /Musik.*Holocene · Bon Iver/}).waitFor();
    await shoot('hjem');
    // Lys.
    await panel.getByRole('button', {name: /^Lys/}).tap();
    await panel.getByRole('switch', {name: /Køkkenø/}).waitFor();
    await shoot('lys');
    await back();
    // Musik with its queue, »Afspil på«, Find musik and Radio.
    await panel.getByRole('button', {name: /^Musik/}).first().tap();
    const music = panel.locator('[data-screen=music]');
    await music.getByRole('button', {name: /^Afspil 2 · /}).waitFor();
    await shoot('musik');
    await music.getByRole('button', {name: /^Afspil på|Køkkenalrum/}).first().tap();
    await panel.getByRole('button', {name: 'Luk'}).waitFor();
    await shoot('musik-afspil-paa');
    await panel.getByRole('button', {name: 'Luk'}).tap();
    await panel.getByRole('button', {name: 'Luk'}).waitFor({state: 'detached'});
    await music.getByRole('button', {name: 'Vælg musik'}).tap();
    const find = panel.locator('[data-screen=find]');
    await find.getByRole('group', {name: 'Regnvejr og torsdag aften'}).getByRole('button').first().waitFor();
    await shoot('find-musik');
    await back();
    await music.getByRole('button', {name: 'Radio', exact: true}).tap();
    await panel.locator('[data-screen=radio]').getByRole('button', {name: /^P3/}).waitFor();
    await shoot('radio');
    await back();
    await back();
    await home();
    // Vejr.
    await panel.getByRole('button', {name: /Let skyet/}).tap();
    await panel.locator('[data-screen=weather]').getByRole('heading').first().waitFor();
    await shoot('vejr');
    await back();
    // Timer, running.
    await panel.getByRole('button', {name: /^Timer/}).tap();
    const timers = panel.locator('[data-screen=timers]');
    await timers.getByRole('button', {name: '5 min', exact: true}).tap();
    await timers.getByText(/5:00|4:59/).first().waitFor();
    await shoot('timer');
    await back();
    // Robot while it cleans, and its confirmation step.
    await page.evaluate(() => {
      window.fakeHass.patch('vacuum.qrevo', 'cleaning');
    });
    await panel.locator('#home-robot').tap();
    const robot = panel.locator('[data-screen=robot]');
    await robot.getByRole('radiogroup', {name: 'Sugeevne'}).waitFor();
    await shoot('robot');
    await robot.getByRole('button', {name: 'Kør til basen'}).tap();
    const ask = panel.getByRole('alertdialog', {name: 'Kør til basen?'});
    await ask.waitFor();
    await shoot('robot-bekraeft');
    await ask.getByRole('button', {name: 'Behold turen'}).tap();
    await ask.waitFor({state: 'detached'});
    await back();
    await home();
    // Bil.
    await panel.locator('#home-vehicle').tap();
    await panel.locator('[data-screen=vehicle]').getByRole('button', {name: 'Lås op'}).waitFor();
    await shoot('bil');
    await back();
    // Svar.
    await panel.getByRole('button', {name: 'Se tidligere svar'}).tap();
    await panel.locator('[data-screen=answers]').getByRole('button', {name: /En rolig morgen/}).waitFor();
    await shoot('svar');
    await back();
    // Opskrifter: the catalogue and a recipe.
    await panel.locator('#home-recipes').tap();
    const recipes = panel.locator('[data-screen=recipes]');
    await recipes.getByRole('button', {name: /^Burgerboller/}).waitFor();
    await shoot('opskrifter');
    await recipes.getByRole('button', {name: /^Burgerboller/}).tap();
    await panel.locator('[data-screen=recipe]').getByRole('button', {name: 'Start opskrift'}).waitFor();
    await shoot('opskrift');
    await back();
    await back();
    await home();
    // Ro.
    await panel.getByRole('button', {name: 'Gå til Ro'}).tap();
    await frame.waitForSelector('#photo-view', {state: 'visible'});
    await sleep(800);
    await shoot('ro');

    assert.deepEqual(errors, []);
    assert.deepEqual(failures, [], 'screens differ from their baselines');
    console.log('ha_panel_screens: ok');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server?.close();
  }
})();
