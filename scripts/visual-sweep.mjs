#!/usr/bin/env node
// Visuelt overblik: hver PodView-skærm og hver tilstand, som testdata kan frembringe, fotograferet på én gang
// i 1180×820 (iPad-skærmen) og samlet i ét kontaktark (HTML) med PNG-filerne ved siden af.
//
//   npm run visual                    lokale testdata (?stage=-forhåndsvisninger + Python-fixtures)
//   npm run visual -- --open          åbner kontaktarket bagefter
//   npm run visual -- --out <mappe>   gem et bestemt sted (standard: ny mappe i $TMPDIR)
//   npm run visual -- --only robot    kun tilstande, hvis afsnit eller navn indeholder teksten
//   npm run visual -- --green         samme gennemgang mod den rigtige PodView på HA Green, kun læsende
//
// Lokalt: den byggede PodView i podvoice/gatekeeper/static/podview serveres fra denne proces, og de tilstande,
// kun en rigtig server kan frembringe (Svar, Opskrifter, musik på en anden enhed, højttalerlisten), tages med
// browserrejsernes egne Python-fixtures, når en Python med add-on'ets pakker findes (.venv eller
// PODVIEW_TEST_PYTHON). Mangler den, står de tilstande som »ikke frembragt« i arket.
// --green: login som scripts/green-check.mjs (GREEN_HA_TOKEN eller nøgleringen); tokenet skrives aldrig ud.
// Der skiftes kun visning (skærmens egen »show«-overgang, Svar-historikken, højttalerlisten åbnes og lukkes);
// ingen handling trykkes, og ingen knap på et kort røres.
import {execFile, spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {greenBrowserContext, greenLaunchOptions, openGreenPodView, readGreenToken} from './green-login.mjs';
import {redact} from './green-check-lib.mjs';

const started = Date.now();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'tests/browser/package.json'));
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const VIEWPORT = {width: 1180, height: 820};
const STATIC_PAGES = 8;
// Europe/Copenhagen is UTC+1 in November: 14.10 and 23.14.
const DAY = new Date('2026-11-09T13:10:00Z');
const NIGHT = new Date('2026-11-09T22:14:00Z');

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    console.error('Playwright mangler. Kør først: npm ci --prefix tests/browser');
    process.exit(2);
  }
}

// ---------- What to capture ----------

const show = id => page => page.evaluate(view => document.querySelector('pv-widget-host').dispatch(
  {type: 'show', id: view}), id).then(() => sleep(450));
const tap = (selector, wait = 500) => async page => {
  await page.locator(selector).first().click();
  await sleep(wait);
};
// The kit's busy contract (ui/kit.js runKitButtonAction): data-feedback=progress and aria-busy while it runs,
// data-state=error after a failed request. Set here on a real kit button to show what the user sees.
const kitButton = state => page => page.evaluate(state => {
  const button = document.querySelector('#empty-find-music');
  button.dataset.feedback = 'progress';
  if (state === 'busy') button.setAttribute('aria-busy', 'true');
  else button.dataset.state = 'error';
}, state).then(() => sleep(250));

// Each state: section, label, the ?stage= preview, an optional clock and an optional step on the page.
const STATIC = [
  ['Foto-Ro', 'Foto-Ro · intet i gang', 'quiet'],
  ['Foto-Ro', 'Foto-Ro · timer og musik', 'timer-rest-running'],
  ['Foto-Ro', 'Foto-Nat 23.14', 'timer-rest-running', {time: NIGHT}],
  ['Overblik', 'Overblik · afspilleren spiller', 'now'],
  ['Overblik', 'Overblik · timer i gang', 'activities-combined'],
  ['Afspiller', 'Afspiller · pause', 'paused', {act: show('now')}],
  ['Afspiller', 'Afspiller · intet spiller', 'player-active-empty', {act: show('now')}],
  ['Afspiller', 'Afspiller · henter', 'player-active-loading', {act: show('now')}],
  ['Afspiller', 'Afspiller · ikke forbundet', 'player-active-offline', {act: show('now')}],
  ['Afspiller', 'Afspiller · fejl', 'player-active-error', {act: show('now')}],
  ['Afspiller', 'Afspiller · uden omslag', 'player-active-missing-art', {act: show('now')}],
  ['Afspiller', 'Afspiller · radio', 'radio-selected', {act: show('now')}],
  ['Kø', 'Kø', 'now', {act: tap('.player .cover-button', 700)}],
  ['Kø', 'Kø · henter', 'player-queue-loading'],
  ['Kø', 'Kø · tom', 'player-queue-empty'],
  ['Kø', 'Kø · fejl', 'player-queue-error'],
  ['Radio', 'Radio · vælg station', 'radio-ready'],
  ['Radio', 'Radio · starter', 'radio-request-pending'],
  ['Radio', 'Radio · spiller', 'radio-selected'],
  ['Radio', 'Radio · stoppet', 'radio-paused'],
  ['Radio', 'Radio · ikke tilgængelig', 'radio-offline'],
  ['Musik', 'Musik · hjem', 'music-prototype-afternoon'],
  ['Musik', 'Musik · starter', 'music-prototype-afternoon', {act: tap('#result-list>.result:nth-child(2)', 60)}],
  ['Musik', 'Musik · stemning', 'music'],
  ['Musik', 'Musik · andre forslag hentes', 'music-refreshing'],
  ['Musik', 'Musik · ikke forbundet', 'music-offline'],
  ['Robot', 'Robot · i basen', 'robot-detail-docked'],
  ['Robot', 'Robot · Mere', 'robot-detail-docked', {act: tap('[id^=robot-base-][id$=-trigger]', 500)}],
  ['Robot', 'Robot · rengør', 'robot-detail-cleaning'],
  ['Robot', 'Robot · optaget (pause sendes)', 'robot-detail-pending'],
  ['Robot', 'Robot · på pause', 'robot-detail-paused'],
  ['Robot', 'Robot · fejl', 'robot-detail-fault'],
  ['Lys', 'Lys', 'hue-kitchen'],
  ['Lys', 'Lys · Status ukendt', 'hue-unknown'],
  ['Lys', 'Lys · Status ukendt, hentning fejlede', 'hue-stale'],
  ['Lys', 'Lys · sender', 'hue-feedback-sending'],
  ['Lys', 'Lys · ikke forbundet', 'light-detail-empty'],
  ['Timer', 'Timer · start', 'timers'],
  ['Timer', 'Timer · kører', 'timer-detail-running'],
  ['Timer', 'Timer · pause', 'timer-detail-paused'],
  ['Timer', 'Timer · flere', 'timer-detail-multiple'],
  ['Timer', 'Timer · alarm', 'timer-detail-finished'],
  ['Timer', 'Timer · færdig (Start igen)', 'timer-detail-finished', {act: tap('#timer-alert-open', 500)}],
  ['Timer', 'Timer · efter Start igen', 'timer-detail-finished', {act: async page => {
    await tap('#timer-alert-open', 400)(page);
    await tap('#timers-view .timer-restart', 600)(page);
  }}],
  ['Vejr', 'Vejr', 'weather'],
  ['Vejr', 'Vejr · gammelt', 'weather-stale'],
  ['Vejr', 'Vejr · ukendt', 'weather-connection-error'],
  ['Tesla', 'Tesla · lader', 'vehicle-charging'],
  ['Tesla', 'Tesla · gammelt', 'vehicle-stale'],
  ['Tesla', 'Tesla · ikke forbundet', 'vehicle-unconnected'],
  ['Dialoger', 'Højttaler-dialog (musik)', 'now', {act: tap('#output', 600)}],
  ['Dialoger', 'Højttaler-dialog (radio)', 'radio-selected', {act: tap('.player #output', 600)}],
  ['Dialoger', 'Skærm og enhed', 'screen-device-ready'],
  ['Knaptilstande', 'Kit-knap · optaget (aria-busy)', 'player-active-empty', {act: async page => {
    await show('now')(page);
    await kitButton('busy')(page);
  }}],
  ['Knaptilstande', 'Kit-knap · fejl (data-state=error)', 'player-active-empty', {act: async page => {
    await show('now')(page);
    await kitButton('error')(page);
  }}],
].map(([section, label, stage, extra = {}]) => ({section, label, stage, ...extra}));

// States only a real server produces. Each list is one page that walks through its states in order.
const FIXTURE_STATES = {
  svar: [['Svar', 'Svar · Svarer… og resultatkort'], ['Svar', 'Svar · opfølgning'], ['Svar', 'Svar · I dag'],
    ['Svar', 'Svar · »↑ 1 nyt svar«']],
  recipe: [['Opskrifter', 'Opskrifter · katalog'], ['Opskrifter', 'Opskrifter · Tilføj opskrift'],
    ['Opskrifter', 'Opskrifter · Udforsk'], ['Opskrifter', 'Opskrift'], ['Opskrifter', 'Opskrift · i gang'],
    ['Opskrifter', 'Opskrifter · i gang-bånd']],
  music: [['Afspiller', 'Afspiller · spiller (live)'], ['Dialoger', 'Højttaler-dialog (live)'],
    ['Knaptilstande', 'Opdater liste · optaget'], ['Afspiller', 'Afspiller · pause (live)'],
    ['Afspiller', 'Afspiller · konto på en anden enhed (Tesla)'], ['Afspiller', 'Afspiller · intet spiller (live)']],
};
// Asked for, but not something the product or its fixtures can show.
const NOT_IN_PRODUCT = [
  ['Afspiller', 'Afspiller · AirPlay', 'PodView har ingen AirPlay-visning; højttalere er PodConnect-rum'],
  ['Dialoger', 'Rum-dialog', 'ingen særskilt rum-dialog: rum vælges i Lys-siden og i robottens »Rum«-felter'],
];

// ---------- Local servers ----------

const TYPES = {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain'};

function staticServer(dir) {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
    const file = path.resolve(dir, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(dir + path.sep)) return response.writeHead(404).end();
    fs.readFile(file, (error, body) => {
      if (error) return response.writeHead(404).end();
      response.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream'});
      response.end(body);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer().once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const {port} = probe.address();
    probe.close(() => resolve(port));
  });
});

function fixturePython() {
  const candidates = [process.env.PODVIEW_TEST_PYTHON, path.join(root, '.venv/bin/python'), 'python3.12', 'python3']
    .filter(Boolean);
  const works = python => new Promise(resolve => execFile(python, ['-c', 'import aiohttp, multidict'],
    {timeout: 5000}, error => resolve(error ? null : python)));
  return candidates.reduce(async (found, python) => (await found) || works(python), Promise.resolve(null));
}

async function startFixture(env, python, script, vars) {
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'podview-visual-fixture-'));
  const server = spawn(python, [path.join(root, 'tests/browser', script)], {cwd: root,
    env: env.pythonEnv({...vars(port, data), PODVIEW_TEST_RUNTIME_ROOT: root}), stdio: 'ignore'});
  const base = `http://127.0.0.1:${port}`;
  for (let n = 0; ; n++) {
    if (server.exitCode !== null) throw Error(`${script} stoppede under opstart`);
    try {
      if ((await fetch(base + '/view/')).ok) break;
    } catch {}
    if (n > 200) throw Error(`${script} startede ikke`);
    await sleep(50);
  }
  return {base, stop: () => {
    server.kill();
    fs.rmSync(data, {recursive: true, force: true});
  }};
}

// ---------- Capturing ----------

class Sheet {
  constructor(out, only) {
    this.out = out;
    this.only = only;
    this.shots = [];
    this.missing = [];
    this.n = 0;
  }
  async take(page, section, label, extra = {}) {
    if (!this.only([section, label])) return;
    const file = `${String(++this.n).padStart(3, '0')}-${label.toLowerCase().replace(/[^a-z0-9æøå]+/g, '-')
      .replace(/^-|-$/g, '')}.png`;
    await page.screenshot({path: path.join(this.out, file)});
    this.shots.push({section, label, file, ...extra});
  }
  skip(section, label, reason) {
    this.missing.push({section, label, reason});
  }
}

async function captureStatic(browser, base, sheet, states) {
  const queue = [...states];
  const worker = async () => {
    for (let state; (state = queue.shift()); ) {
      const page = await browser.newPage({viewport: VIEWPORT, hasTouch: true});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.clock.setFixedTime(state.time || DAY);
        await page.goto(`${base}/index.html?stage=${state.stage}`, {waitUntil: 'domcontentloaded'});
        await page.locator('pv-widget-host').waitFor({state: 'attached'});
        await sleep(650);
        if (state.act) await state.act(page);
        await sheet.take(page, state.section, state.label, {source: `?stage=${state.stage}`, errors});
      } catch (error) {
        sheet.skip(state.section, state.label, `?stage=${state.stage}: ${error.message.split('\n')[0]}`);
      } finally {
        await page.close();
      }
    }
  };
  await Promise.all(Array.from({length: STATIC_PAGES}, worker));
}

async function livePage(browser, url, env) {
  const page = await browser.newPage({viewport: VIEWPORT, hasTouch: true});
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  await openOverviewQuietly(page, env);
  return page;
}

// env.openOverview logs a line per call; the sweep keeps its own output short.
const log = console.log;
console.log = (...parts) => {
  if (!String(parts[0]).startsWith('overviewTouch')) log(...parts);
};
const openOverviewQuietly = (page, env) => env.openOverview(page);

const FLOWS = {
  async svar({browser, env, python, sheet}) {
    const fixture = await startFixture(env, python, 'answers_e2e_server.py', (port, data) =>
      ({ANSWERS_TEST_PORT: String(port), ANSWERS_TEST_DATA: data, ANSWERS_LIVE_TEST: '1'}));
    try {
      const post = route => fetch(fixture.base + route, {method: 'POST'});
      const page = await livePage(browser, fixture.base + '/view/?room=kitchen', env);
      const take = label => sheet.take(page, 'Svar', label, {source: 'answers_e2e_server.py'});
      await post('/lab/svar-sport');
      await sleep(600);
      await take('Svar · Svarer… og resultatkort');
      await post('/lab/svar-followup');
      await sleep(600);
      await take('Svar · opfølgning');
      await post('/lab/close-live-answer');
      await post('/lab/submit-live-answer');
      await post('/lab/close-live-answer');
      await page.reload({waitUntil: 'domcontentloaded'});
      await openOverviewQuietly(page, env);
      await page.waitForFunction(() => document.querySelector('pv-widget-host').svarTodayRows?.length > 1);
      await page.locator('#open-history').click();
      await page.locator('#svar-today').waitFor({state: 'visible'});
      await sleep(500);
      await take('Svar · I dag');
      // Reading an older answer while a new one arrives: »↑ 1 nyt svar«.
      await page.locator('#svar-today .svar-today-rows>button').last().click();
      await sleep(300);
      await post('/lab/submit-live-answer');
      await post('/lab/close-live-answer');
      await page.locator('#svar-today .svar-today-new').waitFor({state: 'visible'});
      await sleep(300);
      await take('Svar · »↑ 1 nyt svar«');
    } finally {
      fixture.stop();
    }
  },
  async recipe({browser, env, python, sheet}) {
    const fixture = await startFixture(env, python, 'recipe_e2e_server.py', (port, data) =>
      ({RECIPE_TEST_PORT: String(port), RECIPE_TEST_CATALOG: path.join(data, 'catalog.json')}));
    try {
      const page = await browser.newPage({viewport: VIEWPORT, hasTouch: true});
      // Recipe photos come from the web; the sweep never leaves the machine.
      await page.route(/^https?:\/\//, route => {
        if (new URL(route.request().url()).origin === fixture.base) return route.continue();
        if (route.request().resourceType() !== 'image') return route.abort();
        return route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" ' +
          'width="120" height="80"><rect width="120" height="80" fill="tan"/></svg>'});
      });
      await page.goto(fixture.base + '/view/', {waitUntil: 'domcontentloaded'});
      await openOverviewQuietly(page, env);
      const take = label => sheet.take(page, 'Opskrifter', label, {source: 'recipe_e2e_server.py'});
      const button = name => page.getByRole('button', {name, exact: true});
      await page.locator('#home-recipes').click();
      await page.locator('#recipe-view [data-recipe="Burgerboller"]').waitFor({state: 'visible'});
      await sleep(400);
      await take('Opskrifter · katalog');
      // »Tilføj opskrift« is no longer a toolbar button (A-Opskrifter): the Del → Home Assistant help and the
      // upload history stay at the end of the catalogue.
      await page.locator('#recipe-add-help').scrollIntoViewIfNeeded();
      await sleep(600);
      await take('Opskrifter · Tilføj opskrift');
      await button('Udforsk').click();
      await page.locator('#recipe-view [data-recipe-layout=explore]').waitFor({state: 'visible'});
      await sleep(700);
      await take('Opskrifter · Udforsk');
      await page.getByText('Katalog', {exact: true}).click();
      await page.locator('#recipe-view [data-recipe="Burgerboller"]').click();
      await page.locator('#recipe-ingredients-trigger').waitFor({state: 'visible'});
      await sleep(300);
      await take('Opskrift');
      await button('Start opskrift').click();
      await sleep(400);
      await take('Opskrift · i gang');
      await page.locator('#header-title-action').click();
      await page.locator('#recipe-view [data-recipe][data-kit-variant=resume]').waitFor({state: 'visible'});
      await sleep(300);
      await take('Opskrifter · i gang-bånd');
    } finally {
      fixture.stop();
    }
  },
  async music({browser, env, python, sheet}) {
    const fixture = await startFixture(env, python, 'music_e2e_server.py', (port, data) =>
      ({MUSIC_TEST_PORT: String(port), MUSIC_TEST_DATA: data, MUSIC_EXTENDED: '1'}));
    try {
      const change = body => fetch(fixture.base + '/lab/state', {method: 'POST',
        headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      const page = await livePage(browser, fixture.base + '/view/?room=kitchen', env);
      const take = (section, label) => sheet.take(page, section, label, {source: 'music_e2e_server.py'});
      const player = page.locator('aside.player');
      await page.waitForFunction(() => document.querySelector('pv-widget-host')?.liveMedia?.playback?.state ===
        'playing');
      await sleep(400);
      await take('Afspiller', 'Afspiller · spiller (live)');
      await page.locator('#output').click();
      await page.locator('#room-options button').first().waitFor({state: 'visible'});
      await sleep(300);
      await take('Dialoger', 'Højttaler-dialog (live)');
      // The kit's busy state on »Opdater liste«: the fixture answers at once, so the sweep holds the refresh
      // request for a moment and photographs the button while it is under way.
      const hold = route => sleep(1200).then(() => route.continue()).catch(() => {});
      await page.route(/\/view\/api\//, hold);
      await page.getByRole('button', {name: 'Opdater liste', exact: true}).click();
      await sleep(250);
      await take('Knaptilstande', 'Opdater liste · optaget');
      await page.unroute(/\/view\/api\//, hold);
      await sleep(1100);
      await page.keyboard.press('Escape');
      await change({externalPlaybackState: 'paused'});
      await player.locator('#play-pause[aria-label*="Afspil"], #play-pause[aria-label*="Genoptag"]').first()
        .waitFor({timeout: 5000}).catch(() => {});
      await sleep(600);
      await take('Afspiller', 'Afspiller · pause (live)');
      await change({externalOutput: 'tesla', externalPlaybackState: 'playing'});
      await page.waitForFunction(() => document.querySelector('pv-widget-host')?.liveMedia?.playback?.elsewhere);
      await sleep(600);
      await take('Afspiller', 'Afspiller · konto på en anden enhed (Tesla)');
      await change({externalOutput: 'native-room', externalPlaybackState: 'idle'});
      await sleep(1200);
      await take('Afspiller', 'Afspiller · intet spiller (live)');
    } finally {
      fixture.stop();
    }
  },
};

async function runFlow(name, context) {
  const before = context.sheet.shots.length;
  try {
    await FLOWS[name](context);
  } catch (error) {
    const taken = new Set(context.sheet.shots.slice(before).map(shot => shot.label));
    for (const [section, label] of FIXTURE_STATES[name].filter(context.only))
      if (!taken.has(label)) context.sheet.skip(section, label, `${name}-fixture: ${error.message.split('\n')[0]}`);
  }
}

async function localSweep(chromium, sheet, only) {
  const env = require('./podview_actual_env.cjs');
  const server = await staticServer(path.join(root, 'podvoice/gatekeeper/static/podview'));
  const base = `http://127.0.0.1:${server.address().port}`;
  const [browser, python] = await Promise.all([chromium.launch(env.browserOptions()), fixturePython()]);
  try {
    const flows = Object.keys(FLOWS).filter(name => FIXTURE_STATES[name].some(only));
    if (!python) {
      for (const name of flows)
        for (const [section, label] of FIXTURE_STATES[name].filter(only))
          sheet.skip(section, label, 'kræver Python med add-on\'ets pakker (.venv eller PODVIEW_TEST_PYTHON)');
    }
    const context = {browser, env, python, sheet, only};
    await Promise.all([
      captureStatic(browser, base, sheet, STATIC.filter(state => only([state.section, state.label]))),
      ...(python ? flows.map(name => runFlow(name, context)) : []),
    ]);
  } finally {
    await browser.close();
    server.close();
  }
  for (const [section, label, reason] of NOT_IN_PRODUCT) if (only([section, label])) sheet.skip(section, label, reason);
}

// ---------- HA Green (read-only) ----------

// Only view changes: the screen's own »show« transition (the same one a tap on a home card makes), the Svar
// history and the speaker list opened and closed. No tap on a card, so no action button can be hit by accident.
const GREEN_STEPS = [
  ['Foto-Ro', 'Foto-Ro', {show: 'photo'}],
  ['Overblik', 'Overblik', {show: 'now'}],
  ['Kø', 'Afspiller og kø', {show: 'player'}],
  ['Dialoger', 'Højttaler-dialog', {show: 'now', open: '#output'}],
  ['Musik', 'Musik', {show: 'music'}],
  ['Radio', 'Radio', {show: 'radio'}],
  ['Robot', 'Robot', {device: 'vacuum'}],
  ['Lys', 'Lys', {device: 'light'}],
  ['Timer', 'Timer', {show: 'timers'}],
  ['Vejr', 'Vejr', {show: 'weather'}],
  ['Opskrifter', 'Opskrifter', {show: 'recipes'}],
  ['Tesla', 'Tesla', {show: 'vehicle'}],
  ['Svar', 'Svar', {show: 'now', open: '#open-history'}],
];

async function greenSweep(chromium, sheet, only) {
  const token = readGreenToken();
  if (!token) {
    console.error('Intet HA-token. Se "node scripts/green-check.mjs --help" under Login.');
    process.exit(2);
  }
  const browser = await chromium.launch(greenLaunchOptions());
  try {
    const context = await greenBrowserContext(browser, token, VIEWPORT);
    const page = await context.newPage();
    const frame = await openGreenPodView(page);
    await frame.waitForFunction(() => document.querySelector('pv-widget-host')?.liveTransport?.connected, null,
      {timeout: 20000}).catch(() => {});
    await sleep(1500);
    for (const [section, label, step] of GREEN_STEPS) {
      if (!only([section, label])) continue;
      try {
        const shown = await frame.evaluate(({show, device}) => {
          const host = document.querySelector('pv-widget-host');
          for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
          const id = device ? host.state?.devices?.find(d => d.kind === device)?.id : show;
          if (!id) return false;
          host.dispatch({type: 'show', id});
          return true;
        }, step);
        if (!shown) throw Error('enheden findes ikke i hjemmet');
        await sleep(1200);
        if (step.open) {
          await frame.locator(step.open).click();
          await sleep(900);
        }
        await sheet.take(page, section, label, {source: 'HA Green'});
      } catch (error) {
        sheet.skip(section, label, `Green: ${redact(error.message.split('\n')[0], token)}`);
      }
    }
    await frame.evaluate(() => {
      for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
      document.querySelector('pv-widget-host')?.dispatch({type: 'show', id: 'photo'});
    }).catch(() => {});
  } finally {
    await browser.close();
  }
}

// ---------- Contact sheet ----------

const ENTITIES = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'};
const escape = text => String(text).replace(/[&<>"]/g, c => ENTITIES[c]);

function contactSheet(sheet, {mode, seconds}) {
  const sections = [...new Set([...sheet.shots, ...sheet.missing].map(item => item.section))];
  const order = ['Foto-Ro', 'Overblik', 'Afspiller', 'Kø', 'Radio', 'Musik', 'Robot', 'Lys', 'Timer', 'Opskrifter',
    'Svar', 'Vejr', 'Tesla', 'Dialoger', 'Knaptilstande'];
  sections.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  // Within a section the states stand in the order they are listed above, not the order they finished in.
  const labels = [...STATIC.map(state => state.label),
    ...Object.values(FIXTURE_STATES).flat().map(([, label]) => label)];
  const shots = [...sheet.shots].sort((a, b) => labels.indexOf(a.label) - labels.indexOf(b.label));
  const tiles = section => shots.filter(shot => shot.section === section).map(shot =>
    `<figure><a href="${escape(shot.file)}" data-zoom><img src="${escape(shot.file)}" alt=""></a>` +
    `<figcaption>${escape(shot.label)}<small>${escape(shot.source || '')}` +
    `${shot.errors?.length ? ` · ${shot.errors.length} JS-fejl` : ''}</small></figcaption></figure>`).join('');
  const missing = section => sheet.missing.filter(item => item.section === section).map(item =>
    `<figure class="missing"><div>Ikke frembragt</div><figcaption>${escape(item.label)}` +
    `<small>${escape(item.reason)}</small></figcaption></figure>`).join('');
  return `<!doctype html><html lang="da"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>PodView visuelt overblik</title><style>
:root{color-scheme:light;--ink:#17171a;--muted:#5f5e5a;--paper:#f7f6f3;--line:#dcdad4}
body{margin:0;padding:24px;background:#e9e7e2;color:var(--ink);font:15px/1.4 system-ui,sans-serif}
header{display:flex;flex-wrap:wrap;gap:8px 24px;align-items:baseline;margin-bottom:8px}
h1{margin:0;font-size:24px}h2{margin:28px 0 10px;font-size:18px}header span{color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(296px,1fr));gap:14px}
figure{margin:0;background:var(--paper);border-radius:12px;overflow:hidden;box-shadow:0 1px 0 var(--line)}
figure img{display:block;width:100%;aspect-ratio:1180/820;object-fit:cover;cursor:zoom-in}
figcaption{padding:8px 10px;font-weight:600}figcaption small{display:block;color:var(--muted);font-weight:400}
.missing>div{display:grid;place-items:center;aspect-ratio:1180/820;color:var(--muted);
background:repeating-linear-gradient(45deg,#efede8 0 10px,#e6e4de 10px 20px)}
dialog{padding:0;border:0;background:transparent;max-width:96vw}dialog::backdrop{background:rgb(0 0 0/.8)}
dialog img{display:block;max-width:96vw;max-height:88vh;border-radius:8px}
dialog p{margin:8px 0 0;color:#fff;text-align:center;font-weight:600}
</style></head><body><header><h1>PodView · visuelt overblik</h1>
<span>${escape(mode)} · ${sheet.shots.length} tilstande · ${sheet.missing.length} ikke frembragt · ${seconds} s ·
${escape(new Date().toLocaleString('da-DK', {timeZone: 'Europe/Copenhagen'}))}</span></header>
${sections.map(section => `<h2>${escape(section)}</h2><div class="grid">${tiles(section)}${missing(section)}</div>`)
    .join('\n')}
<dialog id="zoom"><img alt=""><p></p></dialog><script>
const zoom=document.getElementById('zoom');
document.addEventListener('click',event=>{const link=event.target.closest('[data-zoom]');
 if(link){event.preventDefault();zoom.querySelector('img').src=link.href;
  zoom.querySelector('p').textContent=link.closest('figure').querySelector('figcaption').firstChild.textContent;
  zoom.showModal();}else if(event.target.closest('#zoom'))zoom.close();});
</script></body></html>`;
}

// ---------- Main ----------

async function main() {
  const {chromium} = loadPlaywright();
  const green = flag('--green');
  const out = path.resolve(option('--out') || fs.mkdtempSync(path.join(os.tmpdir(), 'podview-visual-')));
  fs.mkdirSync(out, {recursive: true});
  const filter = (option('--only') || '').toLowerCase();
  const only = ([section, label]) => !filter || `${section} ${label}`.toLowerCase().includes(filter);
  const sheet = new Sheet(out, only);
  if (green) await greenSweep(chromium, sheet, only);
  else await localSweep(chromium, sheet, only);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const file = path.join(out, 'index.html');
  fs.writeFileSync(file, contactSheet(sheet, {mode: green ? 'HA Green (kun læsende)' : 'lokale testdata', seconds}));
  console.log(`${sheet.shots.length} tilstande på ${seconds} s, ${sheet.missing.length} ikke frembragt.`);
  for (const item of sheet.missing) console.log(`  ikke frembragt: ${item.label} (${item.reason})`);
  const withErrors = sheet.shots.filter(shot => shot.errors?.length);
  for (const shot of withErrors) console.log(`  JS-fejl i ${shot.label}: ${shot.errors[0]}`);
  console.log(`Kontaktark: ${file}`);
  if (flag('--open') && process.platform === 'darwin') spawn('open', [file], {stdio: 'ignore', detached: true});
}

main().catch(error => {
  console.error('Visuelt overblik kunne ikke køre:', error?.message || error);
  process.exit(1);
});
